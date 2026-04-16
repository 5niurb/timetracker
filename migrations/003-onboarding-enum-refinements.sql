-- ============================================================
-- Migration 003: Onboarding enum refinements
-- Created: 2026-04-16
-- Changes:
--   1. Replace time_commitment_hours_per_week (INTEGER) with
--      time_commitment_bucket (TEXT ENUM of 4 values).
--      No real data exists yet so we drop the old column cleanly.
--   2. Add CHECK constraint on payment_method restricting to
--      'zelle' | 'ach' (drops old values: direct_deposit, check).
-- ============================================================

-- PART 1: Replace time_commitment_hours_per_week with bucketed ENUM
ALTER TABLE employee_onboarding
  DROP COLUMN IF EXISTS time_commitment_hours_per_week;

ALTER TABLE employee_onboarding
  ADD COLUMN IF NOT EXISTS time_commitment_bucket TEXT
    CHECK (time_commitment_bucket IN ('under_15', '15_to_25', '25_to_35', 'over_35'));

-- PART 2: Constrain payment_method to zelle | ach
-- Must drop existing column-level constraint if any, then re-add.
-- Supabase: column constraints added inline at creation cannot be
-- altered in-place; we need a named table-level check constraint.

-- Remove any prior inline check (safe no-op if none existed)
ALTER TABLE employee_onboarding
  DROP CONSTRAINT IF EXISTS employee_onboarding_payment_method_check;

ALTER TABLE employee_onboarding
  ADD CONSTRAINT employee_onboarding_payment_method_check
    CHECK (payment_method IN ('zelle', 'ach'));

-- ============================================================
-- ROLLBACK (paste separately if needed)
-- ============================================================
-- ALTER TABLE employee_onboarding DROP CONSTRAINT IF EXISTS employee_onboarding_payment_method_check;
-- ALTER TABLE employee_onboarding DROP COLUMN IF EXISTS time_commitment_bucket;
-- ALTER TABLE employee_onboarding ADD COLUMN IF NOT EXISTS time_commitment_hours_per_week INTEGER;
