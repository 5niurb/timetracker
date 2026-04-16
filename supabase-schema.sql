-- LM PayTrack Database Schema for Supabase
-- Run this SQL in Supabase SQL Editor to create the database tables
-- Last updated: 2026-04-16 (synced with production schema)
--
-- NOTE: RLS is intentionally DISABLED on all tables. PayTrack uses
-- its own auth layer (admin password + PIN). Do NOT enable RLS without
-- adding permissive policies first or all anon-key queries will return
-- empty results (deny-all default when RLS is on with no policies).

-- ============ CORE TABLES ============

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  pin TEXT NOT NULL UNIQUE,
  email TEXT,
  phone TEXT,
  hourly_wage DECIMAL(10,2) DEFAULT 0,
  additional_pay_rate DECIMAL(10,2),
  rate_notes TEXT,
  commission_rate DECIMAL(10,2) DEFAULT 0,
  pay_type TEXT DEFAULT 'hourly',
  designation TEXT,
  contractor_type TEXT,
  start_date DATE,
  ic_agreement_signed BOOLEAN DEFAULT FALSE,
  ic_agreement_signed_at TIMESTAMP WITH TIME ZONE,
  onboarding_token TEXT,
  onboarding_completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS time_entries (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  date DATE NOT NULL,
  start_time TEXT,
  end_time TEXT,
  break_minutes INTEGER DEFAULT 0,
  hours DECIMAL(10,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS client_entries (
  id SERIAL PRIMARY KEY,
  time_entry_id INTEGER NOT NULL REFERENCES time_entries(id),
  client_name TEXT NOT NULL,
  procedure_name TEXT,
  notes TEXT,
  amount_earned DECIMAL(10,2) DEFAULT 0,
  tip_amount DECIMAL(10,2) DEFAULT 0,
  tip_received_cash BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_sales (
  id SERIAL PRIMARY KEY,
  time_entry_id INTEGER NOT NULL REFERENCES time_entries(id),
  product_name TEXT NOT NULL,
  sale_amount DECIMAL(10,2) DEFAULT 0,
  commission_amount DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  total_hours DECIMAL(10,2) DEFAULT 0,
  total_wages DECIMAL(10,2) DEFAULT 0,
  total_commissions DECIMAL(10,2) DEFAULT 0,
  total_tips DECIMAL(10,2) DEFAULT 0,
  total_product_commissions DECIMAL(10,2) DEFAULT 0,
  cash_tips_received DECIMAL(10,2) DEFAULT 0,
  total_payable DECIMAL(10,2) DEFAULT 0,
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  email_sent BOOLEAN DEFAULT FALSE
);

-- ============ ONBOARDING TABLE ============
-- Stores W-9, ID, license, insurance, banking info collected during worker onboarding.
-- Sensitive fields (TIN, routing, account) are AES-256-GCM encrypted server-side.
-- Only last-4 digits are stored in plaintext for display; encrypted blobs are opaque.

CREATE TABLE IF NOT EXISTS employee_onboarding (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  -- Personal info
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  middle_name TEXT,
  preferred_name TEXT,
  mobile_phone TEXT,
  date_of_birth DATE,

  -- Address
  address_street TEXT,
  address_city TEXT,
  address_state TEXT,
  address_zip TEXT,

  -- W-9 / Tax
  tin_type TEXT,                           -- 'ssn' or 'ein'
  tin_last4 TEXT,                          -- last 4 digits, plaintext
  tin_encrypted TEXT,                      -- AES-256-GCM encrypted TIN
  w9_entity_name TEXT,
  w9_tax_classification TEXT,
  w9_collected_at TIMESTAMP WITH TIME ZONE,

  -- Driver's license / Gov ID
  driver_license_number TEXT,
  driver_license_state TEXT,
  driver_license_upload_path TEXT,         -- Supabase Storage path

  -- Professional licenses (JSONB array of license objects)
  professional_licenses JSONB,

  -- Insurance (professional liability)
  insurer_name TEXT,
  insurance_policy_number TEXT,
  insurance_expiration DATE,
  insurance_upload_path TEXT,              -- Supabase Storage path
  prof_liability_per_occurrence NUMERIC,
  prof_liability_aggregate NUMERIC,

  -- Banking / payment
  bank_name TEXT,
  bank_account_owner_name TEXT,
  bank_account_type TEXT,                  -- 'checking' or 'savings'
  bank_routing_last4 TEXT,
  bank_account_last4 TEXT,
  bank_routing_encrypted TEXT,             -- AES-256-GCM; null for Zelle path
  bank_account_encrypted TEXT,             -- AES-256-GCM; null for Zelle path
  payment_method TEXT,                     -- 'zelle' or 'ach'
  zelle_contact TEXT,

  -- Schedule
  time_commitment_bucket TEXT,             -- 'under_15' | '15_to_25' | '25_to_35' | 'over_35'
  other_commitments TEXT,

  -- Attestation (IC agreement)
  attestation_checked BOOLEAN NOT NULL DEFAULT FALSE,
  attestation_signature TEXT NOT NULL,
  attestation_date DATE NOT NULL,

  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============ INDEXES ============

CREATE INDEX IF NOT EXISTS idx_time_entries_employee_id ON time_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(date);
CREATE INDEX IF NOT EXISTS idx_client_entries_time_entry_id ON client_entries(time_entry_id);
CREATE INDEX IF NOT EXISTS idx_product_sales_time_entry_id ON product_sales(time_entry_id);
CREATE INDEX IF NOT EXISTS idx_invoices_employee_id ON invoices(employee_id);
CREATE INDEX IF NOT EXISTS idx_invoices_pay_period ON invoices(pay_period_start, pay_period_end);
CREATE INDEX IF NOT EXISTS idx_onboarding_employee_id ON employee_onboarding(employee_id);
CREATE INDEX IF NOT EXISTS idx_employees_onboarding_token ON employees(onboarding_token);

-- ============ GRANTS ============
-- RLS is disabled; grant table access to anon + authenticated roles.

GRANT ALL ON employees TO anon, authenticated;
GRANT ALL ON time_entries TO anon, authenticated;
GRANT ALL ON client_entries TO anon, authenticated;
GRANT ALL ON product_sales TO anon, authenticated;
GRANT ALL ON invoices TO anon, authenticated;
GRANT ALL ON employee_onboarding TO anon, authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- ============ SAMPLE DATA ============

INSERT INTO employees (name, pin, hourly_wage, pay_type)
VALUES ('Sample Employee', '1234', 15.00, 'hourly')
ON CONFLICT (pin) DO NOTHING;
