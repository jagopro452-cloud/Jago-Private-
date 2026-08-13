-- Driver accept-passenger route (server/rolling-pool.ts, POST
-- /api/app/driver/pool/passengers/:requestId/accept) unconditionally increments
-- assignment_version on pool_ride_requests, but this column never existed — every driver
-- accept attempt on a real Local Pool (rolling-pickup) request failed with
-- "column assignment_version does not exist" (verified live). This completely blocked the
-- pickup-OTP/drop flow that depends on the request reaching 'matched' status first.
ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS assignment_version INTEGER NOT NULL DEFAULT 0;
