-- outstation-pool-v2.ts's driver location broadcast (PATCH /api/app/driver/outstation-pool/rides/:id/location)
-- and several customer-facing SELECTs reference outstation_pool_rides.current_lat/current_lng for live
-- tracking, but the columns were never migrated onto the table.
ALTER TABLE outstation_pool_rides ADD COLUMN IF NOT EXISTS current_lat DOUBLE PRECISION;
ALTER TABLE outstation_pool_rides ADD COLUMN IF NOT EXISTS current_lng DOUBLE PRECISION;
