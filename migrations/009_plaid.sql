-- Add zelle_name alias to employees for Plaid transaction matching
ALTER TABLE employees ADD COLUMN IF NOT EXISTS zelle_name TEXT;

-- Hold unmatched Plaid transactions awaiting manual assignment
CREATE TABLE IF NOT EXISTS plaid_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plaid_transaction_id TEXT UNIQUE NOT NULL,
  transaction_date DATE NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Mark auto-imported payments and prevent duplicate imports
ALTER TABLE payments ADD COLUMN IF NOT EXISTS auto_imported BOOLEAN DEFAULT false;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS plaid_transaction_id TEXT UNIQUE;

-- Index for fast pending lookups
CREATE INDEX IF NOT EXISTS idx_plaid_pending_created ON plaid_pending(created_at DESC);

-- Index for fast auto-import lookups
CREATE INDEX IF NOT EXISTS idx_payments_auto_imported ON payments(auto_imported) WHERE auto_imported = true;
