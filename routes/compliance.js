'use strict';

const express = require('express');
const router = express.Router();
const { generateToken, isTokenExpired } = require('../lib/compliance-tokens');

const COI_FIELDS = ['insurer_name', 'policy_number', 'expiration_date', 'per_occurrence', 'aggregate'];

// Supabase client and admin password are passed in via module.exports factory
// (avoids circular dependency with server.js and keeps secrets out of this file)
let supabase;
let adminPassword;
let notifier;
let extractor;

function init(supabaseClient, adminPwd) {
  supabase = supabaseClient;
  adminPassword = adminPwd;
  // Lazy-load ESM modules
  notifier = null; // loaded on first use
  extractor = null;
}

async function getNotifier() {
  if (!notifier) {
    notifier = await import('../lib/compliance-notifications.mjs');
  }
  return notifier;
}

async function getExtractor() {
  if (!extractor) {
    extractor = await import('../lib/coi-extractor.mjs');
  }
  return extractor;
}

const BASE_URL = process.env.RENDER_EXTERNAL_URL || 'https://paytrack.lemedspa.app';

// Helper: look up a compliance_request by token, return it or send 404/410
async function findValidRequest(res, token) {
  const { data: req, error } = await supabase
    .from('compliance_requests')
    .select('*, employees(id, name, email, phone)')
    .eq('token', token)
    .is('used_at', null)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: 'Error looking up request.' });
    return null;
  }
  if (!req) {
    res.status(404).json({ error: 'Link not found or already used.' });
    return null;
  }
  if (isTokenExpired(req.expires_at)) {
    res.status(410).json({ error: 'This link has expired. Please contact ops@lemedspa.com for a new one.' });
    return null;
  }
  return req;
}

// Helper: build an allowlisted field object from COI_FIELDS
function pickCOIFields(source) {
  return Object.fromEntries(COI_FIELDS.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]));
}

// ─────────────────────────────────────────────
// POST /api/compliance/coi-received
// Called by Cloudflare Email Worker after PDF extracted
// ─────────────────────────────────────────────
router.post('/coi-received', async (req, res) => {
  const secret = req.headers['x-email-worker-secret'];
  if (secret !== process.env.EMAIL_WORKER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { employee_id, storage_path } = req.body;
  if (!employee_id || !storage_path) {
    return res.status(400).json({ error: 'employee_id and storage_path required' });
  }

  // 1. Create a compliance_documents row (status: pending)
  const { data: doc, error: docErr } = await supabase
    .from('compliance_documents')
    .insert({ employee_id, document_type: 'coi', storage_path, status: 'pending' })
    .select()
    .single();

  if (docErr) {
    console.error('coi-received error:', docErr.message);
    return res.status(500).json({ error: 'Internal error processing document' });
  }

  // 2. Respond immediately — all subsequent work is fire-and-forget
  res.json({ success: true, document_id: doc.id });

  // 3. Extract and notify — isolated from res to prevent double-send
  setImmediate(async () => {
    try {
      const { extractCOI } = await getExtractor();
      const fields = await extractCOI(storage_path);

      await supabase
        .from('compliance_documents')
        .update({ ...fields, ai_extracted: fields, status: 'extracted' })
        .eq('id', doc.id);

      // 4. Create a confirm token and send Step 2 notification
      const { token, expires_at } = generateToken();
      await supabase.from('compliance_requests').insert({
        employee_id,
        type: 'upload',
        document_type: 'coi',
        token,
        expires_at,
      });

      const { data: emp } = await supabase
        .from('employees')
        .select('name, email, phone')
        .eq('id', employee_id)
        .single();

      if (!emp) {
        console.error('coi-received: employee not found for id:', employee_id);
        return;
      }

      const n = await getNotifier();
      await n.sendCOIConfirmRequest({
        to_email: emp.email,
        to_phone: emp.phone,
        worker_name: emp.name,
        confirm_url: `${BASE_URL}/compliance.html?token=${token}`,
      });
    } catch (err) {
      console.error('COI extraction failed (doc.id=%s):', doc.id, err.message);
      await supabase
        .from('compliance_documents')
        .update({ status: 'pending' })
        .eq('id', doc.id)
        .catch((e) => console.error('status reset failed (doc.id=%s):', doc.id, e.message));
    }
  });
});

// ─────────────────────────────────────────────
// GET /api/compliance/confirm/:token
// Returns pre-filled confirmation data for worker
// ─────────────────────────────────────────────
router.get('/confirm/:token', async (req, res) => {
  const request = await findValidRequest(res, req.params.token);
  if (!request) return;

  // Find the most recent extracted compliance_documents for this employee
  const { data: doc, error: docErr } = await supabase
    .from('compliance_documents')
    .select('id, insurer_name, policy_number, expiration_date, per_occurrence, aggregate, storage_path')
    .eq('employee_id', request.employee_id)
    .eq('document_type', 'coi')
    .in('status', ['extracted', 'pending'])
    .order('created_at', { ascending: false })
    .maybeSingle();

  if (docErr) {
    console.error('confirm GET doc error:', docErr.message);
    return res.status(500).json({ error: 'Error loading document data' });
  }

  res.json({
    worker_name: request.employees.name,
    document_id: doc?.id,
    fields: {
      insurer_name: doc?.insurer_name,
      policy_number: doc?.policy_number,
      expiration_date: doc?.expiration_date,
      per_occurrence: doc?.per_occurrence,
      aggregate: doc?.aggregate,
    },
    storage_path: doc?.storage_path,
  });
});

// ─────────────────────────────────────────────
// POST /api/compliance/confirm/:token
// Worker submits confirmation (with any edits)
// ─────────────────────────────────────────────
router.post('/confirm/:token', async (req, res) => {
  const request = await findValidRequest(res, req.params.token);
  if (!request) return;

  const { document_id, fields } = req.body;
  if (!document_id || !fields) {
    return res.status(400).json({ error: 'document_id and fields required' });
  }

  try {
    // Load original AI-extracted values to detect edits
    const { data: doc, error: docFetchErr } = await supabase
      .from('compliance_documents')
      .select('ai_extracted')
      .eq('id', document_id)
      .eq('employee_id', request.employee_id) // cross-employee guard
      .single();

    if (docFetchErr) {
      console.error('confirm POST doc fetch error:', docFetchErr.message);
      return res.status(500).json({ error: 'Error loading document for confirmation' });
    }

    const ai = doc?.ai_extracted || {};
    const edits = {};
    for (const key of COI_FIELDS) {
      if (fields[key] !== undefined && String(fields[key]) !== String(ai[key])) {
        edits[key] = { original: ai[key], corrected: fields[key] };
      }
    }

    // Allowlist fields before writing to DB
    const sanitizedFields = pickCOIFields(fields);

    await supabase
      .from('compliance_documents')
      .update({
        ...sanitizedFields,
        worker_edits: Object.keys(edits).length > 0 ? edits : null,
        worker_confirmed_at: new Date().toISOString(),
        status: 'worker_confirmed',
      })
      .eq('id', document_id)
      .eq('employee_id', request.employee_id);

    // Mark token used
    await supabase
      .from('compliance_requests')
      .update({ used_at: new Date().toISOString() })
      .eq('token', req.params.token)
      .eq('employee_id', request.employee_id);

    res.json({ success: true });
  } catch (err) {
    console.error('confirm error:', err.message);
    res.status(500).json({ error: 'Internal error saving confirmation' });
  }
});

// ─────────────────────────────────────────────
// GET /api/compliance/review
// Admin queue — items awaiting review
// ─────────────────────────────────────────────
router.get('/review', async (req, res) => {
  const { password } = req.headers;
  if (password !== adminPassword) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { data, error } = await supabase
    .from('compliance_documents')
    .select('*, employees(id, name, email)')
    .eq('status', 'worker_confirmed')
    .order('worker_confirmed_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data });
});

// ─────────────────────────────────────────────
// POST /api/compliance/review/:id/approve
// ─────────────────────────────────────────────
router.post('/review/:id/approve', async (req, res) => {
  const { password } = req.headers;
  if (password !== adminPassword) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { id } = req.params;
  const { edited_fields } = req.body; // optional — if admin edited before approving

  try {
    const updateData = {
      admin_approved_at: new Date().toISOString(),
      admin_action: 'approved',
      status: 'approved',
    };
    // Allowlist any admin edits before merging
    if (edited_fields) Object.assign(updateData, pickCOIFields(edited_fields));

    const { data: doc, error } = await supabase
      .from('compliance_documents')
      .update(updateData)
      .eq('id', id)
      .select('*, employees(id, name, email, coi_expiry)')
      .single();

    if (error) throw error;

    // Update employee record
    await supabase
      .from('employees')
      .update({ coi_expiry: doc.expiration_date, coi_insurer: doc.insurer_name })
      .eq('id', doc.employee_id);

    // Notify worker
    const n = await getNotifier();
    await n.sendCOIApproved({
      to_email: doc.employees.email,
      worker_name: doc.employees.name,
      insurer: doc.insurer_name,
      expiry_date: doc.expiration_date,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('approve error:', err.message);
    res.status(500).json({ error: 'Internal error approving document' });
  }
});

// ─────────────────────────────────────────────
// POST /api/compliance/review/:id/reject
// ─────────────────────────────────────────────
router.post('/review/:id/reject', async (req, res) => {
  const { password } = req.headers;
  if (password !== adminPassword) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { id } = req.params;

  try {
    const { data: doc, error } = await supabase
      .from('compliance_documents')
      .update({ admin_action: 'rejected', status: 'rejected' })
      .eq('id', id)
      .select('*, employees(id, name, email, phone, coi_expiry)')
      .maybeSingle();

    if (error) throw error;
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // Issue a new upload token and re-send Step 1
    const { token, expires_at } = generateToken();
    await supabase.from('compliance_requests').insert({
      employee_id: doc.employee_id,
      type: 'upload',
      document_type: 'coi',
      token,
      expires_at,
    });

    const n = await getNotifier();
    await n.sendCOIReminder({
      to_email: doc.employees.email,
      to_phone: doc.employees.phone,
      worker_name: doc.employees.name,
      expiry_date: doc.employees.coi_expiry,
      upload_url: `${BASE_URL}/compliance.html?token=${token}`,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('reject error:', err.message);
    res.status(500).json({ error: 'Internal error rejecting document' });
  }
});

// GET /api/compliance/document/:token — serves the raw file for worker to view
router.get('/document/:token', async (req, res) => {
  const request = await findValidRequest(res, req.params.token);
  if (!request) return;

  const { data: doc, error: docErr } = await supabase
    .from('compliance_documents')
    .select('storage_path')
    .eq('employee_id', request.employee_id)
    .eq('document_type', 'coi')
    .order('created_at', { ascending: false })
    .maybeSingle();

  if (docErr || !doc?.storage_path) return res.status(404).json({ error: 'Document not found' });

  const { data: fileData, error } = await supabase.storage
    .from('onboarding-documents')
    .download(doc.storage_path);

  if (error) return res.status(500).json({ error: 'Could not retrieve document' });

  const arrayBuffer = await fileData.arrayBuffer();
  const ext = doc.storage_path.split('.').pop().toLowerCase();
  const contentType = ext === 'pdf' ? 'application/pdf' : `image/${ext}`;
  res.setHeader('Content-Type', contentType);
  res.send(Buffer.from(arrayBuffer));
});

// GET /api/compliance/document-admin/:doc_id — admin view of any document
router.get('/document-admin/:doc_id', async (req, res) => {
  const { password } = req.headers;
  if (password !== adminPassword) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { data: doc, error: docErr } = await supabase
    .from('compliance_documents')
    .select('storage_path')
    .eq('id', req.params.doc_id)
    .maybeSingle();

  if (docErr || !doc?.storage_path) return res.status(404).json({ error: 'Not found' });

  const { data: fileData, error } = await supabase.storage
    .from('onboarding-documents')
    .download(doc.storage_path);

  if (error) return res.status(500).json({ error: 'Could not retrieve document' });

  const arrayBuffer = await fileData.arrayBuffer();
  const ext = doc.storage_path.split('.').pop().toLowerCase();
  const contentType = ext === 'pdf' ? 'application/pdf' : `image/${ext}`;
  res.setHeader('Content-Type', contentType);
  res.send(Buffer.from(arrayBuffer));
});

const multer = require('multer');
const emailUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// POST /api/compliance/coi-inbound — called by Cloudflare Email Worker
router.post('/coi-inbound', emailUpload.single('file'), async (req, res) => {
  const secret = req.headers['x-email-worker-secret'];
  if (secret !== process.env.EMAIL_WORKER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { from_email, filename } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // Match sender to employee by email
  const { data: emp } = await supabase
    .from('employees')
    .select('id')
    .ilike('email', from_email.trim())
    .maybeSingle();

  if (!emp) {
    console.log(`COI email from unknown sender: ${from_email}`);
    return res.json({ success: false, reason: 'sender_unrecognized' });
  }

  const storagePath = `compliance/${emp.id}/${Date.now()}-${filename}`;
  const { error: uploadErr } = await supabase.storage
    .from('onboarding-documents')
    .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype });

  if (uploadErr) {
    console.error('coi-inbound upload error:', uploadErr.message);
    return res.status(500).json({ error: 'Internal error' });
  }

  // Respond immediately; async extraction follows
  res.json({ success: true });

  // Fire-and-forget: extract fields, store doc, send confirm link
  (async () => {
    try {
      const { extractCOI } = await getExtractor();
      const fields = await extractCOI(storagePath);

      await supabase.from('compliance_documents').insert({
        employee_id: emp.id,
        document_type: 'coi',
        storage_path: storagePath,
        ...fields,
        ai_extracted: fields,
        status: 'extracted',
      });

      const { token, expires_at } = generateToken();
      await supabase.from('compliance_requests').insert({
        employee_id: emp.id,
        type: 'upload',
        document_type: 'coi',
        token,
        expires_at,
      });

      const { data: fullEmp } = await supabase
        .from('employees')
        .select('name, email, phone')
        .eq('id', emp.id)
        .single();

      const n = await getNotifier();
      await n.sendCOIConfirmRequest({
        to_email: fullEmp.email,
        to_phone: fullEmp.phone,
        worker_name: fullEmp.name,
        confirm_url: `${BASE_URL}/compliance.html?token=${token}`,
      });
    } catch (e) {
      console.error('coi-inbound async extraction error:', e.message);
    }
  })();
});

module.exports = { router, init };
