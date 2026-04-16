/**
 * One-time script: create inactive employees + upload compliance docs to Supabase Storage.
 * Inserts employee_documents rows linking each file to the right employee.
 *
 * Run: node paytrack/scripts/upload-employee-docs.mjs
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in env
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { basename } from 'path';

const TALENT_DIR = 'C:/Users/LMOperations/iCloudDrive/LeMed Owners/1.0 LM Talent';
const BUCKET = 'onboarding-documents';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// MIME type helpers
function mimeType(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const map = {
    pdf: 'application/pdf',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    heic: 'image/heic',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    msg: 'application/vnd.ms-outlook',
  };
  return map[ext] || 'application/octet-stream';
}

async function uploadFile(employeeId, localPath, docType, notes = null) {
  const fileName = basename(localPath);
  const ts = Date.now();
  const storagePath = `employee-${employeeId}/${docType}-${ts}-${fileName}`;

  let fileData;
  try {
    fileData = readFileSync(localPath);
  } catch (e) {
    console.error(`  ✗ Cannot read file: ${localPath} — ${e.message}`);
    return null;
  }

  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(storagePath, fileData, { contentType: mimeType(localPath), upsert: false });

  if (uploadError) {
    console.error(`  ✗ Upload failed: ${fileName} — ${uploadError.message}`);
    return null;
  }

  const { error: insertError } = await db.from('employee_documents').insert({
    employee_id: employeeId,
    document_type: docType,
    file_path: storagePath,
    file_name: fileName,
    notes,
  });

  if (insertError) {
    console.error(`  ✗ DB insert failed: ${fileName} — ${insertError.message}`);
    return null;
  }

  console.log(`  ✓ ${docType}: ${fileName} → ${storagePath}`);
  return storagePath;
}

async function createEmployee(name, email, status = 'active') {
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  const { data, error } = await db
    .from('employees')
    .insert({
      name,
      email,
      pin,
      pay_type: 'commission',
      contractor_type: '1099',
      status,
      onboarding_token: crypto.randomUUID(),
    })
    .select('id')
    .single();

  if (error) {
    console.error(`✗ Failed to create ${name}: ${error.message}`);
    return null;
  }
  console.log(`Created: ${name} (id=${data.id}, pin=${pin}, status=${status})`);
  return data.id;
}

async function main() {
  // 1. Verify existing employees
  const { data: existing } = await db.from('employees').select('id, name, status');
  const byName = Object.fromEntries(existing.map((e) => [e.name.toLowerCase(), e]));

  const jade = byName['jade gonzales'];
  const jodi = byName['jodi kay'];
  const lucine = byName['lucine keseyan'];
  const vayda = byName['vayda kasbah'];

  console.log('Existing employees:');
  [jade, jodi, lucine, vayda].forEach((e) => {
    if (e) console.log(`  ${e.name} (id=${e.id}, status=${e.status})`);
    else console.log('  MISSING');
  });

  // 2. Create inactive employees
  console.log('\nCreating inactive employees...');
  let kirtiId = byName['kirti patel']?.id;
  if (kirtiId) {
    console.log(`Kirti Patel already exists (id=${kirtiId}), updating status=inactive`);
    await db.from('employees').update({ status: 'inactive', email: 'kirti821@gmail.com' }).eq('id', kirtiId);
  } else {
    kirtiId = await createEmployee('Kirti Patel', 'kirti821@gmail.com', 'inactive');
  }

  let sheilaId = byName['sheila ewart']?.id;
  if (sheilaId) {
    console.log(`Sheila Ewart already exists (id=${sheilaId}), updating status=inactive`);
    await db.from('employees').update({ status: 'inactive', email: 'she.ewart@gmail.com' }).eq('id', sheilaId);
  } else {
    sheilaId = await createEmployee('Sheila Ewart', 'she.ewart@gmail.com', 'inactive');
  }

  // 3. Upload documents
  console.log('\nUploading documents...');

  // Jade Gonzales (id=11)
  if (jade) {
    console.log(`\nJade Gonzales (id=${jade.id}):`);
    await uploadFile(jade.id, `${TALENT_DIR}/Jade/Jade G DL ID.jpeg`, 'driver_license');
    await uploadFile(jade.id, `${TALENT_DIR}/Jade/Jade G Insurance.pdf`, 'insurance');
    await uploadFile(
      jade.id,
      `${TALENT_DIR}/Jade/LeMed Nurse Contractor Agreement (Jade G) 6.15.24.docx`,
      'contract',
    );
  }

  // Jodi Kay (id=13)
  if (jodi) {
    console.log(`\nJodi Kay (id=${jodi.id}):`);
    await uploadFile(jodi.id, `${TALENT_DIR}/Jodi Kay/est license.jpeg`, 'professional_license');
    await uploadFile(jodi.id, `${TALENT_DIR}/Jodi Kay/IRS Form W9 rev Mar 2024 Jodi Kay.pdf`, 'w9');
  }

  // Kirti Patel (new)
  if (kirtiId) {
    console.log(`\nKirti Patel (id=${kirtiId}):`);
    await uploadFile(kirtiId, `${TALENT_DIR}/Kirti Patel/ID.jpeg`, 'driver_license');
    await uploadFile(kirtiId, `${TALENT_DIR}/Kirti Patel/Insurance.jpeg`, 'insurance');
    await uploadFile(kirtiId, `${TALENT_DIR}/Kirti Patel/IRS Form W9 rev Mar 2024 Kirti Patel.pdf`, 'w9');
    await uploadFile(kirtiId, `${TALENT_DIR}/Kirti Patel/image0.jpeg`, 'other', 'additional document');
    await uploadFile(kirtiId, `${TALENT_DIR}/Kirti Patel/image2.jpeg`, 'other', 'additional document');
  }

  // Lucine Keseyan (id=14)
  if (lucine) {
    console.log(`\nLucine Keseyan (id=${lucine.id}):`);
    await uploadFile(lucine.id, `${TALENT_DIR}/Lucine Keseyan/IRS Form W9 rev Mar 2024.pdf`, 'w9');
    await uploadFile(lucine.id, `${TALENT_DIR}/Lucine Keseyan/BRN license.pdf`, 'professional_license');
    await uploadFile(lucine.id, `${TALENT_DIR}/Lucine Keseyan/NSO NP.pdf`, 'insurance');
    await uploadFile(
      lucine.id,
      `${TALENT_DIR}/Lucine Keseyan/Independent Contractor Agreement - Lucine Keseyan.pdf`,
      'contract',
    );
    await uploadFile(lucine.id, `${TALENT_DIR}/Lucine Keseyan/BLS full 2023.pdf`, 'other', 'BLS certification');
    await uploadFile(lucine.id, `${TALENT_DIR}/Lucine Keseyan/CPR lucine_.pdf`, 'other', 'CPR certification');
  }

  // Vayda Kasbah (id=15)
  if (vayda) {
    console.log(`\nVayda Kasbah (id=${vayda.id}):`);
    await uploadFile(
      vayda.id,
      `${TALENT_DIR}/Vayda/Vayda K completed W9 Form (Individuals).pdf`,
      'w9',
    );
  }

  // Sheila Ewart (new)
  if (sheilaId) {
    console.log(`\nSheila Ewart (id=${sheilaId}):`);
    await uploadFile(
      sheilaId,
      `${TALENT_DIR}/_old/Sheila E/LeMed Esthetician Contractor Agreement (Sheila) 11.29.24.docx`,
      'contract',
    );
  }

  console.log('\nDone.');

  // Summary
  const { data: docs } = await db
    .from('employee_documents')
    .select('employee_id, document_type, file_name')
    .order('employee_id');
  console.log(`\nTotal employee_documents rows: ${docs?.length ?? 0}`);
  docs?.forEach((d) => console.log(`  [emp ${d.employee_id}] ${d.document_type}: ${d.file_name}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
