-- Fix: outstation_driver_availability.status and outstation_pool_requests.status
-- were defined as varchar(20), too short for the value 'pending_driver_accept' (21
-- chars) used by the matcher. Widen to varchar(32) to match the same status column
-- on pool_ride_requests / driver_pool_sessions, which use the same status vocabulary.
--
-- Guarded: neither table exists on production as of this reconciliation (confirmed
-- via to_regclass()) - these are part of the not-yet-implemented scheduled
-- outstation-pool auto-assignment upgrade. A bare ALTER TABLE on a database that
-- never had this feature built would fail with "relation does not exist" and abort
-- the whole migration chain (the same class of failure already fixed once for
-- 0005_missing_tables_audit_batch.sql and server/migrations/001_production_hardening.sql
-- - see those files for the identical guard pattern). No-ops safely if the tables
-- are absent; runs the intended width fix once they exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='outstation_driver_availability') THEN
    EXECUTE 'ALTER TABLE public.outstation_driver_availability ALTER COLUMN status TYPE character varying(32)';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='outstation_pool_requests') THEN
    EXECUTE 'ALTER TABLE public.outstation_pool_requests ALTER COLUMN status TYPE character varying(32)';
  END IF;
END $$;
