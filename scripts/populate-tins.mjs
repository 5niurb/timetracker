// scripts/populate-tins.mjs
// Run: node scripts/populate-tins.mjs
// Input: manually extracted TIN data from 1099 PDF
// Output: updates employees.tin_encrypted, tin_last4, pin
//
// Source: "LeMed LLC 1099-NEC 2025 - Forms Showing TINs.pdf"
// Ask Lea to provide the SSN for each contractor listed, then fill TIN_DATA below.

import { createClient } from '@supabase/supabase-js';
import { encryptValue } from '../lib/crypto.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Format: { name: 'As in employees.name', ssn: '###-##-####' }
const TIN_DATA = [
  // { name: 'Jade Gonzales',   ssn: 'xxx-xx-xxxx' },
  // { name: 'Leena Osman',     ssn: 'xxx-xx-xxxx' },
  // { name: 'Jodi Kay',        ssn: 'xxx-xx-xxxx' },
  // { name: 'Salakjit Hanna',  ssn: 'xxx-xx-xxxx' },
  // { name: 'Vayda Kasbah',    ssn: 'xxx-xx-xxxx' },
];

if (TIN_DATA.length === 0) {
  console.error('TIN_DATA is empty — fill in SSN values from the 1099 PDF before running.');
  process.exit(1);
}

for (const { name, ssn } of TIN_DATA) {
  const digits = ssn.replace(/\D/g, '');
  if (digits.length !== 9) {
    console.error(`SKIP ${name}: invalid SSN format (got ${digits.length} digits)`);
    continue;
  }

  const tin_last4 = digits.slice(-4);
  const tin_encrypted = encryptValue(ssn);
  const pin = digits.slice(0, 4);

  const { error } = await supabase
    .from('employees')
    .update({ tin_type: 'SSN', tin_last4, tin_encrypted, pin })
    .ilike('name', `%${name.split(' ')[0]}%`);

  if (error) console.error(`ERROR ${name}:`, error.message);
  else console.log(`OK ${name}: PIN=${pin}, TIN last4=${tin_last4}`);
}
