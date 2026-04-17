-- migrations/006-flatten-employees.sql
-- Flatten employee_onboarding into employees table
-- Phase A: Add all employee_onboarding columns to employees

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS middle_name TEXT,
  ADD COLUMN IF NOT EXISTS preferred_name TEXT,
  ADD COLUMN IF NOT EXISTS mobile_phone TEXT,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS address_street TEXT,
  ADD COLUMN IF NOT EXISTS address_city TEXT,
  ADD COLUMN IF NOT EXISTS address_state TEXT,
  ADD COLUMN IF NOT EXISTS address_zip TEXT,
  ADD COLUMN IF NOT EXISTS tin_type TEXT CHECK (tin_type IN ('SSN', 'EIN')),
  ADD COLUMN IF NOT EXISTS tin_last4 TEXT,
  ADD COLUMN IF NOT EXISTS tin_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS w9_entity_name TEXT,
  ADD COLUMN IF NOT EXISTS w9_tax_classification TEXT,
  ADD COLUMN IF NOT EXISTS w9_collected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS driver_license_number TEXT,
  ADD COLUMN IF NOT EXISTS driver_license_state TEXT,
  ADD COLUMN IF NOT EXISTS driver_license_upload_path TEXT,
  ADD COLUMN IF NOT EXISTS professional_licenses JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS insurer_name TEXT,
  ADD COLUMN IF NOT EXISTS insurance_policy_number TEXT,
  ADD COLUMN IF NOT EXISTS insurance_expiration DATE,
  ADD COLUMN IF NOT EXISTS insurance_upload_path TEXT,
  ADD COLUMN IF NOT EXISTS prof_liability_per_occurrence NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS prof_liability_aggregate NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_owner_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_type TEXT,
  ADD COLUMN IF NOT EXISTS bank_routing_last4 TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_last4 TEXT,
  ADD COLUMN IF NOT EXISTS bank_routing_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT CHECK (payment_method IN ('zelle', 'ach')),
  ADD COLUMN IF NOT EXISTS zelle_contact TEXT,
  ADD COLUMN IF NOT EXISTS time_commitment_bucket TEXT CHECK (time_commitment_bucket IN ('under_15', '15_to_25', '25_to_35', 'over_35')),
  ADD COLUMN IF NOT EXISTS other_commitments TEXT,
  ADD COLUMN IF NOT EXISTS attestation_checked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS attestation_signature TEXT,
  ADD COLUMN IF NOT EXISTS attestation_date DATE,
  ADD COLUMN IF NOT EXISTS review_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_updated_at TIMESTAMPTZ;

-- Rename onboarding_token → review_token
ALTER TABLE employees RENAME COLUMN onboarding_token TO review_token;
ALTER TABLE employees RENAME COLUMN onboarding_completed_at TO review_completed_at;

-- Phase B: Migrate existing employee_onboarding data → employees
UPDATE employees e
SET
  first_name                    = eo.first_name,
  last_name                     = eo.last_name,
  middle_name                   = eo.middle_name,
  preferred_name                = eo.preferred_name,
  mobile_phone                  = COALESCE(e.phone, eo.mobile_phone),
  date_of_birth                 = eo.date_of_birth,
  address_street                = eo.address_street,
  address_city                  = eo.address_city,
  address_state                 = eo.address_state,
  address_zip                   = eo.address_zip,
  tin_type                      = eo.tin_type,
  tin_last4                     = eo.tin_last4,
  tin_encrypted                 = eo.tin_encrypted,
  w9_entity_name                = eo.w9_entity_name,
  w9_tax_classification         = eo.w9_tax_classification,
  w9_collected_at               = eo.w9_collected_at,
  driver_license_number         = eo.driver_license_number,
  driver_license_state          = eo.driver_license_state,
  driver_license_upload_path    = eo.driver_license_upload_path,
  professional_licenses         = eo.professional_licenses,
  insurer_name                  = eo.insurer_name,
  insurance_policy_number       = eo.insurance_policy_number,
  insurance_expiration          = eo.insurance_expiration,
  insurance_upload_path         = eo.insurance_upload_path,
  prof_liability_per_occurrence = eo.prof_liability_per_occurrence,
  prof_liability_aggregate      = eo.prof_liability_aggregate,
  bank_name                     = eo.bank_name,
  bank_account_owner_name       = eo.bank_account_owner_name,
  bank_account_type             = eo.bank_account_type,
  bank_routing_last4            = eo.bank_routing_last4,
  bank_account_last4            = eo.bank_account_last4,
  bank_routing_encrypted        = eo.bank_routing_encrypted,
  bank_account_encrypted        = eo.bank_account_encrypted,
  payment_method                = eo.payment_method,
  zelle_contact                 = eo.zelle_contact,
  time_commitment_bucket        = eo.time_commitment_bucket,
  other_commitments             = eo.other_commitments,
  attestation_checked           = eo.attestation_checked,
  attestation_signature         = eo.attestation_signature,
  attestation_date              = eo.attestation_date,
  review_submitted_at           = eo.submitted_at,
  data_updated_at               = eo.updated_at
FROM employee_onboarding eo
WHERE eo.employee_id = e.id;

-- Phase C: Add indexes
CREATE INDEX IF NOT EXISTS idx_employees_review_token ON employees(review_token);
CREATE INDEX IF NOT EXISTS idx_employees_tin_last4 ON employees(tin_last4);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);

-- Phase D: Drop old table
DROP TABLE IF EXISTS employee_onboarding;
