-- Core franchise tables (idempotent for fresh + existing installs)
CREATE TABLE IF NOT EXISTS franchisees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  owner_name VARCHAR(255) NOT NULL,
  email VARCHAR(191) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(30),
  whatsapp VARCHAR(30),
  zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
  commission_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
  commission_percent NUMERIC(8,2) DEFAULT 0,
  commission_flat NUMERIC(10,2) DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  address TEXT,
  city VARCHAR(120),
  state VARCHAR(120),
  pincode VARCHAR(12),
  bank_name VARCHAR(120),
  bank_account VARCHAR(64),
  bank_ifsc VARCHAR(20),
  bank_holder_name VARCHAR(120),
  gst_number VARCHAR(20),
  pan_number VARCHAR(20),
  agreement_date DATE,
  contract_end_date DATE,
  min_guaranteed NUMERIC(12,2) DEFAULT 0,
  payout_cycle VARCHAR(20) DEFAULT 'monthly',
  total_paid_out NUMERIC(14,2) DEFAULT 0,
  notes TEXT,
  photo_url TEXT,
  alt_contact_name VARCHAR(120),
  alt_contact_phone VARCHAR(30),
  franchise_type VARCHAR(30) DEFAULT 'area',
  service_area_desc TEXT,
  website TEXT,
  auth_token TEXT,
  auth_token_expires_at TIMESTAMP,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE franchisees ADD COLUMN IF NOT EXISTS state VARCHAR(120);
ALTER TABLE franchisees ADD COLUMN IF NOT EXISTS service_area_desc TEXT;
ALTER TABLE franchisees ADD COLUMN IF NOT EXISTS franchise_type VARCHAR(30) DEFAULT 'area';
ALTER TABLE franchisees ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE franchisees ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE franchisees ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(30);
ALTER TABLE franchisees ADD COLUMN IF NOT EXISTS alt_contact_name VARCHAR(120);
ALTER TABLE franchisees ADD COLUMN IF NOT EXISTS alt_contact_phone VARCHAR(30);
ALTER TABLE franchisees ADD COLUMN IF NOT EXISTS bank_holder_name VARCHAR(120);
ALTER TABLE franchisees ADD COLUMN IF NOT EXISTS min_guaranteed NUMERIC(12,2) DEFAULT 0;
ALTER TABLE franchisees ADD COLUMN IF NOT EXISTS payout_cycle VARCHAR(20) DEFAULT 'monthly';
ALTER TABLE franchisees ADD COLUMN IF NOT EXISTS total_paid_out NUMERIC(14,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS franchise_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  franchisee_id UUID NOT NULL REFERENCES franchisees(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  period_start DATE,
  period_end DATE,
  status VARCHAR(20) DEFAULT 'paid',
  payment_method VARCHAR(40),
  payment_ref VARCHAR(120),
  notes TEXT,
  paid_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchisees_zone_active ON franchisees(zone_id, is_active);
CREATE INDEX IF NOT EXISTS idx_franchise_payouts_franchisee ON franchise_payouts(franchisee_id);
