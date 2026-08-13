-- outstation-pool-v2.ts's search query, accepting-toggle route, and ride creation all
-- reference outstation_pool_rides.accepting_new_requests, but the column was never migrated onto the table.
ALTER TABLE outstation_pool_rides ADD COLUMN IF NOT EXISTS accepting_new_requests BOOLEAN NOT NULL DEFAULT true;
