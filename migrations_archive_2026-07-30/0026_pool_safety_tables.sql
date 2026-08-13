-- outstation-pool-v2.ts, rolling-pool.ts and socket.ts extensively reference these 4 tables
-- (issue/dispute reporting, in-trip chat, ratings, user blocking for both local pool and
-- outstation pool) but no migration ever created them — ensureOutstationPoolV2Schema() only
-- asserts they exist and logs a startup warning ("Missing required tables: ...") without
-- creating them. Every pool safety/chat/rating endpoint 500s until this runs.

CREATE TABLE IF NOT EXISTS pool_issue_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module VARCHAR(30) NOT NULL,
  reference_type VARCHAR(30) NOT NULL,
  reference_id UUID NOT NULL,
  ride_id UUID,
  customer_id UUID,
  driver_id UUID,
  reported_user_id UUID,
  reported_by_role VARCHAR(20) NOT NULL,
  issue_channel VARCHAR(30) NOT NULL DEFAULT 'issue',
  category VARCHAR(60),
  description TEXT,
  evidence_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  admin_updates JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolution_note TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pool_issue_cases_reported_user ON pool_issue_cases(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_pool_issue_cases_customer ON pool_issue_cases(customer_id);
CREATE INDEX IF NOT EXISTS idx_pool_issue_cases_driver ON pool_issue_cases(driver_id);
CREATE INDEX IF NOT EXISTS idx_pool_issue_cases_module_ref ON pool_issue_cases(module, reference_id);
CREATE INDEX IF NOT EXISTS idx_pool_issue_cases_status ON pool_issue_cases(status);

CREATE TABLE IF NOT EXISTS pool_user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_user_id UUID NOT NULL,
  blocked_user_id UUID NOT NULL,
  module VARCHAR(30) NOT NULL,
  reference_type VARCHAR(30),
  reference_id UUID,
  created_by_role VARCHAR(20) NOT NULL,
  reason VARCHAR(300),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_user_blocks_active_pair
  ON pool_user_blocks(blocker_user_id, blocked_user_id, module) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_pool_user_blocks_blocked ON pool_user_blocks(blocked_user_id);

CREATE TABLE IF NOT EXISTS pool_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module VARCHAR(30) NOT NULL,
  reference_id UUID NOT NULL,
  sender_id UUID NOT NULL,
  sender_type VARCHAR(20) NOT NULL,
  sender_name VARCHAR(120),
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pool_messages_module_ref ON pool_messages(module, reference_id, created_at);

CREATE TABLE IF NOT EXISTS pool_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module VARCHAR(30) NOT NULL,
  reference_type VARCHAR(30) NOT NULL,
  reference_id UUID NOT NULL,
  ride_id UUID,
  from_user_id UUID NOT NULL,
  to_user_id UUID NOT NULL,
  rating_role VARCHAR(30) NOT NULL,
  overall_rating NUMERIC(2,1) NOT NULL,
  safety_rating NUMERIC(2,1),
  cleanliness_rating NUMERIC(2,1),
  behaviour_rating NUMERIC(2,1),
  punctuality_rating NUMERIC(2,1),
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_ratings_unique_submission
  ON pool_ratings(reference_type, reference_id, from_user_id, rating_role);
CREATE INDEX IF NOT EXISTS idx_pool_ratings_to_user ON pool_ratings(to_user_id);
