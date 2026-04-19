// scripts/populate-1099.mjs
// Populates filings_1099 table with 2025 1099-NEC submission records.
// SSNs are AES-256-GCM encrypted using PAYTRACK_ENCRYPTION_KEY (same key as employees.tin_encrypted).
// Leena's SSN was masked on the source form — only last4 stored, tin_encrypted = null.
//
// Run: node --env-file=.env scripts/populate-1099.mjs

import { createClient } from '@supabase/supabase-js';
import { encryptValue } from '../lib/crypto.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Source: LeMed LLC 1099-NEC 2025 — '1099 Table' tab
// Leena's SSN was redacted on form ("XXXXXXX4727") — full SSN not available for encryption
const FILINGS = [
  {
    recipient_name: 'Jade Gonzales',
    ssn: '530-19-1530',
    street_address: '26735 Via Colina',
    city: 'Valencia',
    state: 'CA',
    zip: '91381',
    email: 'jadegonzales7@yahoo.com',
    box1_nonemployee_comp: 34168.10,
    box7_state_income: 34168.10,
  },
  {
    recipient_name: 'Leena Osman',
    ssn: null, // masked on source form — only last4 known
    tin_last4_override: '4727',
    street_address: '7077 Willoughby Ave, Apt 406',
    city: 'Los Angeles',
    state: 'CA',
    zip: '90038',
    email: 'osmanleena@yahoo.com',
    box1_nonemployee_comp: 1140.00,
    box7_state_income: 1140.00,
  },
  {
    recipient_name: 'Jodi Kay',
    ssn: '469-13-7478',
    street_address: '6301 Jumilla Ave',
    city: 'Woodland Hills',
    state: 'CA',
    zip: '91637',
    email: 'Jodi.k@comcast.net',
    box1_nonemployee_comp: 19146.33,
    box7_state_income: 19146.33,
  },
  {
    recipient_name: 'Lucine Keseyan',
    ssn: '851-05-0041',
    street_address: '13803 Chandler Blvd',
    city: 'Van Nuys',
    state: 'CA',
    zip: '91401',
    email: 'lckeseyan@gmail.com',
    box1_nonemployee_comp: 704.92,
    box7_state_income: 704.92,
    tin_match: 'Failed',
  },
  {
    recipient_name: 'Vayda Kasbah',
    ssn: '374-15-6454',
    street_address: '200 N. Vermont Ave',
    city: 'Los Angeles',
    state: 'CA',
    zip: '90004',
    email: 'vkasbah@hotmail.com',
    box1_nonemployee_comp: 3740.90,
    box7_state_income: 3740.90,
    tin_match: 'Failed',
  },
  {
    recipient_name: 'Salakjit Hanna',
    ssn: '617-87-3613',
    street_address: '6311 Crebs Ave',
    city: 'Tarzana',
    state: 'CA',
    zip: '91335',
    email: 'salakjithanna@icloud.com',
    box1_nonemployee_comp: 13397.00,
    box7_state_income: 13397.00,
  },
];

for (const filing of FILINGS) {
  let tin_encrypted = null;
  let tin_last4 = filing.tin_last4_override ?? null;

  if (filing.ssn) {
    const digits = filing.ssn.replace(/\D/g, '');
    if (digits.length !== 9) {
      console.error(`SKIP ${filing.recipient_name}: invalid SSN format (got ${digits.length} digits)`);
      continue;
    }
    tin_encrypted = await encryptValue(filing.ssn);
    tin_last4 = digits.slice(-4);
  }

  const row = {
    tax_year: 2025,
    form: '1099-NEC',
    irs_submit_date: '2026-01-31',
    email_recipient_date: '2026-01-31',
    tin_type: 'SSN',
    tin_match: filing.tin_match ?? 'Passed',
    recipient_name: filing.recipient_name,
    tin_encrypted,
    tin_last4,
    federal_id_type: 2, // 2 = SSN
    street_address: filing.street_address,
    city: filing.city,
    state: filing.state,
    zip: filing.zip,
    email: filing.email,
    box1_nonemployee_comp: filing.box1_nonemployee_comp,
    box2_direct_sales: false,
    box6_state: 'CA',
    box7_state_income: filing.box7_state_income,
    second_tin_notice: false,
  };

  const { error } = await supabase.from('filings_1099').insert(row);

  if (error) {
    console.error(`ERROR ${filing.recipient_name}:`, error.message);
  } else {
    const tinNote = tin_encrypted ? `TIN last4=${tin_last4}` : `TIN last4=${tin_last4} (no encryption — SSN masked on source)`;
    console.log(`OK ${filing.recipient_name}: ${tinNote}, comp=$${filing.box1_nonemployee_comp}`);
  }
}
