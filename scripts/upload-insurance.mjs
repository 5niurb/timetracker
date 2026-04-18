// scripts/upload-insurance.mjs
// One-time script: uploads existing local COI files to Supabase Storage
// and sets insurance_upload_path on the corresponding employee row.
//
// Run:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/upload-insurance.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const FILES = [
  {
    employeeId: 11,
    name: 'Jade Gonzales',
    localPath:
      'C:/Users/LMOperations/iCloudDrive/LeMed Owners/1.0 LM Talent/Jade/Jade G Insurance.pdf',
    storagePath: 'insurance/jade-gonzales-coi.pdf',
    mimeType: 'application/pdf',
  },
  {
    employeeId: 17,
    name: 'Kirti Patel',
    localPath:
      'C:/Users/LMOperations/iCloudDrive/LeMed Owners/1.0 LM Talent/Kirti Patel/Insurance.jpeg',
    storagePath: 'insurance/kirti-patel-coi.jpeg',
    mimeType: 'image/jpeg',
  },
];

for (const f of FILES) {
  console.log(`\nProcessing ${f.name}…`);

  const fileBuffer = readFileSync(f.localPath);

  const { error: uploadErr } = await supabase.storage
    .from('onboarding-documents')
    .upload(f.storagePath, fileBuffer, { contentType: f.mimeType, upsert: true });

  if (uploadErr) {
    console.error(`  UPLOAD ERROR: ${uploadErr.message}`);
    continue;
  }
  console.log(`  Uploaded → ${f.storagePath}`);

  const { error: updateErr } = await supabase
    .from('employees')
    .update({ insurance_upload_path: f.storagePath })
    .eq('id', f.employeeId);

  if (updateErr) {
    console.error(`  DB UPDATE ERROR: ${updateErr.message}`);
  } else {
    console.log(`  Set insurance_upload_path on employee ${f.employeeId}`);
  }
}

console.log('\nDone.');
