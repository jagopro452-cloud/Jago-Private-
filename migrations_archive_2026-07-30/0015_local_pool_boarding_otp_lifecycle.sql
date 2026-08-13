ALTER TABLE IF EXISTS pool_ride_requests
  ADD COLUMN IF NOT EXISTS boarding_otp_issued_at TIMESTAMP;

ALTER TABLE IF EXISTS pool_ride_requests
  ADD COLUMN IF NOT EXISTS boarding_otp_expires_at TIMESTAMP;

ALTER TABLE IF EXISTS pool_ride_requests
  ADD COLUMN IF NOT EXISTS boarding_otp_used_at TIMESTAMP;

UPDATE pool_ride_requests
SET boarding_otp_issued_at = COALESCE(boarding_otp_issued_at, searched_at, created_at, NOW())
WHERE boarding_otp IS NOT NULL
  AND boarding_otp_issued_at IS NULL;

UPDATE pool_ride_requests
SET boarding_otp_expires_at = COALESCE(
  boarding_otp_expires_at,
  boarding_otp_issued_at + INTERVAL '45 seconds',
  searched_at + INTERVAL '45 seconds',
  created_at + INTERVAL '45 seconds',
  NOW()
)
WHERE boarding_otp IS NOT NULL
  AND boarding_otp_expires_at IS NULL;
