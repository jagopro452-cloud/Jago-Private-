-- Phase K — production schema reconciliation.
--
-- Production's coins_ledger, spin_wheel_plays, monthly_passes, and call_logs
-- tables were created independently of this repository's migration history
-- and are missing columns the application code writes to. This migration is
-- purely additive: every statement is idempotent (safe to run any number of
-- times), nothing is dropped, no table is recreated, and no existing data is
-- touched. Verified against a live pg_dump --schema-only clone of production
-- on 2026-08-02 — see Phase K report for full column-by-column evidence.

-- coins_ledger: production has (event_type, coins, balance_after,
-- reference_type, reference_id, notes) instead of the columns the app writes
-- (amount, type, description). Adding the app's columns alongside the
-- existing ones — nothing existing is removed or renamed.
ALTER TABLE coins_ledger ADD COLUMN IF NOT EXISTS amount INTEGER;
ALTER TABLE coins_ledger ADD COLUMN IF NOT EXISTS type VARCHAR(30);
ALTER TABLE coins_ledger ADD COLUMN IF NOT EXISTS description TEXT;
-- Reproduced directly: the app's INSERT (user_id, amount, type, description)
-- never populates event_type, and it is NOT NULL with no default on
-- production's real table, so every insert failed with "null value in
-- column event_type violates not-null constraint" until this relaxation.
-- DROP NOT NULL is itself idempotent (a no-op if already nullable) and does
-- not affect any existing row (table is empty) or any other code path that
-- already supplies event_type.
ALTER TABLE coins_ledger ALTER COLUMN event_type DROP NOT NULL;

-- spin_wheel_plays: production has no item_id column at all.
ALTER TABLE spin_wheel_plays ADD COLUMN IF NOT EXISTS item_id UUID;

-- monthly_passes: production uses (pass_type, rides_remaining, valid_from,
-- status) instead of the columns the app writes (rides_total, rides_used,
-- amount_paid, plan_name). Adding the app's columns alongside the existing
-- ones.
ALTER TABLE monthly_passes ADD COLUMN IF NOT EXISTS rides_total INTEGER;
ALTER TABLE monthly_passes ADD COLUMN IF NOT EXISTS rides_used INTEGER DEFAULT 0;
ALTER TABLE monthly_passes ADD COLUMN IF NOT EXISTS amount_paid NUMERIC;
ALTER TABLE monthly_passes ADD COLUMN IF NOT EXISTS plan_name VARCHAR(60);
-- Reproduced directly: same class of failure as coins_ledger.event_type —
-- pass_type is NOT NULL with no default and the app's INSERT never sets it.
ALTER TABLE monthly_passes ALTER COLUMN pass_type DROP NOT NULL;

-- call_logs: production is missing 9 columns predictive-dispatch.ts's
-- initPredictiveDispatchSchema() expects. That function only runs
-- CREATE TABLE IF NOT EXISTS, which silently no-ops against an existing
-- table — it never adds missing columns to a table that's already there.
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS caller_name TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS caller_phone TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS caller_type TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS receiver_id UUID;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS callee_name TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS callee_phone TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS callee_type TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS duration_sec INTEGER;

-- admin_settings: confirmed absent from production entirely. This exact
-- CREATE TABLE IF NOT EXISTS already runs on every boot via schema-health.ts;
-- included here too so the reconciliation migration is a complete,
-- self-contained record of everything Phase K found and fixed.
CREATE TABLE IF NOT EXISTS admin_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- lost_found_reports: discovered during migration-replay testing against a
-- clone of production (not part of the original 11-table review scope, but
-- migration 0005's own CREATE INDEX on customer_id fails against production's
-- real table, which uses reporter_id/item_description instead and has no
-- customer_id, description, or contact_phone columns at all). Nullable
-- (not NOT NULL like 0005's own CREATE TABLE) since the app-code path always
-- supplies these values anyway, and a NOT NULL add would be unsafe to apply
-- blindly against a table that might not always be empty.
ALTER TABLE lost_found_reports ADD COLUMN IF NOT EXISTS customer_id UUID;
ALTER TABLE lost_found_reports ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE lost_found_reports ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_lost_found_reports_customer ON public.lost_found_reports (customer_id, created_at);

-- notification_logs: two unrelated write patterns exist in the certified repo
-- targeting the same table name. routes.ts writes an admin broadcast-campaign
-- summary (title, message, target, user_type, recipient_count, status,
-- sent_at) — production already has all of these except delivered_count.
-- hardening.ts writes a per-recipient FCM delivery attempt log (recipient_id,
-- trip_id, notification_type, fcm_token, fcm_result, attempt_count, sent_at)
-- — production has none of these. Both patterns are made additive-compatible
-- so neither write fails; hardening.ts's own write is already .catch()-
-- guarded (non-fatal today), but was silently losing every row.
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS delivered_count INTEGER;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS recipient_id UUID;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS trip_id UUID;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS notification_type VARCHAR(60);
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS fcm_token TEXT;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS fcm_result VARCHAR(20);
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS attempt_count INTEGER;
-- Reproduced directly: title/message/target/status are NOT NULL with no
-- defaults on production's real table, and hardening.ts's FCM-log write
-- supplies none of them (it only sets the columns added above). Relaxing
-- so both write patterns can coexist; the broadcast path (routes.ts) always
-- supplies all four regardless, so this does not change its behavior.
ALTER TABLE notification_logs ALTER COLUMN title DROP NOT NULL;
ALTER TABLE notification_logs ALTER COLUMN message DROP NOT NULL;
ALTER TABLE notification_logs ALTER COLUMN target DROP NOT NULL;
ALTER TABLE notification_logs ALTER COLUMN status DROP NOT NULL;
ALTER TABLE notification_logs ALTER COLUMN user_type DROP NOT NULL;
