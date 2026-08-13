-- Registration schema standardization
-- Aligns live production tables with the app/backend registration contract.

-- users: backfill and standardize canonical registration columns.
ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type VARCHAR(25) DEFAULT 'customer';
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_token_expires_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_status VARCHAR(30) NOT NULL DEFAULT 'pending';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS license_number VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS license_expiry DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(60);
ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_model VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_brand VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_color VARCHAR(60);
ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_year INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS selfie_image TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_status VARCHAR(30) DEFAULT 'pending';
ALTER TABLE users ADD COLUMN IF NOT EXISTS rejection_note TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT;

UPDATE users
SET
  phone = COALESCE(NULLIF(phone, ''), NULLIF(mobile, '')),
  mobile = COALESCE(NULLIF(mobile, ''), NULLIF(phone, '')),
  full_name = COALESCE(NULLIF(full_name, ''), NULLIF(name, ''), full_name),
  name = COALESCE(NULLIF(name, ''), NULLIF(full_name, ''), name),
  role = COALESCE(NULLIF(role, ''), 'user'),
  user_type = COALESCE(NULLIF(user_type, ''), CASE WHEN role IN ('driver', 'pilot') THEN 'driver' ELSE 'customer' END),
  verification_status = COALESCE(NULLIF(verification_status, ''), CASE WHEN COALESCE(user_type, '') = 'driver' THEN 'pending' ELSE 'verified' END),
  is_active = COALESCE(is_active, true),
  updated_at = COALESCE(updated_at, NOW());

-- customer_profiles: one row per customer account.
CREATE TABLE IF NOT EXISTS customer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city VARCHAR(120),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_profiles_user_id ON customer_profiles(user_id);

INSERT INTO customer_profiles (user_id, city, created_at, updated_at)
SELECT u.id, u.city, NOW(), NOW()
FROM users u
LEFT JOIN customer_profiles cp ON cp.user_id = u.id
WHERE cp.user_id IS NULL
  AND COALESCE(u.user_type, 'customer') = 'customer';

-- vehicles: one current vehicle profile per driver account.
CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type VARCHAR(60),
  brand VARCHAR(120),
  model VARCHAR(120),
  color VARCHAR(60),
  vehicle_year INTEGER,
  registration_number VARCHAR(60),
  verification_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_user_id ON vehicles(user_id);

INSERT INTO vehicles (
  user_id, vehicle_type, brand, model, color, vehicle_year, registration_number, verification_status, created_at, updated_at
)
SELECT
  u.id,
  'bike',
  u.vehicle_brand,
  u.vehicle_model,
  u.vehicle_color,
  u.vehicle_year,
  u.vehicle_number,
  COALESCE(NULLIF(u.verification_status, ''), 'pending'),
  NOW(),
  NOW()
FROM users u
LEFT JOIN vehicles v ON v.user_id = u.id
WHERE v.user_id IS NULL
  AND COALESCE(u.user_type, '') = 'driver';

-- driver_details: add canonical columns used by onboarding flow.
ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(60);
ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

UPDATE driver_details dd
SET
  vehicle_type = COALESCE(NULLIF(dd.vehicle_type, ''), 'bike'),
  updated_at = COALESCE(dd.updated_at, NOW())
FROM users u
WHERE u.id = dd.user_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_details_user_id ON driver_details(user_id);

-- driver_documents: keep legacy columns, add canonical ones, dedupe before unique index.
ALTER TABLE driver_documents ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE driver_documents ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'pending';
ALTER TABLE driver_documents ADD COLUMN IF NOT EXISTS admin_note TEXT;
ALTER TABLE driver_documents ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
ALTER TABLE driver_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE driver_documents ADD COLUMN IF NOT EXISTS expiry_date DATE;

UPDATE driver_documents
SET
  file_url = COALESCE(NULLIF(file_url, ''), NULLIF(doc_url, '')),
  doc_url = COALESCE(NULLIF(doc_url, ''), NULLIF(file_url, '')),
  status = COALESCE(NULLIF(status, ''), NULLIF(verification_status, ''), 'pending'),
  verification_status = COALESCE(NULLIF(verification_status, ''), NULLIF(status, ''), 'pending'),
  updated_at = COALESCE(updated_at, NOW());

DELETE FROM driver_documents dd
USING driver_documents newer
WHERE dd.driver_id = newer.driver_id
  AND dd.doc_type = newer.doc_type
  AND (
    COALESCE(dd.updated_at, dd.created_at, NOW()) < COALESCE(newer.updated_at, newer.created_at, NOW())
    OR (
      COALESCE(dd.updated_at, dd.created_at, NOW()) = COALESCE(newer.updated_at, newer.created_at, NOW())
      AND dd.ctid < newer.ctid
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_documents_driver_doc_type
  ON driver_documents(driver_id, doc_type);

-- documents: ensure registration uploads can upsert cleanly.
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  document_type VARCHAR(100),
  doc_url TEXT,
  submitted_at TIMESTAMP DEFAULT NOW(),
  status VARCHAR(30) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP DEFAULT NOW();
ALTER TABLE documents ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'pending';

DELETE FROM documents d
USING documents newer
WHERE d.user_id = newer.user_id
  AND d.document_type = newer.document_type
  AND (
    COALESCE(d.submitted_at, NOW()) < COALESCE(newer.submitted_at, NOW())
    OR (
      COALESCE(d.submitted_at, NOW()) = COALESCE(newer.submitted_at, NOW())
      AND d.ctid < newer.ctid
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_user_document_type
  ON documents(user_id, document_type);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_driver_details_user_id_users'
  ) THEN
    ALTER TABLE driver_details
      ADD CONSTRAINT fk_driver_details_user_id_users
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_driver_documents_driver_id_users'
  ) THEN
    ALTER TABLE driver_documents
      ADD CONSTRAINT fk_driver_documents_driver_id_users
      FOREIGN KEY (driver_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;
