-- Add payment_method to plaid_pending (may already exist from ad-hoc session DDL)
ALTER TABLE plaid_pending ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- Add source + comments to plaid_pending for tracking
ALTER TABLE plaid_pending ADD COLUMN IF NOT EXISTS source TEXT;

-- Add source column to payments if not present
ALTER TABLE payments ADD COLUMN IF NOT EXISTS source TEXT;

-- Add comments column to payments if not present
ALTER TABLE payments ADD COLUMN IF NOT EXISTS comments TEXT;

-- Allow teammate_name to be nullable (Plaid auto-imports populate via employee join, not by name)
ALTER TABLE payments ALTER COLUMN teammate_name DROP NOT NULL;

-- App settings key-value store for persisting Plaid access token across deploys
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
