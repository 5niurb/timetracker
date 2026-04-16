-- ============================================================
-- Migration 004: Onboarding v2 — job info, uploads, simplification
-- Created: 2026-04-15
-- Changes:
--   1. New columns on employees: additional_pay_rate, rate_notes
--   2. New columns on employee_onboarding: mobile_phone,
--      driver_license_state, driver_license_upload_path,
--      professional_licenses (JSONB), insurance_policy_number,
--      insurance_upload_path
--   3. Drop removed columns (safe — 0 rows in table):
--      home_phone, work_phone, other_email, w9_exempt_payee_code,
--      w9_signed_at, license_number, license_expiration,
--      certifications, driver_license_no, driver_license_expiry,
--      exhibit_a_rate, exhibit_a_rate_notes, services_offered
-- ============================================================

-- ============================================================
-- PART 1: Extend employees table
-- ============================================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS additional_pay_rate DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS rate_notes TEXT;

-- ============================================================
-- PART 2: Add new columns to employee_onboarding
-- ============================================================

ALTER TABLE employee_onboarding
  ADD COLUMN IF NOT EXISTS mobile_phone TEXT,
  ADD COLUMN IF NOT EXISTS driver_license_state TEXT,
  ADD COLUMN IF NOT EXISTS driver_license_upload_path TEXT,
  ADD COLUMN IF NOT EXISTS professional_licenses JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS insurance_policy_number TEXT,
  ADD COLUMN IF NOT EXISTS insurance_upload_path TEXT;

-- ============================================================
-- PART 3: Drop removed columns (safe — 0 rows in table)
-- ============================================================

ALTER TABLE employee_onboarding
  DROP COLUMN IF EXISTS home_phone,
  DROP COLUMN IF EXISTS work_phone,
  DROP COLUMN IF EXISTS other_email,
  DROP COLUMN IF EXISTS w9_exempt_payee_code,
  DROP COLUMN IF EXISTS w9_signed_at,
  DROP COLUMN IF EXISTS license_number,
  DROP COLUMN IF EXISTS license_expiration,
  DROP COLUMN IF EXISTS certifications,
  DROP COLUMN IF EXISTS driver_license_no,
  DROP COLUMN IF EXISTS driver_license_expiry,
  DROP COLUMN IF EXISTS exhibit_a_rate,
  DROP COLUMN IF EXISTS exhibit_a_rate_notes,
  DROP COLUMN IF EXISTS services_offered;

-- ============================================================
-- PART 4: Create onboarding-documents storage bucket
-- (run separately in Supabase dashboard if storage API not used)
-- INSERT INTO storage.buckets (id, name, public)
--   VALUES ('onboarding-documents', 'onboarding-documents', false)
--   ON CONFLICT (id) DO NOTHING;
-- ============================================================

-- ============================================================
-- ROLLBACK (paste separately if needed)
-- ============================================================
-- ALTER TABLE employees DROP COLUMN IF EXISTS additional_pay_rate, DROP COLUMN IF EXISTS rate_notes;
-- ALTER TABLE employee_onboarding
--   DROP COLUMN IF EXISTS mobile_phone,
--   DROP COLUMN IF EXISTS driver_license_state,
--   DROP COLUMN IF EXISTS driver_license_upload_path,
--   DROP COLUMN IF EXISTS professional_licenses,
--   DROP COLUMN IF EXISTS insurance_policy_number,
--   DROP COLUMN IF EXISTS insurance_upload_path;
