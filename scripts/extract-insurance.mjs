// scripts/extract-insurance.mjs
// Uses Claude Haiku vision to read COI (Certificate of Insurance) PDFs from Supabase Storage
// Extracts: insurer_name, policy_number, expiration, per_occurrence, aggregate
//
// Prerequisites:
//   npm install --save-dev @anthropic-ai/sdk
//
// Run:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
//   node scripts/extract-insurance.mjs
//
// Processes employees who have insurance_upload_path but missing insurer_name.
// Safe to re-run: skips employees already filled in.

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const { data: employees, error: fetchErr } = await supabase
  .from('employees')
  .select('id, name, insurance_upload_path')
  .not('insurance_upload_path', 'is', null)
  .is('insurer_name', null);

if (fetchErr) { console.error('Failed to fetch employees:', fetchErr.message); process.exit(1); }
if (!employees?.length) { console.log('No employees with unprocessed insurance PDFs.'); process.exit(0); }

console.log(`Processing ${employees.length} employee(s)…`);

for (const emp of employees) {
  const { data: fileData, error: dlErr } = await supabase.storage
    .from('onboarding-documents')
    .download(emp.insurance_upload_path);

  if (dlErr) { console.error(`SKIP ${emp.name}: storage download error —`, dlErr.message); continue; }

  const buffer = Buffer.from(await fileData.arrayBuffer());
  const base64 = buffer.toString('base64');

  let msg;
  try {
    msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          },
          {
            type: 'text',
            text: `Extract these fields from this Certificate of Insurance. Return JSON only, no explanation:
{
  "insurer_name": "string or null",
  "policy_number": "string or null",
  "expiration_date": "YYYY-MM-DD or null",
  "per_occurrence": number_or_null,
  "aggregate": number_or_null
}
If a field is not visible, use null.`,
          },
        ],
      }],
    });
  } catch (e) {
    console.error(`SKIP ${emp.name}: Haiku API error —`, e.message);
    continue;
  }

  let extracted;
  try {
    extracted = JSON.parse(msg.content[0].text);
  } catch {
    console.error(`SKIP ${emp.name}: could not parse Haiku response — "${msg.content[0].text}"`);
    continue;
  }

  const update = {};
  if (extracted.insurer_name) update.insurer_name = extracted.insurer_name;
  if (extracted.policy_number) update.insurance_policy_number = extracted.policy_number;
  if (extracted.expiration_date) update.insurance_expiration = extracted.expiration_date;
  if (extracted.per_occurrence != null) update.prof_liability_per_occurrence = extracted.per_occurrence;
  if (extracted.aggregate != null) update.prof_liability_aggregate = extracted.aggregate;

  if (Object.keys(update).length === 0) {
    console.log(`NO DATA ${emp.name}: Haiku found nothing to extract`);
    continue;
  }

  const { error: upErr } = await supabase.from('employees').update(update).eq('id', emp.id);
  if (upErr) console.error(`ERROR ${emp.name}:`, upErr.message);
  else console.log(`OK ${emp.name}:`, JSON.stringify(update));
}
