-- Migration: 0009 — Enforce one active local pool booking per customer
-- Date: 2026-06-08
-- Author: Production Hardening Pass
--
-- Problem: A customer could book multiple simultaneous pool rides if rapid
-- concurrent requests arrived before the application-layer guard (added in
-- rolling-pool.ts) had a chance to reject them.  A database-level constraint
-- is the only reliable safety net.
--
-- Solution: Partial unique index on pool_ride_requests(customer_id) filtered
-- to rows whose status is still "active" (searching / pending_driver_accept /
-- matched / picked_up).  Rows in terminal states (dropped, cancelled,
-- search_timeout) are excluded, so historical data is unaffected.
--
-- IMPORTANT — CONCURRENTLY requirement:
--   CREATE UNIQUE INDEX CONCURRENTLY cannot run inside a transaction block.
--   Run this file with psql outside of BEGIN/COMMIT, or with:
--     psql $DATABASE_URL -f 0009_pool_active_booking_unique_constraint.sql
--   Never wrap this file in a migration runner that wraps each file in a
--   transaction unless that runner is aware of the CONCURRENTLY exception.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS uidx_pool_ride_requests_one_active_per_customer;

-- ─── Step 1: Pre-flight — detect existing duplicates ─────────────────────────
-- If this query returns any rows, resolve them manually BEFORE applying the
-- index.  The index will fail with a unique-violation if duplicates exist.
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT customer_id
    FROM pool_ride_requests
    WHERE status IN ('searching', 'pending_driver_accept', 'matched', 'picked_up')
    GROUP BY customer_id
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE WARNING
      'pool_ride_requests has % customer(s) with multiple active bookings. '
      'Resolve these rows before re-running this migration, otherwise the '
      'CREATE UNIQUE INDEX will fail.',
      dup_count;
  ELSE
    RAISE NOTICE 'Pre-flight check passed: no duplicate active bookings found.';
  END IF;
END;
$$;

-- ─── Step 2: Partial unique index ────────────────────────────────────────────
-- CONCURRENTLY: builds the index without taking an exclusive lock on the
-- table, so active production traffic is not blocked.
-- IF NOT EXISTS: idempotent — safe to re-run.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  uidx_pool_ride_requests_one_active_per_customer
ON pool_ride_requests (customer_id)
WHERE status IN ('searching', 'pending_driver_accept', 'matched', 'picked_up');

-- ─── Step 3: Supporting performance index ────────────────────────────────────
-- The duplicate-booking guard query in rolling-pool.ts runs:
--   SELECT id FROM pool_ride_requests
--   WHERE customer_id = $1 AND status IN ('searching', ...)
-- The partial unique index above already satisfies this lookup, but add an
-- explicit btree index on (customer_id, status) for the general status
-- filter path used by background workers.
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_pool_ride_requests_customer_status
ON pool_ride_requests (customer_id, status);

-- ─── Step 4: Record migration ─────────────────────────────────────────────────
-- If your project tracks applied migrations in a table, insert here:
-- INSERT INTO schema_migrations (version, applied_at)
-- VALUES ('0009_pool_active_booking_unique_constraint', NOW())
-- ON CONFLICT (version) DO NOTHING;
