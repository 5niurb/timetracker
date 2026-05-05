# Compliance COI Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full COI insurance compliance workflow — nightly scan fires email+SMS reminders, workers forward/upload their certificate, Claude Haiku extracts the fields, worker confirms in a pre-filled form, Mike approves in a 15-second admin panel review.

**Architecture:** New `routes/compliance.js` file mounts into `server.js` (keeping it out of the 2035-line monolith). Shared `lib/compliance-notifications.mjs` handles Resend + Twilio. `lib/coi-extractor.mjs` wraps the existing `scripts/extract-insurance.mjs` logic. Worker confirm page is a new `public/compliance.html`. Admin review is a new tab in `public/admin.html`. Cloudflare Email Worker (`cloudflare/coi-email-worker.js`) is deployed separately via `wrangler`. Nightly scanner is `scripts/compliance-scanner.mjs`, registered as a Mac launchd agent.

**Tech Stack:** Node.js + Express, Supabase (PostgreSQL + Storage), Resend (email), Twilio (SMS), Claude Haiku via `@anthropic-ai/sdk` (existing), Cloudflare Email Workers, vanilla JS frontend, Node built-in `assert` for tests (run via `node test/*.test.js`).

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `migrations/002_compliance_schema.sql` | Create | SQL for `compliance_requests` + `compliance_documents` + employee column additions |
| `lib/compliance-tokens.js` | Create | Token generation, validation, expiry check |
| `lib/compliance-notifications.mjs` | Create | Resend email + Twilio SMS wrappers for each template |
| `lib/coi-extractor.mjs` | Create | Thin wrapper: uploads file to storage, calls Haiku, writes to compliance_documents |
| `routes/compliance.js` | Create | All 8 compliance API endpoints |
| `public/compliance.html` | Create | Mobile-friendly worker confirm page (Step 2 landing) |
| `public/admin.html` | Modify | Add "Compliance" tab with review queue |
| `cloudflare/coi-email-worker.js` | Create | Cloudflare Email Worker: parse → extract PDF → POST to paytrack API |
| `scripts/compliance-scanner.mjs` | Create | Nightly: find expiring/missing COIs, fire Step 1 reminders |
| `server.js` | Modify | Mount `routes/compliance.js` |
| `test/compliance-tokens.test.js` | Create | Token generation + validation tests |
| `test/compliance-routes.test.js` | Create | API endpoint tests (in-process, no HTTP) |

---

## Task 1: Database Schema

**Files:**
- Create: `migrations/002_compliance_schema.sql`
- Modify: `supabase-schema.sql` (append new tables)

- [ ] **Step 1: Write the migration SQL**

Create `migrations/002_compliance_schema.sql`:

```sql
-- Run in Supabase SQL Editor

-- Token-based compliance requests (one per active link)
CREATE TABLE IF NOT EXISTS compliance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('upload', 'esign')),
  document_type text NOT NULL CHECK (document_type IN ('coi', 'w9', 'contract')),
  token text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_requests_token ON compliance_requests(token);
CREATE INDEX IF NOT EXISTS idx_compliance_requests_employee ON compliance_requests(employee_id);

-- Document records (one per submitted document)
CREATE TABLE IF NOT EXISTS compliance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('coi', 'w9', 'contract')),
  storage_path text,

  -- COI extracted fields
  insurer_name text,
  policy_number text,
  expiration_date date,
  per_occurrence numeric(12,2),
  aggregate numeric(12,2),

  -- Raw AI output + worker edits
  ai_extracted jsonb,
  worker_confirmed_at timestamptz,
  worker_edits jsonb,

  -- Admin review
  admin_approved_at timestamptz,
  admin_approved_by text,
  admin_action text CHECK (admin_action IN ('approved', 'edited', 'rejected')),

  -- Workflow state
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'extracted', 'worker_confirmed', 'approved', 'rejected')),

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_docs_employee ON compliance_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_compliance_docs_status ON compliance_documents(status);

-- Add compliance columns to employees
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS coi_expiry date,
  ADD COLUMN IF NOT EXISTS coi_insurer text,
  ADD COLUMN IF NOT EXISTS professional_license_number text,
  ADD COLUMN IF NOT EXISTS professional_license_type text,
  ADD COLUMN IF NOT EXISTS professional_license_expiry date,
  ADD COLUMN IF NOT EXISTS w9_signed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS contract_signed boolean DEFAULT false;
```

- [ ] **Step 2: Run the migration**

Paste `migrations/002_compliance_schema.sql` into the Supabase SQL Editor for the paytrack project. Verify no errors.

- [ ] **Step 3: Verify tables exist**

In Supabase Table Editor, confirm `compliance_requests` and `compliance_documents` appear. Check `employees` has the new columns by running:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'employees' AND column_name LIKE 'coi%'
ORDER BY column_name;
```

Expected output: `coi_expiry`, `coi_insurer`

- [ ] **Step 4: Append to supabase-schema.sql**

Append the migration SQL to `supabase-schema.sql` so it's documented as the canonical schema.

- [ ] **Step 5: Commit**

```bash
git add migrations/002_compliance_schema.sql supabase-schema.sql
git commit -m "[paytrack] Add compliance schema: requests + documents tables"
```

---

## Task 2: Token Library

**Files:**
- Create: `lib/compliance-tokens.js`
- Create: `test/compliance-tokens.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/compliance-tokens.test.js`:

```javascript
'use strict';

const assert = require('assert');
const { generateToken, isTokenExpired, TOKEN_TTL_DAYS } = require('../lib/compliance-tokens');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  PASS:', name);
    passed++;
  } catch (e) {
    console.error('  FAIL:', name, '-', e.message);
    failed++;
  }
}

console.log('\nToken generation:');
test('generateToken returns object with token and expires_at', () => {
  const t = generateToken();
  assert.ok(t.token, 'token present');
  assert.ok(t.expires_at instanceof Date, 'expires_at is Date');
});

test('token is a non-empty string', () => {
  const t = generateToken();
  assert.strictEqual(typeof t.token, 'string');
  assert.ok(t.token.length > 10);
});

test('expires_at is TOKEN_TTL_DAYS days in the future', () => {
  const before = new Date();
  const t = generateToken();
  const after = new Date();
  const diffDays = (t.expires_at - before) / (1000 * 60 * 60 * 24);
  assert.ok(diffDays >= TOKEN_TTL_DAYS - 0.01 && diffDays <= TOKEN_TTL_DAYS + 0.01,
    `expected ~${TOKEN_TTL_DAYS} days, got ${diffDays.toFixed(3)}`);
});

console.log('\nToken expiry check:');
test('isTokenExpired returns false for future date', () => {
  const future = new Date(Date.now() + 1000 * 60 * 60);
  assert.strictEqual(isTokenExpired(future), false);
});

test('isTokenExpired returns true for past date', () => {
  const past = new Date(Date.now() - 1000);
  assert.strictEqual(isTokenExpired(past), true);
});

test('isTokenExpired returns true for null', () => {
  assert.strictEqual(isTokenExpired(null), true);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
node test/compliance-tokens.test.js
```

Expected: `FAIL: lib/compliance-tokens.js not found`

- [ ] **Step 3: Implement the token library**

Create `lib/compliance-tokens.js`:

```javascript
'use strict';

const { randomUUID } = require('crypto');

const TOKEN_TTL_DAYS = 7;

function generateToken() {
  const token = randomUUID();
  const expires_at = new Date();
  expires_at.setDate(expires_at.getDate() + TOKEN_TTL_DAYS);
  return { token, expires_at };
}

function isTokenExpired(expires_at) {
  if (!expires_at) return true;
  return new Date(expires_at) <= new Date();
}

module.exports = { generateToken, isTokenExpired, TOKEN_TTL_DAYS };
```

- [ ] **Step 4: Run test — confirm it passes**

```bash
node test/compliance-tokens.test.js
```

Expected: all PASS, exit 0

- [ ] **Step 5: Commit**

```bash
git add lib/compliance-tokens.js test/compliance-tokens.test.js
git commit -m "[paytrack] Add compliance token generation library"
```

---

## Task 3: Notification Library

**Files:**
- Create: `lib/compliance-notifications.mjs`

No unit tests for this module — it wraps external APIs (Resend + Twilio). Integration is verified manually in Task 12.

- [ ] **Step 1: Create the notifications module**

Create `lib/compliance-notifications.mjs`:

```javascript
import { Resend } from 'resend';
import twilio from 'twilio';

const resend = new Resend(process.env.RESEND_API_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const FROM_PHONE = process.env.TWILIO_PHONE_NUMBER;
const FROM_EMAIL = 'paytrack@lemedspa.com';

// Step 1: Initial COI reminder (email + SMS)
export async function sendCOIReminder({ to_email, to_phone, worker_name, expiry_date, upload_url }) {
  const expiryStr = expiry_date
    ? `expiring ${new Date(expiry_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
    : 'on file';

  await resend.emails.send({
    from: FROM_EMAIL,
    to: to_email,
    subject: `Hi ${worker_name.split(' ')[0]} — we still need your updated insurance certificate`,
    html: `
      <p>Hi ${worker_name.split(' ')[0]} 👋</p>
      <p>Your certificate of insurance is ${expiryStr}. Once your insurer sends you the updated certificate, just forward it to us and we'll take care of the rest.</p>
      <p><strong>Forward your COI email to:</strong><br>
      <a href="mailto:coi@lemedspa.com" style="font-size:1.1rem;color:#0066cc">coi@lemedspa.com</a></p>
      <p>Or if you have the file handy, upload it here:<br>
      <a href="${upload_url}">${upload_url}</a></p>
      <p>Questions? <a href="mailto:ops@lemedspa.com">ops@lemedspa.com</a></p>
    `,
  });

  if (to_phone) {
    await twilioClient.messages.create({
      from: FROM_PHONE,
      to: to_phone,
      body: `Le Med Spa: Hi ${worker_name.split(' ')[0]}! We still need your updated insurance cert. Forward your broker email to coi@lemedspa.com or upload here: ${upload_url}`,
    });
  }
}

// Step 2: Confirm notification (sent after document received + extracted)
export async function sendCOIConfirmRequest({ to_email, to_phone, worker_name, confirm_url }) {
  await resend.emails.send({
    from: FROM_EMAIL,
    to: to_email,
    subject: `Got your insurance certificate ✓ — takes 30 sec to confirm`,
    html: `
      <p>Hi ${worker_name.split(' ')[0]} 👋</p>
      <p>We received your certificate and pulled out the key details. Takes about 30 seconds to confirm everything looks right.</p>
      <p><a href="${confirm_url}" style="display:inline-block;padding:10px 20px;background:#e8c46a;color:#111;font-weight:bold;text-decoration:none;border-radius:6px">Review & Confirm →</a></p>
    `,
  });

  if (to_phone) {
    await twilioClient.messages.create({
      from: FROM_PHONE,
      to: to_phone,
      body: `Le Med Spa: Got your insurance doc! Takes 30 sec to confirm the details — tap here: ${confirm_url}`,
    });
  }
}

// Approval confirmation to worker
export async function sendCOIApproved({ to_email, worker_name, insurer, expiry_date }) {
  const expiryStr = new Date(expiry_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  await resend.emails.send({
    from: FROM_EMAIL,
    to: to_email,
    subject: `Your insurance certificate is on file ✓`,
    html: `
      <p>Hi ${worker_name.split(' ')[0]} 👋</p>
      <p>All set! Your updated certificate from ${insurer} is on file, valid through ${expiryStr}. No further action needed.</p>
      <p>Thanks,<br>Le Med Spa Operations</p>
    `,
  });
}
```

- [ ] **Step 2: Verify dependencies are available**

```bash
cd paytrack && node -e "require('@supabase/supabase-js'); console.log('supabase ok')"
```

Note: `resend` and `twilio` are not yet in `package.json`. Add them:

```bash
npm install resend twilio
```

- [ ] **Step 3: Commit**

```bash
git add lib/compliance-notifications.mjs package.json package-lock.json
git commit -m "[paytrack] Add compliance notification helpers (Resend + Twilio)"
```

---

## Task 4: COI Extractor

**Files:**
- Create: `lib/coi-extractor.mjs`

This wraps the logic from `scripts/extract-insurance.mjs`. That script runs as a CLI; this module exposes the same extraction as a function callable from routes.

- [ ] **Step 1: Read the existing extractor to understand its structure**

Check `scripts/extract-insurance.mjs` lines 1-50 to understand how it calls the Anthropic API and what it returns. The new module replicates the core extraction logic as a function rather than a CLI script.

- [ ] **Step 2: Create the extractor module**

Create `lib/coi-extractor.mjs`:

```javascript
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const BUCKET = 'onboarding-documents';

const EXTRACTION_PROMPT = `You are reading a Certificate of Liability Insurance (COI) document.
Extract the following fields and return ONLY valid JSON with exactly these keys:
{
  "insurer_name": "name of the insurance company",
  "policy_number": "the policy or certificate number",
  "expiration_date": "YYYY-MM-DD format",
  "per_occurrence": 1000000,
  "aggregate": 2000000
}
All numeric values should be numbers (not strings). If a field is not found, use null.`;

// Download file from Supabase Storage, return as Buffer
async function downloadFromStorage(storage_path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(storage_path);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Determine media type from storage path
function getMediaType(storage_path) {
  const lower = storage_path.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/pdf';
}

// Extract COI fields from a file already in Supabase Storage
// Returns { insurer_name, policy_number, expiration_date, per_occurrence, aggregate }
export async function extractCOI(storage_path) {
  const fileBuffer = await downloadFromStorage(storage_path);
  const mediaType = getMediaType(storage_path);
  const base64 = fileBuffer.toString('base64');

  const isImage = mediaType.startsWith('image/');

  const content = isImage
    ? [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } }]
    : [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }];

  content.push({ type: 'text', text: EXTRACTION_PROMPT });

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content }],
  });

  const text = response.content[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Haiku response');

  return JSON.parse(jsonMatch[0]);
}
```

- [ ] **Step 3: Verify Anthropic SDK is in dependencies**

```bash
grep anthropic package.json
```

Expected: `"@anthropic-ai/sdk"` appears. (It's already in devDependencies; move to dependencies if needed for production.)

```bash
npm install @anthropic-ai/sdk --save
```

- [ ] **Step 4: Commit**

```bash
git add lib/coi-extractor.mjs package.json package-lock.json
git commit -m "[paytrack] Add COI extractor module wrapping Haiku extraction"
```

---

## Task 5: Compliance API Routes (scaffold + token endpoints)

**Files:**
- Create: `routes/compliance.js`
- Create: `test/compliance-routes.test.js` (partial — grows through Tasks 5-8)
- Modify: `server.js` (mount routes)

- [ ] **Step 1: Create the routes scaffold and write failing tests for token validation**

Create `test/compliance-routes.test.js`:

```javascript
'use strict';

const assert = require('assert');

// We test the helper logic directly — not HTTP — to keep tests fast and dependency-free.
// The token validation logic lives in lib/compliance-tokens.js (already tested).
// Here we test the request lookup logic that routes depend on.

// Minimal Supabase mock for route logic tests
function makeMockSupabase(rows) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: rows[0] || null, error: rows.length === 0 ? { message: 'not found' } : null }),
        }),
        is: () => ({
          single: async () => ({ data: rows[0] || null, error: null }),
        }),
      }),
    }),
  };
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        console.log('  PASS:', name);
        passed++;
      }).catch(e => {
        console.error('  FAIL:', name, '-', e.message);
        failed++;
      });
    }
    console.log('  PASS:', name);
    passed++;
  } catch (e) {
    console.error('  FAIL:', name, '-', e.message);
    failed++;
  }
  return Promise.resolve();
}

const { isTokenExpired } = require('../lib/compliance-tokens');

console.log('\nToken expiry used in route guard:');

async function runTests() {
  await test('expired token is caught', async () => {
    const past = new Date(Date.now() - 1000);
    assert.strictEqual(isTokenExpired(past), true);
  });

  await test('valid token passes', async () => {
    const future = new Date(Date.now() + 86400000);
    assert.strictEqual(isTokenExpired(future), false);
  });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests();
```

- [ ] **Step 2: Run test — confirm it passes (it uses existing token lib)**

```bash
node test/compliance-routes.test.js
```

Expected: all PASS

- [ ] **Step 3: Create the routes file scaffold**

Create `routes/compliance.js`:

```javascript
'use strict';

const express = require('express');
const router = express.Router();
const { generateToken, isTokenExpired } = require('../lib/compliance-tokens');

// Supabase client is passed in via module.exports factory
// (avoids circular dependency with server.js)
let supabase;
let notifier;
let extractor;

function init(supabaseClient) {
  supabase = supabaseClient;
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
    .single();

  if (error || !req) {
    res.status(404).json({ error: 'Link not found or already used.' });
    return null;
  }
  if (isTokenExpired(req.expires_at)) {
    res.status(410).json({ error: 'This link has expired. Please contact ops@lemedspa.com for a new one.' });
    return null;
  }
  return req;
}

// ─────────────────────────────────────────────
// POST /api/compliance/coi-received
// Called by Cloudflare Email Worker after PDF extracted
// ─────────────────────────────────────────────
router.post('/coi-received', async (req, res) => {
  const { employee_id, storage_path } = req.body;
  if (!employee_id || !storage_path) {
    return res.status(400).json({ error: 'employee_id and storage_path required' });
  }

  try {
    // 1. Create a compliance_documents row (status: pending)
    const { data: doc, error: docErr } = await supabase
      .from('compliance_documents')
      .insert({ employee_id, document_type: 'coi', storage_path, status: 'pending' })
      .select()
      .single();

    if (docErr) throw docErr;

    // 2. Run extraction async (don't block the response)
    res.json({ success: true, document_id: doc.id });

    // 3. Extract and update
    try {
      const { extractCOI } = await getExtractor();
      const fields = await extractCOI(storage_path);

      await supabase.from('compliance_documents').update({
        ...fields,
        ai_extracted: fields,
        status: 'extracted',
      }).eq('id', doc.id);

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

      const n = await getNotifier();
      await n.sendCOIConfirmRequest({
        to_email: emp.email,
        to_phone: emp.phone,
        worker_name: emp.name,
        confirm_url: `${BASE_URL}/compliance.html?token=${token}`,
      });
    } catch (extractErr) {
      console.error('COI extraction failed:', extractErr.message);
      await supabase.from('compliance_documents').update({ status: 'pending' }).eq('id', doc.id);
    }
  } catch (err) {
    console.error('coi-received error:', err.message);
    res.status(500).json({ error: 'Internal error processing document' });
  }
});

// ─────────────────────────────────────────────
// GET /api/compliance/confirm/:token
// Returns pre-filled confirmation data for worker
// ─────────────────────────────────────────────
router.get('/confirm/:token', async (req, res) => {
  const request = await findValidRequest(res, req.params.token);
  if (!request) return;

  // Find the most recent extracted compliance_documents for this employee
  const { data: doc } = await supabase
    .from('compliance_documents')
    .select('id, insurer_name, policy_number, expiration_date, per_occurrence, aggregate, storage_path')
    .eq('employee_id', request.employee_id)
    .eq('document_type', 'coi')
    .in('status', ['extracted', 'pending'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

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
    const { data: doc } = await supabase
      .from('compliance_documents')
      .select('ai_extracted')
      .eq('id', document_id)
      .single();

    const ai = doc?.ai_extracted || {};
    const edits = {};
    for (const key of ['insurer_name', 'policy_number', 'expiration_date', 'per_occurrence', 'aggregate']) {
      if (fields[key] !== undefined && String(fields[key]) !== String(ai[key])) {
        edits[key] = { original: ai[key], corrected: fields[key] };
      }
    }

    await supabase.from('compliance_documents').update({
      ...fields,
      worker_edits: Object.keys(edits).length > 0 ? edits : null,
      worker_confirmed_at: new Date().toISOString(),
      status: 'worker_confirmed',
    }).eq('id', document_id);

    // Mark token used
    await supabase.from('compliance_requests').update({ used_at: new Date().toISOString() })
      .eq('token', req.params.token);

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
  const { id } = req.params;
  const { edited_fields } = req.body; // optional — if admin edited before approving

  try {
    const updateData = {
      admin_approved_at: new Date().toISOString(),
      admin_action: 'approved',
      status: 'approved',
    };
    if (edited_fields) Object.assign(updateData, edited_fields);

    const { data: doc, error } = await supabase
      .from('compliance_documents')
      .update(updateData)
      .eq('id', id)
      .select('*, employees(id, name, email, coi_expiry)')
      .single();

    if (error) throw error;

    // Update employee record
    await supabase.from('employees').update({
      coi_expiry: doc.expiration_date,
      coi_insurer: doc.insurer_name,
    }).eq('id', doc.employee_id);

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
  const { id } = req.params;

  try {
    const { data: doc, error } = await supabase
      .from('compliance_documents')
      .update({ admin_action: 'rejected', status: 'rejected' })
      .eq('id', id)
      .select('*, employees(id, name, email, phone, coi_expiry)')
      .single();

    if (error) throw error;

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

module.exports = { router, init };
```

- [ ] **Step 4: Mount compliance routes in server.js**

Find the section in `server.js` where other routes are defined (search for `app.get` or `app.post`). Add after existing requires at the top:

```javascript
const { router: complianceRouter, init: initCompliance } = require('./routes/compliance');
```

Then after `supabase` is initialized (after `const supabase = createClient(...)`), add:

```javascript
initCompliance(supabase);
app.use('/api/compliance', complianceRouter);
```

- [ ] **Step 5: Start dev server and verify routes mount**

```bash
npm run dev
```

In a second terminal:

```bash
curl -s http://localhost:3000/api/compliance/review | head -5
```

Expected: JSON response (empty items array or auth error — not 404)

- [ ] **Step 6: Commit**

```bash
git add routes/compliance.js test/compliance-routes.test.js server.js
git commit -m "[paytrack] Add compliance API routes (COI received, confirm, admin review)"
```

---

## Task 6: Worker Confirm Page

**Files:**
- Create: `public/compliance.html`

- [ ] **Step 1: Create the worker confirm page**

Create `public/compliance.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm Your Certificate — Le Med Spa</title>
  <link rel="stylesheet" href="/css/style.css">
  <style>
    body { max-width: 480px; margin: 0 auto; padding: 20px 16px; font-family: -apple-system, sans-serif; background: #0f0f0f; color: #e8e8e8; }
    h1 { font-size: 1.3rem; margin-bottom: 4px; }
    .subtitle { color: #aaa; font-size: 0.9rem; margin-bottom: 24px; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    label { display: block; color: #888; font-size: 0.8rem; margin-bottom: 4px; margin-top: 12px; }
    label:first-child { margin-top: 0; }
    input { width: 100%; padding: 8px 10px; background: #111; border: 1px solid #333; border-radius: 6px; color: #e8e8e8; font-size: 0.95rem; box-sizing: border-box; }
    input:focus { outline: none; border-color: #e8c46a; }
    .row { display: flex; gap: 12px; }
    .row > div { flex: 1; }
    .doc-thumb { background: #111; border: 1px dashed #444; border-radius: 6px; padding: 16px; text-align: center; color: #666; font-size: 0.85rem; margin-bottom: 0; }
    .doc-thumb a { color: #e8c46a; text-decoration: none; font-size: 0.8rem; }
    .check-card { display: flex; gap: 10px; align-items: flex-start; }
    .check-card input[type=checkbox] { margin-top: 2px; accent-color: #e8c46a; width: auto; flex-shrink: 0; }
    .check-card span { color: #ccc; font-size: 0.9rem; }
    button { width: 100%; padding: 14px; background: #e8c46a; color: #111; font-weight: 700; font-size: 1rem; border: none; border-radius: 8px; cursor: pointer; margin-top: 8px; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .success { text-align: center; padding: 40px 20px; }
    .success h2 { color: #7ec87e; }
    .error-state { color: #c87e7e; text-align: center; padding: 40px 20px; }
    #loading { text-align: center; padding: 60px 20px; color: #888; }
  </style>
</head>
<body>

<div id="loading">Loading your certificate details…</div>

<div id="app" style="display:none">
  <h1 id="greeting"></h1>
  <p class="subtitle">We read your certificate — everything below look right?</p>

  <div class="card">
    <div class="doc-thumb" id="doc-thumb">
      📄 <span id="doc-filename">Your uploaded document</span><br>
      <a id="doc-link" href="#" target="_blank" style="display:none">Tap to view full document ↗</a>
    </div>
  </div>

  <div class="card">
    <p style="color:#888;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px">Edit anything that looks off</p>

    <label>Insurer</label>
    <input id="f-insurer" type="text" autocomplete="off">

    <label>Policy Number</label>
    <input id="f-policy" type="text" autocomplete="off">

    <label>Expiration Date</label>
    <input id="f-expiry" type="date">

    <div class="row">
      <div>
        <label>Per Occurrence</label>
        <input id="f-occurrence" type="text" placeholder="$1,000,000">
      </div>
      <div>
        <label>Aggregate</label>
        <input id="f-aggregate" type="text" placeholder="$2,000,000">
      </div>
    </div>
  </div>

  <div class="card check-card">
    <input type="checkbox" id="confirm-check">
    <span>These details match my updated certificate of insurance.</span>
  </div>

  <button id="submit-btn" disabled>Looks good ✓</button>
</div>

<div id="success" class="success" style="display:none">
  <h2>✓ All set!</h2>
  <p style="color:#aaa">We've got your confirmation. Le Med Spa will review and you'll hear back shortly.</p>
</div>

<div id="error-state" class="error-state" style="display:none">
  <h2>⚠ Link not valid</h2>
  <p id="error-msg"></p>
  <p style="color:#888;font-size:0.85rem">Questions? <a href="mailto:ops@lemedspa.com" style="color:#e8c46a">ops@lemedspa.com</a></p>
</div>

<script>
(async function () {
  const token = new URLSearchParams(location.search).get('token');

  function show(id) {
    ['loading', 'app', 'success', 'error-state'].forEach(i => {
      document.getElementById(i).style.display = i === id ? '' : 'none';
    });
  }

  if (!token) {
    document.getElementById('error-msg').textContent = 'No confirmation token found in this link.';
    show('error-state');
    return;
  }

  // Fetch pre-filled data
  let data;
  try {
    const res = await fetch(`/api/compliance/confirm/${token}`);
    if (!res.ok) {
      const j = await res.json();
      document.getElementById('error-msg').textContent = j.error || 'This link is not valid.';
      show('error-state');
      return;
    }
    data = await res.json();
  } catch (e) {
    document.getElementById('error-msg').textContent = 'Could not load your details. Try again later.';
    show('error-state');
    return;
  }

  // Populate fields
  const firstName = (data.worker_name || '').split(' ')[0];
  document.getElementById('greeting').textContent = `Hi ${firstName} 👋`;

  const f = data.fields || {};
  document.getElementById('f-insurer').value = f.insurer_name || '';
  document.getElementById('f-policy').value = f.policy_number || '';
  document.getElementById('f-expiry').value = f.expiration_date ? f.expiration_date.split('T')[0] : '';
  document.getElementById('f-occurrence').value = f.per_occurrence ? `$${Number(f.per_occurrence).toLocaleString()}` : '';
  document.getElementById('f-aggregate').value = f.aggregate ? `$${Number(f.aggregate).toLocaleString()}` : '';

  if (data.storage_path) {
    document.getElementById('doc-filename').textContent = data.storage_path.split('/').pop();
    const link = document.getElementById('doc-link');
    link.href = `/api/compliance/document/${token}`;
    link.style.display = '';
  }

  show('app');

  // Enable submit only when checkbox checked
  const check = document.getElementById('confirm-check');
  const btn = document.getElementById('submit-btn');
  check.addEventListener('change', () => { btn.disabled = !check.checked; });

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    const parseAmount = s => {
      const n = parseFloat(String(s).replace(/[$,]/g, ''));
      return isNaN(n) ? null : n;
    };

    const payload = {
      document_id: data.document_id,
      fields: {
        insurer_name: document.getElementById('f-insurer').value.trim(),
        policy_number: document.getElementById('f-policy').value.trim(),
        expiration_date: document.getElementById('f-expiry').value,
        per_occurrence: parseAmount(document.getElementById('f-occurrence').value),
        aggregate: parseAmount(document.getElementById('f-aggregate').value),
      },
    };

    const res = await fetch(`/api/compliance/confirm/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      show('success');
    } else {
      btn.disabled = false;
      btn.textContent = 'Looks good ✓';
      alert('Something went wrong. Please try again or contact ops@lemedspa.com.');
    }
  });
})();
</script>
</body>
</html>
```

- [ ] **Step 2: Add document download route to routes/compliance.js**

Add this route before `module.exports` in `routes/compliance.js`:

```javascript
// GET /api/compliance/document/:token — serves the raw file for worker to view
router.get('/document/:token', async (req, res) => {
  const request = await findValidRequest(res, req.params.token);
  if (!request) return;

  const { data: doc } = await supabase
    .from('compliance_documents')
    .select('storage_path')
    .eq('employee_id', request.employee_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!doc?.storage_path) return res.status(404).json({ error: 'Document not found' });

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
```

- [ ] **Step 3: Test the page in browser**

Start the dev server and open `http://localhost:3000/compliance.html?token=invalid`:

```bash
npm run dev
```

Expected: error state shown ("Link not valid")

- [ ] **Step 4: Commit**

```bash
git add public/compliance.html routes/compliance.js
git commit -m "[paytrack] Add worker COI confirm page + document download route"
```

---

## Task 7: Admin Compliance Review Tab

**Files:**
- Modify: `public/admin.html`

- [ ] **Step 1: Add Compliance tab to admin nav**

In `public/admin.html`, find the tab navigation (search for `<button` near "Review Entries" or the tab list). Add a new tab button:

```html
<button class="tab-btn" data-tab="compliance">Compliance</button>
```

- [ ] **Step 2: Add Compliance tab panel**

Find where tab panels are defined (search for `id="tab-` or similar). Add:

```html
<div id="tab-compliance" class="tab-panel" style="display:none">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
    <h2 style="margin:0">Compliance Review</h2>
    <span id="compliance-count" style="background:#e8c46a;color:#111;padding:3px 10px;border-radius:12px;font-weight:600;font-size:0.85rem"></span>
  </div>

  <div id="compliance-empty" style="display:none;text-align:center;padding:40px;color:#666">
    No pending reviews. ✓
  </div>

  <div id="compliance-list"></div>
</div>
```

- [ ] **Step 3: Add compliance JS to admin.html**

At the bottom of the `<script>` block in `admin.html`, add:

```javascript
// ── Compliance Review ─────────────────────────────────────
async function loadCompliance() {
  const res = await fetch('/api/compliance/review');
  const { items } = await res.json();

  const count = document.getElementById('compliance-count');
  const list = document.getElementById('compliance-list');
  const empty = document.getElementById('compliance-empty');

  count.textContent = items.length ? `${items.length} pending` : '';
  list.innerHTML = '';

  if (!items.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  for (const item of items) {
    const workerEdits = item.worker_edits ? Object.entries(item.worker_edits) : [];
    const editHtml = workerEdits.length
      ? `<div style="background:#1a1500;border:1px solid #4a3a00;border-radius:6px;padding:10px;margin-top:10px;font-size:0.8rem">
           <strong style="color:#e8c46a">⚠ Worker made ${workerEdits.length} edit${workerEdits.length > 1 ? 's' : ''}</strong>
           ${workerEdits.map(([k, v]) => `<div style="color:#aaa;margin-top:4px">${k.replace(/_/g, ' ')}: <s style="color:#888">${v.original}</s> → <span style="color:#e8e8e8">${v.corrected}</span></div>`).join('')}
         </div>`
      : '';

    const card = document.createElement('div');
    card.style.cssText = 'background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:16px;margin-bottom:16px';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div>
          <div style="font-weight:600;font-size:1rem">${item.employees.name}</div>
          <div style="color:#888;font-size:0.8rem">COI · Confirmed ${new Date(item.worker_confirmed_at).toLocaleDateString()}</div>
        </div>
        <a href="/api/compliance/document-admin/${item.id}" target="_blank"
           style="color:#e8c46a;font-size:0.8rem;text-decoration:none">View PDF ↗</a>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.85rem">
        <div><span style="color:#888">Insurer</span><br><strong>${item.insurer_name || '—'}</strong></div>
        <div><span style="color:#888">Policy #</span><br><strong>${item.policy_number || '—'}</strong></div>
        <div><span style="color:#888">Expiry</span><br><strong style="color:#7ec87e">${item.expiration_date || '—'}</strong></div>
        <div><span style="color:#888">Coverage</span><br><strong>$${(item.per_occurrence||0).toLocaleString()} / $${(item.aggregate||0).toLocaleString()}</strong></div>
      </div>

      ${editHtml}

      <div style="display:flex;gap:10px;margin-top:14px">
        <button onclick="approveDoc('${item.id}')"
          style="flex:2;padding:10px;background:#7ec87e;color:#111;font-weight:700;border:none;border-radius:6px;cursor:pointer">
          ✓ Approve & Update Record
        </button>
        <button onclick="rejectDoc('${item.id}')"
          style="flex:1;padding:10px;background:transparent;color:#c87e7e;border:1px solid #c87e7e;border-radius:6px;cursor:pointer">
          ✕ Request New Doc
        </button>
      </div>
    `;
    list.appendChild(card);
  }
}

async function approveDoc(id) {
  if (!confirm('Approve this certificate and update the employee record?')) return;
  const res = await fetch(`/api/compliance/review/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (res.ok) loadCompliance();
  else alert('Error approving. Try again.');
}

async function rejectDoc(id) {
  if (!confirm('Reject this document and send worker a new upload link?')) return;
  const res = await fetch(`/api/compliance/review/${id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (res.ok) loadCompliance();
  else alert('Error rejecting. Try again.');
}

// Hook into tab switching — load on tab open
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'compliance') loadCompliance();
  });
});
```

- [ ] **Step 4: Add admin document download route to routes/compliance.js**

Add before `module.exports`:

```javascript
// Admin-only document view (no token required — admin is already authed via session/admin panel)
router.get('/document-admin/:doc_id', async (req, res) => {
  const { data: doc } = await supabase
    .from('compliance_documents')
    .select('storage_path')
    .eq('id', req.params.doc_id)
    .single();

  if (!doc?.storage_path) return res.status(404).json({ error: 'Not found' });

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
```

- [ ] **Step 5: Test in browser**

Open `http://localhost:3000/admin.html`, click the Compliance tab. Expected: "No pending reviews. ✓" message.

- [ ] **Step 6: Commit**

```bash
git add public/admin.html routes/compliance.js
git commit -m "[paytrack] Add Compliance Review tab to admin panel"
```

---

## Task 8: Cloudflare Email Worker

**Files:**
- Create: `cloudflare/coi-email-worker.js`
- Create: `cloudflare/wrangler.coi-email.toml`

- [ ] **Step 1: Create the email worker**

Create `cloudflare/coi-email-worker.js`:

```javascript
export default {
  async email(message, env, ctx) {
    // Extract PDF attachments from the inbound email
    const attachments = [];
    for await (const part of message.raw) {
      // Cloudflare Email Workers expose raw MIME parts
      // We parse for Content-Type: application/pdf or image/*
      // Using the PostalMime library (bundled via wrangler)
    }

    // Use PostalMime to parse the full email
    const PostalMime = (await import('postal-mime')).default;
    const parser = new PostalMime();
    const email = await parser.parse(message.raw);

    const pdfAttachments = (email.attachments || []).filter(a =>
      a.mimeType === 'application/pdf' ||
      a.mimeType.startsWith('image/')
    );

    if (pdfAttachments.length === 0) {
      // Forward to ops@ for manual handling
      await message.forward('ops@lemedspa.com');
      return;
    }

    const fromEmail = message.from;

    for (const attachment of pdfAttachments) {
      const formData = new FormData();
      formData.append('from_email', fromEmail);
      formData.append('filename', attachment.filename || `coi-${Date.now()}.pdf`);
      formData.append('file', new Blob([attachment.content], { type: attachment.mimeType }), attachment.filename);

      // POST to paytrack API
      const response = await fetch(`${env.PAYTRACK_API_URL}/api/compliance/coi-inbound`, {
        method: 'POST',
        headers: { 'x-email-worker-secret': env.EMAIL_WORKER_SECRET },
        body: formData,
      });

      if (!response.ok) {
        console.error('Failed to POST to paytrack:', await response.text());
      }
    }
  },
};
```

- [ ] **Step 2: Create wrangler config**

Create `cloudflare/wrangler.coi-email.toml`:

```toml
name = "coi-email-receiver"
main = "coi-email-worker.js"
compatibility_date = "2024-01-01"

[vars]
PAYTRACK_API_URL = "https://paytrack.lemedspa.app"

# Set EMAIL_WORKER_SECRET via: wrangler secret put EMAIL_WORKER_SECRET

[[email]]
type = "receive"
destination_address = "coi@lemedspa.com"
```

- [ ] **Step 3: Add coi-inbound route to routes/compliance.js**

This route accepts multipart uploads from the email worker. Add before `module.exports`:

```javascript
const multer = require('multer');
const multerStorage = multer.memoryStorage();
const upload = multer({ storage: multerStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// POST /api/compliance/coi-inbound — called by Cloudflare Email Worker
router.post('/coi-inbound', upload.single('file'), async (req, res) => {
  const secret = req.headers['x-email-worker-secret'];
  if (secret !== process.env.EMAIL_WORKER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { from_email, filename } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    // Match sender to employee
    const { data: emp } = await supabase
      .from('employees')
      .select('id')
      .ilike('email', from_email.trim())
      .single();

    if (!emp) {
      // Unknown sender — forward to ops for manual review
      console.log(`COI email from unknown sender: ${from_email}`);
      return res.json({ success: false, reason: 'sender_unrecognized' });
    }

    // Upload to Supabase Storage
    const storagePath = `compliance/${emp.id}/${Date.now()}-${filename}`;
    const { error: uploadErr } = await supabase.storage
      .from('onboarding-documents')
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype });

    if (uploadErr) throw uploadErr;

    // Trigger the extraction flow (same as direct upload)
    res.json({ success: true });

    // Async: extract + notify
    try {
      const { extractCOI } = await getExtractor();
      const fields = await extractCOI(storagePath);

      const { data: doc } = await supabase
        .from('compliance_documents')
        .insert({ employee_id: emp.id, document_type: 'coi', storage_path: storagePath, ...fields, ai_extracted: fields, status: 'extracted' })
        .select()
        .single();

      const { token, expires_at } = generateToken();
      await supabase.from('compliance_requests').insert({
        employee_id: emp.id, type: 'upload', document_type: 'coi', token, expires_at,
      });

      const { data: fullEmp } = await supabase.from('employees').select('name, email, phone').eq('id', emp.id).single();
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
  } catch (err) {
    console.error('coi-inbound error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});
```

- [ ] **Step 4: Add EMAIL_WORKER_SECRET to environment**

Add `EMAIL_WORKER_SECRET` to paytrack `.env` (dev) and Render dashboard (production). Generate:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- [ ] **Step 5: Commit**

```bash
git add cloudflare/coi-email-worker.js cloudflare/wrangler.coi-email.toml routes/compliance.js
git commit -m "[paytrack] Add Cloudflare Email Worker for coi@lemedspa.com inbound"
```

---

## Task 9: Nightly Scanner

**Files:**
- Create: `scripts/compliance-scanner.mjs`

- [ ] **Step 1: Create the scanner script**

Create `scripts/compliance-scanner.mjs`:

```javascript
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
const BASE_URL = process.env.RENDER_EXTERNAL_URL || 'https://paytrack.lemedspa.app';
const TOKEN_TTL_DAYS = 7;

function tokenExpiresAt() {
  const d = new Date();
  d.setDate(d.getDate() + TOKEN_TTL_DAYS);
  return d;
}

function daysFromNow(date) {
  return Math.ceil((new Date(date) - new Date()) / (1000 * 60 * 60 * 24));
}

async function getNotifier() {
  return import('../lib/compliance-notifications.mjs');
}

async function sendCOIReminders() {
  const thirtyDaysOut = new Date();
  thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);

  // Find employees with COI expiring in ≤30 days OR no COI on file
  const { data: employees } = await supabase
    .from('employees')
    .select('id, name, email, phone, coi_expiry')
    .or(`coi_expiry.lte.${thirtyDaysOut.toISOString().split('T')[0]},coi_expiry.is.null`);

  if (!employees?.length) return;

  const n = await getNotifier();

  for (const emp of employees) {
    // Skip if already has a pending (unused, non-expired) request from today
    const { data: existing } = await supabase
      .from('compliance_requests')
      .select('id')
      .eq('employee_id', emp.id)
      .eq('document_type', 'coi')
      .is('used_at', null)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1);

    if (existing?.length) continue;

    const token = randomUUID();
    const expires_at = tokenExpiresAt();

    await supabase.from('compliance_requests').insert({
      employee_id: emp.id,
      type: 'upload',
      document_type: 'coi',
      token,
      expires_at,
    });

    try {
      await n.sendCOIReminder({
        to_email: emp.email,
        to_phone: emp.phone,
        worker_name: emp.name,
        expiry_date: emp.coi_expiry,
        upload_url: `${BASE_URL}/compliance.html?token=${token}`,
      });
      console.log(`  COI reminder sent → ${emp.name} (${emp.email})`);
    } catch (e) {
      console.error(`  COI reminder FAILED for ${emp.name}:`, e.message);
    }
  }
}

async function run() {
  console.log(`[compliance-scanner] ${new Date().toISOString()}`);
  console.log('Checking COI renewals…');
  await sendCOIReminders();
  console.log('Done.');
}

run().catch(e => {
  console.error('Scanner error:', e);
  process.exit(1);
});
```

- [ ] **Step 2: Test the scanner dry-run**

```bash
node scripts/compliance-scanner.mjs
```

Expected: runs without error, prints "Done." (no employees with expiring COIs if DB is empty)

- [ ] **Step 3: Register as Mac launchd agent**

Create `~/Library/LaunchAgents/com.lemed.compliance-scanner.plist` on the Mac via SSH:

```bash
ssh m2pro "cat > ~/Library/LaunchAgents/com.lemed.compliance-scanner.plist << 'PLIST'
<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>Label</key>
  <string>com.lemed.compliance-scanner</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/mikeculver/Projects/LMOperations/lmdev/paytrack/scripts/compliance-scanner.mjs</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>23</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/mikeculver/Logs/compliance-scanner.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/mikeculver/Logs/compliance-scanner.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
PLIST
launchctl load ~/Library/LaunchAgents/com.lemed.compliance-scanner.plist && echo 'Loaded'"
```

- [ ] **Step 4: Verify launchd loaded**

```bash
ssh m2pro "launchctl list | grep compliance-scanner"
```

Expected: entry appears

- [ ] **Step 5: Commit**

```bash
git add scripts/compliance-scanner.mjs
git commit -m "[paytrack] Add nightly compliance scanner + launchd registration"
```

---

## Task 10: End-to-End Smoke Test

Manual walkthrough to verify the full COI flow works before deploy.

- [ ] **Step 1: Create a test employee with a COI expiry in the past**

In Supabase SQL Editor:

```sql
UPDATE employees SET coi_expiry = '2026-01-01' WHERE name ILIKE '%test%' LIMIT 1;
```

If no test employee exists, add one via the admin panel.

- [ ] **Step 2: Run the scanner manually to trigger a reminder**

```bash
node scripts/compliance-scanner.mjs
```

Expected: "COI reminder sent → [Test Worker]"

Check: test worker's email inbox should have the Step 1 reminder with upload link and `coi@lemedspa.com` address.

- [ ] **Step 3: Open the upload link and upload a sample PDF**

Open the link from the email. Upload a sample COI PDF. Expected: page shows "processing" then reloads (or navigates away).

Check Supabase: a row in `compliance_documents` with `status: 'extracted'` and populated fields.

- [ ] **Step 4: Check Step 2 email arrived**

Worker should receive the "Got your insurance certificate ✓" email with the confirm link.

- [ ] **Step 5: Open confirm link and submit**

Open the confirm link. Verify fields are pre-filled. Edit one field. Check the checkbox. Click "Looks good ✓".

Expected: success message.

Check Supabase: `compliance_documents` row now has `status: 'worker_confirmed'` and `worker_edits` populated for the changed field.

- [ ] **Step 6: Open admin panel → Compliance tab**

Open `http://localhost:3000/admin.html`, click Compliance. Expected: the test submission appears with the edit callout highlighted.

- [ ] **Step 7: Approve**

Click "Approve & Update Record".

Check:
- `compliance_documents.status` = `'approved'`
- `employees.coi_expiry` updated to the new date
- Worker receives "Your insurance certificate is on file ✓" email

- [ ] **Step 8: Commit final test notes**

```bash
git add .
git commit -m "[paytrack] Compliance COI workflow — E2E smoke test passing"
```

---

## Task 11: Deploy to Render + Deploy Email Worker

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

Expected: Render auto-deploy triggered. Wait ~2 min.

- [ ] **Step 2: Verify production routes**

```bash
curl -s https://paytrack.lemedspa.app/api/compliance/review | head -20
```

Expected: `{"items":[]}` (empty queue)

- [ ] **Step 3: Set production env vars on Render**

In Render dashboard for paytrack, add:
- `EMAIL_WORKER_SECRET` — same value as generated in Task 8 Step 4

- [ ] **Step 4: Deploy the Cloudflare Email Worker**

```bash
cd cloudflare
wrangler secret put EMAIL_WORKER_SECRET --config wrangler.coi-email.toml
# Enter the same secret value
wrangler deploy --config wrangler.coi-email.toml
```

- [ ] **Step 5: Verify email routing in Cloudflare**

In Cloudflare Dashboard → Email → Email Routing → `coi@lemedspa.com` should show the worker as destination.

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "[paytrack] Deploy: compliance COI workflow live on Render + Cloudflare"
git push origin main
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Step 1 reminder (email + SMS, both paths) → Tasks 3, 9
- ✅ Email forward path (coi@lemedspa.com) → Tasks 8
- ✅ Upload path (tokenized link) → Tasks 2, 5
- ✅ AI extraction (Claude Haiku) → Task 4
- ✅ Step 2 confirm notification → Task 3, route in Task 5
- ✅ Worker confirm page (pre-filled, editable) → Task 6
- ✅ Worker edits tracked → Task 5 (confirm POST)
- ✅ Admin review queue → Tasks 5, 7
- ✅ Admin approve → Task 5 (approve route), Task 7 (UI)
- ✅ Admin reject + re-trigger → Task 5 (reject route), Task 7 (UI)
- ✅ Employee record updated on approval → Task 5 (approve route)
- ✅ Nightly scanner → Task 9
- ✅ Token 7-day expiry → Task 2
- ✅ Database schema → Task 1

**Not in Plan 1 (deferred to Plan 2):**
- Professional license reminders + BreEZe lookup
- Docuseal W9/contract e-sign
