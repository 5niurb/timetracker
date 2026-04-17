// Import historical payments from Chase xlsx into Supabase payments table
// Run once: node scripts/import-payments.mjs
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Manual .env parse (no dotenv dependency needed)
try {
  const env = readFileSync(resolve(__dirname, '../.env'), 'utf8');
  env.split('\n').forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
  });
} catch {}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
);

// Map spreadsheet teammate labels → employee IDs
const TEAMMATE_MAP = {
  Jade: 11,
  Leena: 12,
  Jodi: 13,
  Lucy: 14,
  Vayda: 15,
  Fon: 16,
  Kirti: 17,
  Sheila: 18,
};

const XLSX_PATH =
  'C:/Users/LMOperations/iCloudDrive/LeMed Owners/0.2 LM Financials/Loan docs/Chase7855_Activity_20260107.xlsx';

const wb = XLSX.readFile(XLSX_PATH);
const ws = wb.Sheets['Chase7855_Activity_20260107'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

const payments = [];
for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  const teammate = row[4];
  if (!teammate) continue;

  const dateSerial = row[1];
  const description = (row[2] || '').toString().substring(0, 250);
  const rawAmount = row[3];
  const type = (row[6] || '').toString();

  if (!dateSerial || rawAmount === undefined || rawAmount === null) continue;
  const amount = Math.abs(parseFloat(rawAmount));
  if (!amount) continue;

  const payment_date = XLSX.SSF.format('yyyy-mm-dd', dateSerial);

  let payment_method = 'Other';
  if (description.toLowerCase().includes('zelle')) payment_method = 'Zelle';
  else if (description.toLowerCase().includes('payroll')) payment_method = 'Payroll';
  else if (type === 'WIRE_OUTGOING') payment_method = 'Wire';
  else if (type === 'CHECK_PAID') payment_method = 'Check';

  payments.push({
    employee_id: TEAMMATE_MAP[teammate] ?? null,
    teammate_name: teammate,
    payment_date,
    amount,
    description,
    payment_method,
  });
}

console.log(`Inserting ${payments.length} payments...`);

const { data, error } = await supabase.from('payments').insert(payments).select();
if (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

console.log(`✓ Imported ${data.length} payments\n`);

const byTeammate = {};
data.forEach((p) => {
  byTeammate[p.teammate_name] = (byTeammate[p.teammate_name] || 0) + parseFloat(p.amount);
});
Object.entries(byTeammate)
  .sort((a, b) => b[1] - a[1])
  .forEach(([name, total]) => console.log(`  ${name.padEnd(12)} $${total.toFixed(2)}`));
