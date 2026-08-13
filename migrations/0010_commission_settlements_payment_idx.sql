-- Phase 1, P0 fix — driver commission-payment settlement crash (sibling of 0009).
--
-- settleDriverCommissionPayment() (server/payment-settlement.ts), reached via
-- the same real path as subscriptions (create-order -> verify-payment ->
-- settleDriverPaymentByOrder), inserts into commission_settlements with
-- "ON CONFLICT (razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL
-- DO NOTHING" for idempotency (a retried/duplicate Razorpay payment must not
-- double-insert a settlement row). No unique index backing that predicate
-- exists on commission_settlements (only the primary key on id) - Postgres
-- requires an exact matching unique/exclusion constraint for any ON CONFLICT
-- target, so every real commission-dues payment failed with
-- "42P10: no unique or exclusion constraint matching the ON CONFLICT
-- specification", discovered live-verifying the same statement after fixing
-- the pending_payment_amount crash in the same function. Adding the index
-- preserves the existing idempotency design intent rather than removing it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_settlements_rzp_payment_id
  ON public.commission_settlements (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;
