-- LM PayTrack Database Schema for Supabase
-- Run this SQL in Supabase SQL Editor to create the database tables

-- Create employees table
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  pin TEXT NOT NULL UNIQUE,
  email TEXT,
  hourly_wage DECIMAL(10,2) DEFAULT 0,
  commission_rate DECIMAL(10,2) DEFAULT 0,
  pay_type TEXT DEFAULT 'hourly',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create time_entries table
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

-- Create client_entries table (for service commissions & tips)
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

-- Create product_sales table (for sales commissions)
CREATE TABLE IF NOT EXISTS product_sales (
  id SERIAL PRIMARY KEY,
  time_entry_id INTEGER NOT NULL REFERENCES time_entries(id),
  product_name TEXT NOT NULL,
  sale_amount DECIMAL(10,2) DEFAULT 0,
  commission_amount DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create invoices table
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

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_time_entries_employee_id ON time_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(date);
CREATE INDEX IF NOT EXISTS idx_client_entries_time_entry_id ON client_entries(time_entry_id);
CREATE INDEX IF NOT EXISTS idx_product_sales_time_entry_id ON product_sales(time_entry_id);
CREATE INDEX IF NOT EXISTS idx_invoices_employee_id ON invoices(employee_id);
CREATE INDEX IF NOT EXISTS idx_invoices_pay_period ON invoices(pay_period_start, pay_period_end);

-- Enable Row Level Security (optional but recommended)
-- ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE client_entries ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE product_sales ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Insert sample employee (for testing)
INSERT INTO employees (name, pin, hourly_wage, pay_type)
VALUES ('Sample Employee', '1234', 15.00, 'hourly')
ON CONFLICT (pin) DO NOTHING;

-- Grant access to anon and authenticated users (Supabase default)
GRANT ALL ON employees TO anon, authenticated;
GRANT ALL ON time_entries TO anon, authenticated;
GRANT ALL ON client_entries TO anon, authenticated;
GRANT ALL ON product_sales TO anon, authenticated;
GRANT ALL ON invoices TO anon, authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
