-- Database audit (production stabilization pass): cross-referenced every table
-- name used in server/*.ts against the live schema. These 14 tables are
-- referenced by real, reachable code paths (confirmed via call-site tracing,
-- not guessed) but were never created by any prior migration. Each of these
-- previously failed with "relation does not exist" the first time its code
-- path executed; most calls happen to be wrapped in .catch() so the failure
-- was silent rather than a visible 500, which is worse for diagnosability.
--
-- NOT included here: driver_kyc_documents — also missing, but traced to a
-- registered route (POST /api/app/driver/kyc/upload) that is never called by
-- either Flutter app (the apps use the separate, working driver_documents
-- table via /api/app/driver/upload-document instead). Left alone per
-- "fix only confirmed issues" — this is dead code, not a live bug, and adding
-- a table for a second parallel KYC-document system would itself be the kind
-- of duplicate logic this task explicitly says not to introduce.

CREATE TABLE IF NOT EXISTS public.call_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID,
    caller_id UUID,
    caller_name VARCHAR(120),
    caller_phone VARCHAR(20),
    caller_type VARCHAR(20) DEFAULT 'customer',
    callee_id UUID,
    callee_name VARCHAR(120),
    callee_phone VARCHAR(20),
    callee_type VARCHAR(20) DEFAULT 'driver',
    receiver_id UUID,
    call_type VARCHAR(30) DEFAULT 'customer_to_driver',
    status VARCHAR(20) DEFAULT 'initiated',
    duration_seconds INTEGER DEFAULT 0,
    initiated_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_call_logs_trip ON public.call_logs (trip_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.driver_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL,
    event VARCHAR(60) NOT NULL,
    data JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_driver_events_driver ON public.driver_events (driver_id, created_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.emergency_contacts (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    name VARCHAR(120) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    relation VARCHAR(40) DEFAULT 'Friend',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user ON public.emergency_contacts (user_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.feature_flags (
    key VARCHAR(80) PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

-- Reference/lookup data for location-search landmark matching. Empty until
-- seeded by ops; the table existing (vs. missing) is what matters here —
-- the SELECT that reads it should return zero rows, not throw.
CREATE TABLE IF NOT EXISTS public.landmark_aliases (
    id SERIAL PRIMARY KEY,
    alias VARCHAR(160) NOT NULL,
    normalized_alias VARCHAR(160) NOT NULL,
    canonical_name VARCHAR(160) NOT NULL,
    canonical_address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    popularity_score INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_landmark_aliases_normalized ON public.landmark_aliases (normalized_alias);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.location_search_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    place_id VARCHAR(160),
    query_text VARCHAR(200) NOT NULL,
    normalized_query VARCHAR(200) NOT NULL,
    place_label VARCHAR(200),
    place_address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_location_search_history_user ON public.location_search_history (user_id, created_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.lost_found_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL,
    trip_id UUID,
    driver_id UUID,
    description TEXT NOT NULL,
    contact_phone VARCHAR(20),
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
-- Guarded: CREATE TABLE IF NOT EXISTS is a no-op against a pre-existing
-- lost_found_reports table with different columns (e.g. production's real
-- table uses reporter_id/item_description, not customer_id), which would
-- otherwise make this bare CREATE INDEX fail with "column does not exist"
-- and abort the whole migration chain. Migration 0006 adds customer_id via
-- ALTER TABLE ADD COLUMN IF NOT EXISTS and creates this same index once the
-- column is guaranteed to exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='lost_found_reports' AND column_name='customer_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_lost_found_reports_customer ON public.lost_found_reports (customer_id, created_at)';
  END IF;
END $$;
--> statement-breakpoint

-- Reliable-delivery outbox for post-trip events (processOutboxBatch in
-- server/outbox.ts). Note: the only INSERT call site for this table
-- (revenue-engine.ts's completeTripAtomic) is dead code — never called from
-- any route — so this table existing stops the recurring silent failure in
-- processOutboxBatch (fired after every real trip completion, routes.ts) but
-- does not by itself restore outbox event delivery; nothing currently writes
-- to it via a live path. Flagged separately in the final report, not fixed
-- here — wiring that up is a business-logic decision, not a schema gap.
CREATE TABLE IF NOT EXISTS public.outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(60) NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT false,
    processing BOOLEAN NOT NULL DEFAULT false,
    processing_started_at TIMESTAMP,
    processed_at TIMESTAMP,
    attempts INTEGER NOT NULL DEFAULT 0,
    failed BOOLEAN NOT NULL DEFAULT false,
    next_attempt_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outbox_events_pending ON public.outbox_events (processed, processing, failed, next_attempt_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.popular_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    city_name VARCHAR(100),
    full_address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.runtime_config_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type VARCHAR(40) NOT NULL,
    scope_key VARCHAR(120) NOT NULL,
    config_key VARCHAR(120) NOT NULL,
    config_value JSONB NOT NULL,
    description TEXT,
    updated_by VARCHAR(160),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT runtime_config_entries_scope_key_unique UNIQUE (scope_type, scope_key, config_key)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.runtime_config_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type VARCHAR(40) NOT NULL,
    scope_key VARCHAR(120) NOT NULL,
    config_key VARCHAR(120) NOT NULL,
    previous_value JSONB,
    next_value JSONB,
    reason TEXT,
    updated_by VARCHAR(160),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

-- Safety/SOS incidents (openSafetyIncidents count on the admin realtime-ops
-- dashboard). Already defensively .catch()-wrapped at its one call site, so
-- this was never user-visible, but the count silently read as 0 always
-- because the query itself threw internally.
CREATE TABLE IF NOT EXISTS public.sf_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.support_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    sender VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_support_messages_user ON public.support_messages (user_id, created_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.surge_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    pickup_lat DOUBLE PRECISION,
    pickup_lng DOUBLE PRECISION,
    pickup_address TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

-- GET /api/app/notifications (both apps' in-app notifications screens) reads
-- from "notification_log" (singular) — a typo; the real, working table is
-- notification_logs (plural), already populated by the admin broadcast path
-- (routes.ts:5872) and by server/hardening.ts. Rather than create a second,
-- disconnected notification table (duplicate logic), the code fix (see
-- server/routes.ts) points the customer/driver-facing reads at the real
-- table. That table has recipient_id/sent_at but no per-user read-tracking
-- column, which the in-app notifications screen needs — add it here.
ALTER TABLE public.notification_logs
    ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false;
