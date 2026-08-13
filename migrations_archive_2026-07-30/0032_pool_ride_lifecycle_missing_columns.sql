-- The real "Local Pool" rolling-pickup lifecycle (server/rolling-pool.ts) has never worked
-- end-to-end: driver accept, pickup, drop, cancel, and session-end all reference columns that
-- were never created, causing every step to fail with "column ... does not exist" (verified
-- live, one at a time, while testing the full booking -> accept -> pickup -> drop chain).
ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS matched_at TIMESTAMP;
ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMP;
ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS dropped_at TIMESTAMP;
ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE driver_pool_sessions ADD COLUMN IF NOT EXISTS total_passengers_served INTEGER NOT NULL DEFAULT 0;
ALTER TABLE driver_pool_sessions ADD COLUMN IF NOT EXISTS total_earnings NUMERIC(10,2) NOT NULL DEFAULT 0;
