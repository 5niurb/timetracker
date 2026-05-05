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
  if (!storage_path) throw new Error('extractCOI: storage_path is required');
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
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const jsonMatch = stripped.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON found in Haiku response for: ${storage_path}`);

  return JSON.parse(jsonMatch[0]);
}
