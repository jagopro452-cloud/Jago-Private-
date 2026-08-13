CREATE TABLE IF NOT EXISTS wallet_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL,
  type VARCHAR(16) NOT NULL,
  reason TEXT NOT NULL,
  ref_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_events_user_created
  ON wallet_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_events_ref_id
  ON wallet_events(ref_id)
  WHERE ref_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_events_type_created
  ON wallet_events(type, created_at DESC);
