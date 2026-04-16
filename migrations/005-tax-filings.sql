-- Migration 005: Tax Filings table
-- Stores 1099-NEC and other annual tax filing data.
-- Maps to Avalara/Track1099 CSV template columns.
-- Designed for 10+ years of historical data per contractor.
-- TIN is AES-256-GCM encrypted server-side; only last-4 stored in plaintext.

CREATE TABLE IF NOT EXISTS public.tax_filings (
  id                          bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  employee_id                 integer     REFERENCES employees(id) ON DELETE SET NULL,
  tax_year                    smallint    NOT NULL,
  form_type                   text        NOT NULL DEFAULT '1099-NEC',
  filing_status               text        NOT NULL DEFAULT 'draft', -- draft | ready | filed | corrected
  filed_at                    timestamptz,

  -- Payer info
  payer_name                  text        NOT NULL DEFAULT 'LM Operations Inc',
  payer_ein                   text,
  payer_state_no              text,

  -- Recipient identity
  reference_id                text,
  recipient_name              text        NOT NULL,
  recipient_second_name       text,
  federal_id_type             smallint,   -- 1=EIN 2=SSN 3=ITIN 4=ATIN
  tin_last4                   text,
  tin_encrypted               text,       -- AES-256-GCM encrypted TIN
  second_tin_notice           boolean     NOT NULL DEFAULT false,
  account_number              text,
  office_code                 text,

  -- Address
  address_street              text,
  address_street2             text,
  address_city                text,
  address_state               text,
  address_zip                 text,
  address_province            text,
  address_country_code        text        DEFAULT 'US',
  recipient_email             text,

  -- 1099-NEC boxes
  box_1_nonemployee_comp      numeric(12,2) NOT NULL DEFAULT 0,
  box_2_direct_sales          boolean     NOT NULL DEFAULT false,
  box_3_golden_parachute      numeric(12,2),
  box_4_federal_tax_withheld  numeric(12,2),
  box_5_state_tax_withheld    numeric(12,2),
  box_6_state                 text,
  box_7_state_income          numeric(12,2),
  box_5b_local_tax_withheld   numeric(12,2),
  box_6b_locality             text,
  box_6b_locality_no          text,
  box_7b_local_income         numeric(12,2),

  source                      text,       -- 'manual' | 'csv_import' | 'calculated'
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- Prevent duplicate filings for the same employee+year+form combination
CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_filings_unique_filing
  ON public.tax_filings (employee_id, tax_year, form_type)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tax_filings_employee_id ON public.tax_filings(employee_id);
CREATE INDEX IF NOT EXISTS idx_tax_filings_year ON public.tax_filings(tax_year);

ALTER TABLE public.tax_filings ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.tax_filings TO anon, authenticated;
