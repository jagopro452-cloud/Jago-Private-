-- Phase 4, P0 fix — ratings never worked at any level.
--
-- Neither trip_requests.driver_rating nor trip_requests.customer_rating
-- exist anywhere in the schema, yet both are read and written by real, live
-- code:
--   - customer/rate-driver and driver/rate-customer (server/routes.ts) write
--     them as the per-trip rating record and duplicate-submission guard.
--   - GET /api/app/driver/performance (routes.ts ~15106) reads
--     AVG(driver_rating) for a driver's current-month rating average - a
--     distinct metric from the lifetime users.rating average.
-- Every one of these has thrown "column does not exist" on every real call
-- (rating submission, and the driver performance screen) since ratings were
-- ever added. Genuinely needed, not outdated code - added rather than
-- redesigned away, matching the existing per-trip financial/rating
-- breakdown convention (see gst_amount/insurance_amount, migration 0009).
ALTER TABLE public.trip_requests
  ADD COLUMN IF NOT EXISTS driver_rating numeric(2,1),
  ADD COLUMN IF NOT EXISTS customer_rating numeric(2,1);
