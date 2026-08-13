-- P0 fix — driver subscription activation crash.
--
-- settleDriverSubscription() (server/payment-settlement.ts) is the real,
-- live function every driver subscription purchase settles through
-- (create-order -> verify-payment -> settleDriverPaymentByOrder ->
-- settleDriverSubscription). It inserts into 4 columns that do not exist
-- on driver_subscriptions, crashing every real purchase.
--
-- Verified per-column before adding, not blindly:
--   - insurance_plan_id: KEEPING. Real, live feature - the driver app
--     (subscription_plans_screen.dart) lets a driver select an optional
--     insurance add-on and sends insurancePlanId to both create-order and
--     verify-payment. create-order already charges real money for it
--     (insurance_plans.premium_monthly). Nothing else on this table
--     records which insurance plan a subscription is linked to.
--   - insurance_amount: KEEPING. The itemized premium actually charged -
--     matches this codebase's established convention of storing GST/fee
--     breakdowns explicitly per financial event (trip_requests,
--     commission_settlements) rather than forcing callers to recompute.
--   - gst_amount: KEEPING. Same convention - the GST charged is real money
--     (create-order already includes it in the Razorpay order) and, since
--     sub_gst_pct is a mutable global setting, this is the only way to
--     know what rate applied to a *specific past* purchase.
--   - plan_base_price: DROPPING (removed from the INSERT in this same
--     commit, not added here). Zero references anywhere else in the
--     repo (server or client) - not read by any admin page, report, or
--     API response. Fully derivable when needed via
--     driver_subscriptions.plan_id -> subscription_plans.price (already
--     done at routes.ts:7468). Adding an unused column would violate
--     "do not blindly add columns."

ALTER TABLE public.driver_subscriptions
  ADD COLUMN IF NOT EXISTS gst_amount numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS insurance_amount numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS insurance_plan_id uuid REFERENCES public.insurance_plans(id);

-- Second, related root cause found while live-verifying the same statement:
-- settleDriverSubscription()'s INSERT uses
-- "ON CONFLICT (razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL"
-- for idempotency (a retried/duplicate Razorpay webhook or verify-payment
-- call for the same payment updates the existing row instead of erroring
-- or double-inserting) - but no unique index backing that exact predicate
-- exists on this table (confirmed via pg_indexes: only a plain, non-unique
-- index exists, and on razorpay_subscription_id, a different column).
-- Postgres requires an exact matching unique/exclusion constraint for any
-- ON CONFLICT target - without this index the statement fails with
-- "42P10: no unique or exclusion constraint matching the ON CONFLICT
-- specification" on every single call, columns notwithstanding. Adding
-- the index preserves the existing idempotency design intent rather than
-- removing it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_subscriptions_rzp_payment_id
  ON public.driver_subscriptions (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;
