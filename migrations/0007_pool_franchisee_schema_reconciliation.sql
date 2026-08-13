-- Phase AE/AF — franchisees / local-pool / pool-moderation schema reconciliation.
--
-- Production's franchisees, driver_pool_sessions, pool_ride_requests,
-- pool_user_blocks, pool_ratings, and pool_issue_cases tables were created
-- independently of this repository's migration history (no CREATE TABLE for
-- their live shape exists anywhere in this repo — confirmed via full-repo
-- search, Phase AD) and are missing columns that server/rolling-pool.ts,
-- server/outstation-pool-v2.ts, the admin panel routes, and the Flutter
-- driver app all read/write. Every write path against these six tables has
-- been silently failing (caught by blanket .catch(() => ({rows: []})) error
-- suppression in rolling-pool.ts) — confirmed empirically: all six tables
-- hold zero rows in production as of this migration's authoring (Phase AE).
--
-- This migration is purely additive: every statement is idempotent (safe to
-- run any number of times, in any order relative to itself), nothing is
-- dropped, no existing column is renamed, no table is recreated, and no
-- existing row is altered destructively. Where the live schema used a
-- differently-named column for the same concept (e.g. commission_pct vs.
-- commission_percent), the new column is added alongside the old one and a
-- guarded backfill copies any existing data across — a no-op today since the
-- affected tables are empty, but correct and safe if this ever runs against
-- a table that has since gained rows.
--
-- Verified against a live production schema dump taken via SSH psql \d on
-- each of the six tables (Phase AC/AD/AE) and cross-checked against both
-- migrations/0000_baseline.sql and server/migrations/008_full_module_readiness.sql,
-- which independently agree with each other on every column they share.

BEGIN;

-- ============================================================================
-- 1. franchisees
--    Live: id, owner_id, name, city, status, created_at, updated_at,
--          commission_type, commission_flat, commission_pct, address,
--          pincode, bank_*, gst_number, pan_number, agreement_date,
--          contract_end_date, min_guaranteed, payout_cycle, total_paid_out,
--          notes, photo_url, whatsapp, alt_contact_name, alt_contact_phone,
--          franchise_type, service_area_desc, website, contact_phone,
--          contact_name, state.
--    Required (migrations/0000_baseline.sql): additionally owner_name,
--          email, password, phone, zone_id, commission_percent, is_active,
--          auth_token, auth_token_expires_at, last_login_at.
--    NOTE: owner_id (live, FK->users) and owner_name/email/password/
--    auth_token* (required) represent two different auth-ownership models
--    for a franchisee. This migration adds both sets of columns without
--    resolving which one the /franchise/ portal route should standardize
--    on — that is an application-level decision out of scope for a purely
--    additive schema migration (see Phase AE report, section 1a-note).
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.franchisees') IS NOT NULL THEN
    ALTER TABLE public.franchisees ADD COLUMN IF NOT EXISTS owner_name character varying(255);
    ALTER TABLE public.franchisees ADD COLUMN IF NOT EXISTS email character varying(191);
    ALTER TABLE public.franchisees ADD COLUMN IF NOT EXISTS password character varying(255);
    ALTER TABLE public.franchisees ADD COLUMN IF NOT EXISTS phone character varying(30);
    ALTER TABLE public.franchisees ADD COLUMN IF NOT EXISTS zone_id uuid;
    ALTER TABLE public.franchisees ADD COLUMN IF NOT EXISTS commission_percent numeric(8,2) DEFAULT 0;
    ALTER TABLE public.franchisees ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
    ALTER TABLE public.franchisees ADD COLUMN IF NOT EXISTS auth_token text;
    ALTER TABLE public.franchisees ADD COLUMN IF NOT EXISTS auth_token_expires_at timestamp without time zone;
    ALTER TABLE public.franchisees ADD COLUMN IF NOT EXISTS last_login_at timestamp without time zone;
  END IF;
END $$;

-- Backfill: commission_pct (live) -> commission_percent (required). Guarded
-- on both columns existing (they will, immediately above) and only copies
-- rows where the new column hasn't already been populated by other means.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='franchisees' AND column_name='commission_pct')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='franchisees' AND column_name='commission_percent') THEN
    UPDATE public.franchisees
       SET commission_percent = commission_pct
     WHERE commission_percent IS DISTINCT FROM commission_pct
       AND commission_pct IS NOT NULL
       AND (commission_percent IS NULL OR commission_percent = 0);
  END IF;
END $$;

-- Backfill: status (live, text) -> is_active (required, boolean). is_active
-- is added with DEFAULT true, so existing rows get `true`, not NULL — an
-- IS NULL guard (the pattern used elsewhere in this file) would never
-- match. Instead this only flips rows that are still sitting at that
-- just-added default AND whose status clearly says otherwise, so it never
-- overwrites a value the application has since managed on its own. A
-- second run is a true no-op: once a row is false, `is_active = true`
-- no longer matches it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='franchisees' AND column_name='status')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='franchisees' AND column_name='is_active') THEN
    UPDATE public.franchisees
       SET is_active = false
     WHERE status IS NOT NULL AND status <> 'active' AND is_active = true;
  END IF;
END $$;

-- ============================================================================
-- 2. driver_pool_sessions
--    Live: id, driver_id, status, vehicle_category, start_lat, start_lng,
--          route_data, max_seats, available_seats, created_at, updated_at.
--    Required: additionally vehicle_category_id, accepting_new_requests,
--          pool_vehicle_type, current_lat, current_lng, current_bearing_deg,
--          heading, speed, route_plan, state_version, last_location_at,
--          ended_at, total_passengers_served, total_earnings.
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.driver_pool_sessions') IS NOT NULL THEN
    ALTER TABLE public.driver_pool_sessions ADD COLUMN IF NOT EXISTS vehicle_category_id uuid;
    ALTER TABLE public.driver_pool_sessions ADD COLUMN IF NOT EXISTS accepting_new_requests boolean DEFAULT true;
    ALTER TABLE public.driver_pool_sessions ADD COLUMN IF NOT EXISTS pool_vehicle_type character varying(50);
    ALTER TABLE public.driver_pool_sessions ADD COLUMN IF NOT EXISTS current_lat double precision;
    ALTER TABLE public.driver_pool_sessions ADD COLUMN IF NOT EXISTS current_lng double precision;
    ALTER TABLE public.driver_pool_sessions ADD COLUMN IF NOT EXISTS current_bearing_deg double precision;
    ALTER TABLE public.driver_pool_sessions ADD COLUMN IF NOT EXISTS heading double precision;
    ALTER TABLE public.driver_pool_sessions ADD COLUMN IF NOT EXISTS speed double precision;
    ALTER TABLE public.driver_pool_sessions ADD COLUMN IF NOT EXISTS route_plan jsonb;
    ALTER TABLE public.driver_pool_sessions ADD COLUMN IF NOT EXISTS state_version integer DEFAULT 0;
    ALTER TABLE public.driver_pool_sessions ADD COLUMN IF NOT EXISTS last_location_at timestamp without time zone;
    ALTER TABLE public.driver_pool_sessions ADD COLUMN IF NOT EXISTS ended_at timestamp without time zone;
    ALTER TABLE public.driver_pool_sessions ADD COLUMN IF NOT EXISTS total_passengers_served integer DEFAULT 0;
    ALTER TABLE public.driver_pool_sessions ADD COLUMN IF NOT EXISTS total_earnings numeric(10,2) DEFAULT 0;
  END IF;
END $$;

-- Backfill: start_lat/start_lng (live) -> current_lat/current_lng (required).
-- Same coordinate concept, different column name; numeric -> double
-- precision copy is a safe widening cast.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='driver_pool_sessions' AND column_name='start_lat')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='driver_pool_sessions' AND column_name='current_lat') THEN
    UPDATE public.driver_pool_sessions
       SET current_lat = start_lat::double precision
     WHERE start_lat IS NOT NULL AND current_lat IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='driver_pool_sessions' AND column_name='start_lng')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='driver_pool_sessions' AND column_name='current_lng') THEN
    UPDATE public.driver_pool_sessions
       SET current_lng = start_lng::double precision
     WHERE start_lng IS NOT NULL AND current_lng IS NULL;
  END IF;
END $$;

-- Backfill: route_data (live, jsonb) -> route_plan (required, jsonb). Same
-- type, straight copy.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='driver_pool_sessions' AND column_name='route_data')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='driver_pool_sessions' AND column_name='route_plan') THEN
    UPDATE public.driver_pool_sessions
       SET route_plan = route_data
     WHERE route_data IS NOT NULL AND route_plan IS NULL;
  END IF;
END $$;

-- ============================================================================
-- 3. pool_ride_requests
--    Live: id, customer_id, driver_id, status, pickup_address, pickup_lat,
--          pickup_lng, drop_address, drop_lat, drop_lng, fare, seats_booked,
--          notes, otp, created_at, updated_at, commission_amount,
--          gst_amount, insurance_amount, platform_deduction, revenue_model,
--          revenue_breakdown, driver_earnings, settlement_status,
--          settlement_outbox_id.
--    Required: additionally session_id, vehicle_category_id, seats_requested,
--          fare_per_seat, total_fare, distance_km, payment_method,
--          searched_at, boarding_otp(+issued/expires/used_at), cluster_key,
--          proposed_session_id, pickup_order, drop_order,
--          seat_lock_expires_at, assignment_version, matched_at,
--          picked_up_at, dropped_at, cancelled_at, cancel_reason.
--    session_id/proposed_session_id reference driver_pool_sessions(id), so
--    this section must run after section 2 has added that table's columns
--    (both sections are inside the same transaction — order below matters).
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.pool_ride_requests') IS NOT NULL THEN
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS session_id uuid;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS vehicle_category_id uuid;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS seats_requested integer DEFAULT 1;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS fare_per_seat numeric(12,2) DEFAULT 0;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS total_fare numeric(12,2) DEFAULT 0;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS distance_km numeric(10,2) DEFAULT 0;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS payment_method character varying(30) DEFAULT 'cash';
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS searched_at timestamp without time zone DEFAULT now();
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS boarding_otp character varying(10);
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS boarding_otp_issued_at timestamp without time zone;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS boarding_otp_expires_at timestamp without time zone;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS boarding_otp_used_at timestamp without time zone;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS cluster_key character varying(120);
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS proposed_session_id uuid;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS pickup_order integer;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS drop_order integer;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS seat_lock_expires_at timestamp without time zone;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS assignment_version integer DEFAULT 0;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS matched_at timestamp without time zone;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS picked_up_at timestamp without time zone;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS dropped_at timestamp without time zone;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS cancelled_at timestamp without time zone;
    ALTER TABLE public.pool_ride_requests ADD COLUMN IF NOT EXISTS cancel_reason text;
  END IF;
END $$;

-- FK: session_id/proposed_session_id -> driver_pool_sessions(id). Added
-- separately (not inline on the ADD COLUMN above) so a missing/renamed
-- parent table can never abort the additive column changes above it; the
-- constraint is only added once both tables and columns are confirmed
-- present, and is itself idempotent via a catalog existence check scoped
-- to this table via conrelid — constraint names only need to be unique
-- per table in PostgreSQL, so an unscoped name-only check could be fooled
-- by an identically-named constraint on a completely unrelated table.
DO $$
BEGIN
  IF to_regclass('public.pool_ride_requests') IS NOT NULL
     AND to_regclass('public.driver_pool_sessions') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'pool_ride_requests_session_id_fkey'
          AND conrelid = 'public.pool_ride_requests'::regclass
     ) THEN
    ALTER TABLE public.pool_ride_requests
      ADD CONSTRAINT pool_ride_requests_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES public.driver_pool_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill: seats_booked (live) -> seats_requested (required). Same concept.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_ride_requests' AND column_name='seats_booked')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_ride_requests' AND column_name='seats_requested') THEN
    UPDATE public.pool_ride_requests
       SET seats_requested = seats_booked
     WHERE seats_booked IS NOT NULL AND (seats_requested IS NULL OR seats_requested = 1);
  END IF;
END $$;

-- Backfill: fare (live) -> fare_per_seat/total_fare (required, split). Both
-- new columns are seeded from the single live fare value; this is a
-- reasonable default (fare_per_seat = fare assuming 1 seat, total_fare =
-- fare) that the application will overwrite on its own on the next write.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_ride_requests' AND column_name='fare')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_ride_requests' AND column_name='total_fare') THEN
    UPDATE public.pool_ride_requests
       SET total_fare = fare
     WHERE fare IS NOT NULL AND (total_fare IS NULL OR total_fare = 0);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_ride_requests' AND column_name='fare')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_ride_requests' AND column_name='fare_per_seat') THEN
    UPDATE public.pool_ride_requests
       SET fare_per_seat = fare
     WHERE fare IS NOT NULL AND (fare_per_seat IS NULL OR fare_per_seat = 0);
  END IF;
END $$;

-- ============================================================================
-- 4. pool_user_blocks
--    Live: id, blocker_id, blocked_id, created_at.
--    Required: blocker_user_id, blocked_user_id, module, reference_type,
--          reference_id, created_by_role, reason, active.
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.pool_user_blocks') IS NOT NULL THEN
    ALTER TABLE public.pool_user_blocks ADD COLUMN IF NOT EXISTS blocker_user_id uuid;
    ALTER TABLE public.pool_user_blocks ADD COLUMN IF NOT EXISTS blocked_user_id uuid;
    ALTER TABLE public.pool_user_blocks ADD COLUMN IF NOT EXISTS module character varying(30);
    ALTER TABLE public.pool_user_blocks ADD COLUMN IF NOT EXISTS reference_type character varying(30);
    ALTER TABLE public.pool_user_blocks ADD COLUMN IF NOT EXISTS reference_id uuid;
    ALTER TABLE public.pool_user_blocks ADD COLUMN IF NOT EXISTS created_by_role character varying(20);
    ALTER TABLE public.pool_user_blocks ADD COLUMN IF NOT EXISTS reason character varying(300);
    ALTER TABLE public.pool_user_blocks ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
  END IF;
END $$;

-- Backfill: blocker_id/blocked_id (live) -> blocker_user_id/blocked_user_id
-- (required). Same concept, renamed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_user_blocks' AND column_name='blocker_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_user_blocks' AND column_name='blocker_user_id') THEN
    UPDATE public.pool_user_blocks
       SET blocker_user_id = blocker_id
     WHERE blocker_id IS NOT NULL AND blocker_user_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_user_blocks' AND column_name='blocked_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_user_blocks' AND column_name='blocked_user_id') THEN
    UPDATE public.pool_user_blocks
       SET blocked_user_id = blocked_id
     WHERE blocked_id IS NOT NULL AND blocked_user_id IS NULL;
  END IF;
END $$;

-- ============================================================================
-- 5. pool_ratings
--    Live: id, ride_request_id, rater_id, rated_id, rating, comment,
--          created_at.
--    Required: additionally module, reference_type, reference_id, ride_id,
--          from_user_id, to_user_id, rating_role, overall_rating,
--          safety_rating, cleanliness_rating, behaviour_rating,
--          punctuality_rating, note.
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.pool_ratings') IS NOT NULL THEN
    ALTER TABLE public.pool_ratings ADD COLUMN IF NOT EXISTS module character varying(30);
    ALTER TABLE public.pool_ratings ADD COLUMN IF NOT EXISTS reference_type character varying(30);
    ALTER TABLE public.pool_ratings ADD COLUMN IF NOT EXISTS reference_id uuid;
    ALTER TABLE public.pool_ratings ADD COLUMN IF NOT EXISTS ride_id uuid;
    ALTER TABLE public.pool_ratings ADD COLUMN IF NOT EXISTS from_user_id uuid;
    ALTER TABLE public.pool_ratings ADD COLUMN IF NOT EXISTS to_user_id uuid;
    ALTER TABLE public.pool_ratings ADD COLUMN IF NOT EXISTS rating_role character varying(30);
    ALTER TABLE public.pool_ratings ADD COLUMN IF NOT EXISTS overall_rating numeric(2,1);
    ALTER TABLE public.pool_ratings ADD COLUMN IF NOT EXISTS safety_rating numeric(2,1);
    ALTER TABLE public.pool_ratings ADD COLUMN IF NOT EXISTS cleanliness_rating numeric(2,1);
    ALTER TABLE public.pool_ratings ADD COLUMN IF NOT EXISTS behaviour_rating numeric(2,1);
    ALTER TABLE public.pool_ratings ADD COLUMN IF NOT EXISTS punctuality_rating numeric(2,1);
    ALTER TABLE public.pool_ratings ADD COLUMN IF NOT EXISTS note text;
  END IF;
END $$;

-- Backfill: rater_id/rated_id (live) -> from_user_id/to_user_id (required).
-- rating (live, integer) -> overall_rating (required, numeric(2,1)).
-- comment (live) -> note (required).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_ratings' AND column_name='rater_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_ratings' AND column_name='from_user_id') THEN
    UPDATE public.pool_ratings
       SET from_user_id = rater_id
     WHERE rater_id IS NOT NULL AND from_user_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_ratings' AND column_name='rated_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_ratings' AND column_name='to_user_id') THEN
    UPDATE public.pool_ratings
       SET to_user_id = rated_id
     WHERE rated_id IS NOT NULL AND to_user_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_ratings' AND column_name='rating')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_ratings' AND column_name='overall_rating') THEN
    UPDATE public.pool_ratings
       SET overall_rating = rating::numeric(2,1)
     WHERE rating IS NOT NULL AND overall_rating IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_ratings' AND column_name='comment')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_ratings' AND column_name='note') THEN
    UPDATE public.pool_ratings
       SET note = comment
     WHERE comment IS NOT NULL AND note IS NULL;
  END IF;
END $$;

-- ============================================================================
-- 6. pool_issue_cases
--    Live: id, reporter_id, ride_request_id, issue_type, description,
--          status, created_at, updated_at.
--    Required: additionally module, reference_type, reference_id, ride_id,
--          customer_id, driver_id, reported_user_id, reported_by_role,
--          issue_channel, category, evidence_urls, admin_updates,
--          resolution_note.
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.pool_issue_cases') IS NOT NULL THEN
    ALTER TABLE public.pool_issue_cases ADD COLUMN IF NOT EXISTS module character varying(30);
    ALTER TABLE public.pool_issue_cases ADD COLUMN IF NOT EXISTS reference_type character varying(30);
    ALTER TABLE public.pool_issue_cases ADD COLUMN IF NOT EXISTS reference_id uuid;
    ALTER TABLE public.pool_issue_cases ADD COLUMN IF NOT EXISTS ride_id uuid;
    ALTER TABLE public.pool_issue_cases ADD COLUMN IF NOT EXISTS customer_id uuid;
    ALTER TABLE public.pool_issue_cases ADD COLUMN IF NOT EXISTS driver_id uuid;
    ALTER TABLE public.pool_issue_cases ADD COLUMN IF NOT EXISTS reported_user_id uuid;
    ALTER TABLE public.pool_issue_cases ADD COLUMN IF NOT EXISTS reported_by_role character varying(20);
    ALTER TABLE public.pool_issue_cases ADD COLUMN IF NOT EXISTS issue_channel character varying(30) DEFAULT 'issue';
    ALTER TABLE public.pool_issue_cases ADD COLUMN IF NOT EXISTS category character varying(60);
    ALTER TABLE public.pool_issue_cases ADD COLUMN IF NOT EXISTS evidence_urls jsonb DEFAULT '[]'::jsonb;
    ALTER TABLE public.pool_issue_cases ADD COLUMN IF NOT EXISTS admin_updates jsonb DEFAULT '[]'::jsonb;
    ALTER TABLE public.pool_issue_cases ADD COLUMN IF NOT EXISTS resolution_note text;
  END IF;
END $$;

-- Backfill: issue_type (live) -> category (required). Same concept.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_issue_cases' AND column_name='issue_type')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pool_issue_cases' AND column_name='category') THEN
    UPDATE public.pool_issue_cases
       SET category = issue_type
     WHERE issue_type IS NOT NULL AND category IS NULL;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- POST-MIGRATION NOTES (not executed — informational only)
-- ============================================================================
--
-- Estimated execution time: well under 1 second. Every ALTER TABLE ADD
-- COLUMN IF NOT EXISTS above is a metadata-only change on PostgreSQL when
-- the new column is nullable or has a constant default with no rewrite
-- required (true for all columns added here) — no table rewrite occurs.
-- All six target tables additionally have 0 rows in production as of this
-- writing (Phase AE), so every backfill UPDATE scans and touches 0 rows.
-- Total wall-clock time dominated by round-trip latency of ~60 individual
-- statements, not by any lock or I/O cost — expect low hundreds of
-- milliseconds end-to-end.
--
-- Lock duration: each ALTER TABLE ADD COLUMN takes a brief
-- ACCESS EXCLUSIVE lock on its target table, but only for the metadata
-- update itself (sub-millisecond on tables this small and this column
-- change type) — not for a table scan or rewrite. The one ADD CONSTRAINT
-- (pool_ride_requests_session_id_fkey) validates against a 0-row table, so
-- its lock is likewise metadata-only. No statement in this migration holds
-- a lock across a table scan of existing data.
--
-- Rollback SQL (additive-only, so rollback is drop-the-new-columns only;
-- no data can be lost since nothing existing was altered or removed):
--
--   BEGIN;
--   ALTER TABLE public.pool_issue_cases
--     DROP COLUMN IF EXISTS module, DROP COLUMN IF EXISTS reference_type,
--     DROP COLUMN IF EXISTS reference_id, DROP COLUMN IF EXISTS ride_id,
--     DROP COLUMN IF EXISTS customer_id, DROP COLUMN IF EXISTS driver_id,
--     DROP COLUMN IF EXISTS reported_user_id, DROP COLUMN IF EXISTS reported_by_role,
--     DROP COLUMN IF EXISTS issue_channel, DROP COLUMN IF EXISTS category,
--     DROP COLUMN IF EXISTS evidence_urls, DROP COLUMN IF EXISTS admin_updates,
--     DROP COLUMN IF EXISTS resolution_note;
--   ALTER TABLE public.pool_ratings
--     DROP COLUMN IF EXISTS module, DROP COLUMN IF EXISTS reference_type,
--     DROP COLUMN IF EXISTS reference_id, DROP COLUMN IF EXISTS ride_id,
--     DROP COLUMN IF EXISTS from_user_id, DROP COLUMN IF EXISTS to_user_id,
--     DROP COLUMN IF EXISTS rating_role, DROP COLUMN IF EXISTS overall_rating,
--     DROP COLUMN IF EXISTS safety_rating, DROP COLUMN IF EXISTS cleanliness_rating,
--     DROP COLUMN IF EXISTS behaviour_rating, DROP COLUMN IF EXISTS punctuality_rating,
--     DROP COLUMN IF EXISTS note;
--   ALTER TABLE public.pool_user_blocks
--     DROP COLUMN IF EXISTS blocker_user_id, DROP COLUMN IF EXISTS blocked_user_id,
--     DROP COLUMN IF EXISTS module, DROP COLUMN IF EXISTS reference_type,
--     DROP COLUMN IF EXISTS reference_id, DROP COLUMN IF EXISTS created_by_role,
--     DROP COLUMN IF EXISTS reason, DROP COLUMN IF EXISTS active;
--   ALTER TABLE public.pool_ride_requests
--     DROP CONSTRAINT IF EXISTS pool_ride_requests_session_id_fkey;
--   ALTER TABLE public.pool_ride_requests
--     DROP COLUMN IF EXISTS session_id, DROP COLUMN IF EXISTS vehicle_category_id,
--     DROP COLUMN IF EXISTS seats_requested, DROP COLUMN IF EXISTS fare_per_seat,
--     DROP COLUMN IF EXISTS total_fare, DROP COLUMN IF EXISTS distance_km,
--     DROP COLUMN IF EXISTS payment_method, DROP COLUMN IF EXISTS searched_at,
--     DROP COLUMN IF EXISTS boarding_otp, DROP COLUMN IF EXISTS boarding_otp_issued_at,
--     DROP COLUMN IF EXISTS boarding_otp_expires_at, DROP COLUMN IF EXISTS boarding_otp_used_at,
--     DROP COLUMN IF EXISTS cluster_key, DROP COLUMN IF EXISTS proposed_session_id,
--     DROP COLUMN IF EXISTS pickup_order, DROP COLUMN IF EXISTS drop_order,
--     DROP COLUMN IF EXISTS seat_lock_expires_at, DROP COLUMN IF EXISTS assignment_version,
--     DROP COLUMN IF EXISTS matched_at, DROP COLUMN IF EXISTS picked_up_at,
--     DROP COLUMN IF EXISTS dropped_at, DROP COLUMN IF EXISTS cancelled_at,
--     DROP COLUMN IF EXISTS cancel_reason;
--   ALTER TABLE public.driver_pool_sessions
--     DROP COLUMN IF EXISTS vehicle_category_id, DROP COLUMN IF EXISTS accepting_new_requests,
--     DROP COLUMN IF EXISTS pool_vehicle_type, DROP COLUMN IF EXISTS current_lat,
--     DROP COLUMN IF EXISTS current_lng, DROP COLUMN IF EXISTS current_bearing_deg,
--     DROP COLUMN IF EXISTS heading, DROP COLUMN IF EXISTS speed,
--     DROP COLUMN IF EXISTS route_plan, DROP COLUMN IF EXISTS state_version,
--     DROP COLUMN IF EXISTS last_location_at, DROP COLUMN IF EXISTS ended_at,
--     DROP COLUMN IF EXISTS total_passengers_served, DROP COLUMN IF EXISTS total_earnings;
--   ALTER TABLE public.franchisees
--     DROP COLUMN IF EXISTS owner_name, DROP COLUMN IF EXISTS email,
--     DROP COLUMN IF EXISTS password, DROP COLUMN IF EXISTS phone,
--     DROP COLUMN IF EXISTS zone_id, DROP COLUMN IF EXISTS commission_percent,
--     DROP COLUMN IF EXISTS is_active, DROP COLUMN IF EXISTS auth_token,
--     DROP COLUMN IF EXISTS auth_token_expires_at, DROP COLUMN IF EXISTS last_login_at;
--   COMMIT;
--
-- Risk analysis:
--   - Data loss risk: none. No DROP COLUMN, no destructive RENAME, no
--     TRUNCATE/DELETE anywhere in this migration. All six target tables
--     are empty in production today, so even the backfill UPDATEs (which
--     would be safe regardless) touch zero rows.
--   - Lock/downtime risk: negligible. All lock-acquiring statements are
--     metadata-only ALTER TABLE ADD COLUMN / ADD CONSTRAINT on empty or
--     near-empty tables; no CREATE INDEX (non-concurrent) that would block
--     writes for a meaningful duration, no table rewrite.
--   - Idempotency risk: none. Every ALTER TABLE uses ADD COLUMN IF NOT
--     EXISTS; every DO $$ block gates on to_regclass()/information_schema
--     existence checks; the one ADD CONSTRAINT checks pg_constraint first.
--     Running this file twice in a row is a no-op the second time.
--   - Application-level risk (not a migration risk, flagged for
--     awareness): the franchisees owner_id-vs-owner_name/email/password
--     dual auth model (see section 1) is not resolved by this migration —
--     it makes both shapes available without deciding between them. This
--     does not block the migration itself but should be resolved before
--     the /franchise/ portal route is exercised in production.
--   - Scope risk: this migration does not modify shared/schema.ts (still
--     silent on these six tables) or add Drizzle type definitions — these
--     tables remain raw-SQL-only, consistent with how the rest of the
--     migration chain (0000-0006) already treats them. Bringing them under
--     Drizzle-managed types would be a separate, code-level change.
