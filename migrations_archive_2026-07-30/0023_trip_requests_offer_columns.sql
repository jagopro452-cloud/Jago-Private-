-- dispatch.ts and routes.ts (driver incoming-trip / accept / reject / expiry) reference
-- trip_requests.offered_driver_id / offer_expires_at / offer_payload for the single-driver
-- offer-with-timeout dispatch model, but these columns were never migrated onto the table.
-- Every /api/app/driver/incoming-trip poll and dispatch offer/expiry cycle fails with
-- "column t.offered_driver_id does not exist" until this is applied.
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS offered_driver_id UUID;
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS offer_expires_at TIMESTAMP;
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS offer_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_trip_requests_offered_driver ON trip_requests(offered_driver_id) WHERE offered_driver_id IS NOT NULL;
