-- OTP send/verify (server/auth/otp.service.ts, server/auth/otp.repo.ts) has
-- referenced this table since it was written, but no migration ever created it —
-- every OTP send request failed with "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification" because otp_codes didn't exist at all.
-- One active OTP per (phone, country_code): a new send replaces the prior code
-- via ON CONFLICT DO UPDATE in replaceOtpCode(), which requires the unique
-- constraint below.
CREATE TABLE IF NOT EXISTS public.otp_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(10) NOT NULL,
    country_code VARCHAR(8) NOT NULL DEFAULT '+91',
    otp_hash TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT otp_codes_phone_country_unique UNIQUE (phone, country_code)
);
--> statement-breakpoint
-- countRecentOtpRequests() and the expiry sweep both filter by phone+country_code+
-- created_at; the unique constraint above already covers phone+country_code, this
-- adds the created_at range scan.
CREATE INDEX IF NOT EXISTS idx_otp_codes_created_at ON public.otp_codes (created_at);
