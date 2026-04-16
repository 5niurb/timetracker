/**
 * One-time import: 2024 1099-NEC data from the Avalara/Track1099 CSV template.
 * Creates missing employees, updates addresses/emails, imports tax_filings rows.
 *
 * Run: node paytrack/scripts/import-1099-2024.mjs
 * Requires: PAYTRACK_ENCRYPTION_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in env
 */

import { createClient } from '@supabase/supabase-js';
import { webcrypto } from 'crypto';

// ---- Inline AES-256-GCM (matches lib/crypto.js) ----
async function encryptValue(plaintext) {
  if (!plaintext) return null;
  const keyBuf = Buffer.from(process.env.PAYTRACK_ENCRYPTION_KEY, 'base64');
  const key = await webcrypto.subtle.importKey('raw', keyBuf, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipherBuf = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  const ivHex = Buffer.from(iv).toString('hex');
  const cipherHex = Buffer.from(cipherBuf).toString('hex');
  return `${ivHex}:${cipherHex}`;
}

function last4(tin) {
  if (!tin) return null;
  return tin.replace(/\D/g, '').slice(-4) || null;
}

// ---- CSV data (from 1099 LM csv_template_nec_track1099 avalara.csv, 2024) ----
const CSV = [
  {
    name: 'Jade Gonzales',
    email: 'jadegonzales7@yahoo.com',
    ssn: '530-19-1530',
    federal_id_type: 2,
    address_street: '26735 Via Colina',
    address_street2: null,
    address_city: 'Valencia',
    address_state: 'CA',
    address_zip: '91381',
    box_1: 34168.10,
    box_7: 34168.10,
  },
  {
    name: 'Leena Osman',
    email: 'osmanleena@yahoo.com',
    ssn: null,
    federal_id_type: 2,
    address_street: '7077 Willoughby Ave',
    address_street2: 'Apt 406',
    address_city: 'Los Angeles',
    address_state: 'CA',
    address_zip: '90038',
    box_1: 1140.00,
    box_7: 1140.00,
  },
  {
    name: 'Jodi Kay',
    email: 'Jodi.k@comcast.net',
    ssn: '469-13-7478',
    federal_id_type: 2,
    address_street: '6301 Jumilla Ave',
    address_street2: null,
    address_city: 'Woodland Hills',
    address_state: 'CA',
    address_zip: '91637',
    box_1: 19146.33,
    box_7: 19146.33,
  },
  {
    name: 'Lucine Keseyan',
    email: 'lckeseyan@gmail.com',
    ssn: '851-05-0041',
    federal_id_type: 2,
    address_street: '13803 Chandler Blvd',
    address_street2: null,
    address_city: 'Van Nuys',
    address_state: 'CA',
    address_zip: '91401',
    box_1: 704.92,
    box_7: 704.92,
  },
  {
    name: 'Vayda Kasbah',
    email: 'vkasbah@hotmail.com',
    ssn: '374-15-6454',
    federal_id_type: 2,
    address_street: '200 N. Vermont Ave',
    address_street2: null,
    address_city: 'Los Angeles',
    address_state: 'CA',
    address_zip: '90004',
    box_1: 3740.90,
    box_7: 3740.90,
  },
  {
    name: 'Salakjit Hanna',
    email: 'salakjithanna@icloud.com',
    ssn: '617-87-3613',
    federal_id_type: 2,
    address_street: '6311 Crebs Ave',
    address_street2: null,
    address_city: 'Tarzana',
    address_state: 'CA',
    address_zip: '91335',
    box_1: 13397.00,
    box_7: 13397.00,
  },
];

async function main() {
  const { PAYTRACK_ENCRYPTION_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!PAYTRACK_ENCRYPTION_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing env vars: PAYTRACK_ENCRYPTION_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Load existing employees
  const { data: existing } = await db.from('employees').select('id, name, email');
  const byName = Object.fromEntries((existing || []).map(e => [e.name.toLowerCase(), e]));

  for (const row of CSV) {
    const key = row.name.toLowerCase();
    let employeeId;

    if (byName[key]) {
      // Employee exists — update email and log
      employeeId = byName[key].id;
      console.log(`Found: ${row.name} (id=${employeeId})`);
      if (!byName[key].email && row.email) {
        await db.from('employees').update({ email: row.email }).eq('id', employeeId);
        console.log(`  → Email set: ${row.email}`);
      }
    } else {
      // Create new employee (Vayda, Salakjit)
      const pin = String(Math.floor(1000 + Math.random() * 9000));
      const { data: newEmp, error } = await db
        .from('employees')
        .insert({
          name: row.name,
          email: row.email,
          pin,
          pay_type: 'commission',
          contractor_type: '1099',
          start_date: null,
          onboarding_token: crypto.randomUUID(),
        })
        .select('id')
        .single();
      if (error) {
        console.error(`  ✗ Failed to create ${row.name}: ${error.message}`);
        continue;
      }
      employeeId = newEmp.id;
      console.log(`Created: ${row.name} (id=${employeeId}, pin=${pin})`);
    }

    // Encrypt TIN
    const tin_encrypted = await encryptValue(row.ssn);
    const tin_last4 = last4(row.ssn);

    // Upsert tax_filing for 2024
    const { data: existingFiling } = await db
      .from('tax_filings')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('tax_year', 2024)
      .eq('form_type', '1099-NEC')
      .maybeSingle();

    const filingData = {
      employee_id: employeeId,
      tax_year: 2024,
      form_type: '1099-NEC',
      filing_status: 'draft',
      payer_name: 'LM Operations Inc',
      recipient_name: row.name,
      federal_id_type: row.federal_id_type,
      tin_last4,
      tin_encrypted,
      address_street: row.address_street,
      address_street2: row.address_street2,
      address_city: row.address_city,
      address_state: row.address_state,
      address_zip: row.address_zip,
      address_country_code: 'US',
      recipient_email: row.email,
      box_1_nonemployee_comp: row.box_1,
      box_6_state: 'CA',
      box_7_state_income: row.box_7,
      source: 'csv_import',
      updated_at: new Date().toISOString(),
    };

    let result;
    if (existingFiling) {
      result = await db.from('tax_filings').update(filingData).eq('id', existingFiling.id);
      console.log(`  → Updated tax_filing id=${existingFiling.id}`);
    } else {
      result = await db.from('tax_filings').insert(filingData);
      console.log(`  → Inserted tax_filing (2024, $${row.box_1})`);
    }

    if (result.error) {
      console.error(`  ✗ tax_filing error: ${result.error.message}`);
    }
  }

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
