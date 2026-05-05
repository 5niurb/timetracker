-- Run in Supabase SQL Editor
-- Migration 007: Compliance schema (compliance_requests + compliance_documents tables
--                + new columns on employees)
-- NOTE: employee_id uses INTEGER (not uuid) to match employees.id SERIAL PRIMARY KEY
--
-- If migration 007 was already applied without the fixes below, run these manually:
--   ALTER TABLE compliance_requests ALTER COLUMN employee_id SET NOT NULL;
--   ALTER TABLE compliance_documents ALTER COLUMN employee_id SET NOT NULL;
--   ALTER TABLE compliance_requests ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE compliance_documents ENABLE ROW LEVEL SECURITY;
--   GRANT ALL ON compliance_requests TO anon, authenticated;
--   GRANT ALL ON compliance_documents TO anon, authenticated;
--   CREATE INDEX IF NOT EXISTS idx_compliance_docs_type ON compliance_documents(document_type);

-- Token-based compliance requests (one per active link)
-- NOTE: Single-use enforcement (token expires after used_at is set) is application-enforced
--       in routes/compliance.js. The DB records when it was used but does not block reuse directly.
CREATE TABLE IF NOT EXISTS compliance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('upload', 'esign')),
  document_type text NOT NULL CHECK (document_type IN ('coi', 'w9', 'contract')),
  token text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_requests_token ON compliance_requests(token);
CREATE INDEX IF NOT EXISTS idx_compliance_requests_employee ON compliance_requests(employee_id);

ALTER TABLE compliance_requests ENABLE ROW LEVEL SECURITY;

-- Document records (one per submitted document)
CREATE TABLE IF NOT EXISTS compliance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_compliance_docs_type ON compliance_documents(document_type);

ALTER TABLE compliance_documents ENABLE ROW LEVEL SECURITY;

GRANT ALL ON compliance_requests TO anon, authenticated;
GRANT ALL ON compliance_documents TO anon, authenticated;

-- Add compliance columns to employees
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS coi_expiry date,
  ADD COLUMN IF NOT EXISTS coi_insurer text,
  ADD COLUMN IF NOT EXISTS professional_license_number text,
  ADD COLUMN IF NOT EXISTS professional_license_type text,
  ADD COLUMN IF NOT EXISTS professional_license_expiry date,
  ADD COLUMN IF NOT EXISTS w9_signed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS contract_signed boolean DEFAULT false;
