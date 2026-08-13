-- Migration 0007: Promote runtime ALTER TABLE statements to a proper migration.
-- These columns were previously added via self-healing startup code in routes.ts.
-- All statements are idempotent (IF NOT EXISTS guards).

-- admins: auth session tracking columns
ALTER TABLE admins ADD COLUMN IF NOT EXISTS auth_token TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS auth_token_expires_at TIMESTAMP;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'admin';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- b2b_companies: login credential columns
ALTER TABLE b2b_companies ADD COLUMN IF NOT EXISTS b2b_email VARCHAR(255);
ALTER TABLE b2b_companies ADD COLUMN IF NOT EXISTS b2b_password_hash VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_b2b_companies_email
  ON b2b_companies(b2b_email)
  WHERE b2b_email IS NOT NULL;
