-- Migration 011: call_logs + driver_offer_events
-- Promotes runtime-created tables to versioned schema so migration runners
-- (and fresh-DB bootstraps) track them correctly.

CREATE TABLE IF NOT EXISTS call_logs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id          UUID,
  caller_id        UUID        NOT NULL,
  caller_name      TEXT,
  caller_phone     TEXT,
  caller_type      TEXT,
  receiver_id      UUID,
  callee_id        UUID,
  callee_name      TEXT,
  callee_phone     TEXT,
  callee_type      TEXT,
  call_type        TEXT        DEFAULT 'ride',
  status           TEXT        NOT NULL DEFAULT 'initiated',
  initiated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  duration_sec     INT,
  duration_seconds INT
);

CREATE INDEX IF NOT EXISTS idx_call_logs_trip        ON call_logs (trip_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_caller      ON call_logs (caller_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_initiated   ON call_logs (initiated_at);

-- ── Predictive Dispatch: driver offer event history ──────────────────────────

CREATE TABLE IF NOT EXISTS driver_offer_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id         UUID        NOT NULL,
  trip_id           UUID        NOT NULL,
  zone_grid_key     TEXT        NOT NULL,
  hour_of_day       SMALLINT    NOT NULL,
  day_of_week       SMALLINT    NOT NULL,
  service_type      TEXT        NOT NULL,
  decision          TEXT,
  response_time_sec REAL,
  offered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_doe_driver_zone
  ON driver_offer_events (driver_id, zone_grid_key, hour_of_day, day_of_week);
CREATE INDEX IF NOT EXISTS idx_doe_trip
  ON driver_offer_events (trip_id);
CREATE INDEX IF NOT EXISTS idx_doe_zone_time
  ON driver_offer_events (zone_grid_key, hour_of_day, day_of_week);
CREATE INDEX IF NOT EXISTS idx_doe_offered_at
  ON driver_offer_events (offered_at);
