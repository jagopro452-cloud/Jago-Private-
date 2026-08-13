-- Production hardening migration
-- Run once on Neon before going live.
-- All statements are safe to re-run (IF NOT EXISTS / DO $$...END $$).

-- C6: Unique phone constraint (prevents duplicate accounts)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_users_phone'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT uq_users_phone UNIQUE (phone);
  END IF;
END $$;

-- C6: Unique email constraint (NULL allowed, but non-NULL emails must be unique)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_notnull
  ON users(email) WHERE email IS NOT NULL;

-- DB: One active trip per customer (prevents double-booking race at DB level)
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_trip_per_customer
  ON trip_requests(customer_id)
  WHERE current_status IN ('searching', 'driver_assigned', 'accepted', 'arrived', 'on_the_way');

-- DB: One active trip per driver (prevents dispatch to already-busy driver)
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_trip_per_driver
  ON trip_requests(driver_id)
  WHERE driver_id IS NOT NULL
    AND current_status IN ('driver_assigned', 'accepted', 'arrived', 'on_the_way');

-- H13: Index for reaper and admin queries ordered by creation time
CREATE INDEX IF NOT EXISTS idx_trip_requests_created_at
  ON trip_requests(created_at DESC);

-- H14: Index for zone-based dispatch queries
CREATE INDEX IF NOT EXISTS idx_trip_requests_zone_id
  ON trip_requests(zone_id) WHERE zone_id IS NOT NULL;

-- Pool indexes
-- Guarded: local_pool_passengers does not exist against production's real
-- schema (the current local-pool feature uses pool_ride_requests /
-- driver_pool_sessions instead — see rolling-pool.ts). CREATE INDEX IF NOT
-- EXISTS only guards against the index already existing, not against the
-- referenced table being absent, so this bare statement previously aborted
-- the whole migration chain with "relation does not exist" on any database
-- that never had this table. Left conditional rather than retargeted to a
-- different table, since that would be a guess this reconciliation isn't
-- backed by evidence for.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='local_pool_passengers') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pool_passengers_ride_id ON local_pool_passengers(pool_ride_id, status)';
  END IF;
END $$;

-- Outstation pool indexes
CREATE INDEX IF NOT EXISTS idx_outstation_bookings_ride_id
  ON outstation_pool_bookings(ride_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outstation_bookings_no_dup
  ON outstation_pool_bookings(ride_id, customer_id)
  WHERE status NOT IN ('cancelled');

-- FK constraints (add if not present)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_trip_requests_customer_id'
  ) THEN
    ALTER TABLE trip_requests
      ADD CONSTRAINT fk_trip_requests_customer_id
      FOREIGN KEY (customer_id) REFERENCES users(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_trip_requests_driver_id'
  ) THEN
    ALTER TABLE trip_requests
      ADD CONSTRAINT fk_trip_requests_driver_id
      FOREIGN KEY (driver_id) REFERENCES users(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_trip_requests_vehicle_category_id'
  ) THEN
    ALTER TABLE trip_requests
      ADD CONSTRAINT fk_trip_requests_vehicle_category_id
      FOREIGN KEY (vehicle_category_id) REFERENCES vehicle_categories(id);
  END IF;
END $$;

-- OTP indexes for fast lookup + expiry checks
CREATE INDEX IF NOT EXISTS idx_otp_codes_phone_expiry
  ON otp_codes(phone, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_otp_logs_phone_type
  ON otp_logs(phone, user_type, created_at DESC);

-- Session indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON sessions(user_id, expires_at) WHERE revoked = false;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user
  ON refresh_tokens(user_id, expires_at) WHERE revoked = false;
