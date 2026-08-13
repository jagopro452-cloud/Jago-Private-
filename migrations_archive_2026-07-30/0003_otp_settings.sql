-- Dual OTP Authentication System
-- Controls which OTP provider is used (SMS / Firebase) and security rules

CREATE TABLE IF NOT EXISTS otp_settings (
  id                  SERIAL PRIMARY KEY,
  primary_provider    VARCHAR(20)  NOT NULL DEFAULT 'sms',    -- 'sms' | 'firebase'
  sms_enabled         BOOLEAN      NOT NULL DEFAULT true,
  firebase_enabled    BOOLEAN      NOT NULL DEFAULT true,
  fallback_enabled    BOOLEAN      NOT NULL DEFAULT true,     -- auto-switch on failure
  otp_expiry_seconds  INT          NOT NULL DEFAULT 120,      -- 2 minutes
  max_attempts        INT          NOT NULL DEFAULT 3,
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed default row (only if table is empty) — Firebase-only, no SMS
INSERT INTO otp_settings
  (primary_provider, sms_enabled, firebase_enabled, fallback_enabled, otp_expiry_seconds, max_attempts)
SELECT 'firebase', false, true, false, 120, 3
WHERE NOT EXISTS (SELECT 1 FROM otp_settings);
