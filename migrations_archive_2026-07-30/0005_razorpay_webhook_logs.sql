-- ============================================================================
-- Migration 0005: Razorpay webhook audit log + subscription/payment hardening
-- ============================================================================

-- ── razorpay_webhook_logs ────────────────────────────────────────────────────
-- Central audit table for every inbound Razorpay webhook event.
-- UNIQUE constraint on event_id provides idempotency: inserting a duplicate
-- event_id returns 0 rows so the handler can skip processing.
CREATE TABLE IF NOT EXISTS razorpay_webhook_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    VARCHAR(120) NOT NULL,
  event_type  VARCHAR(80)  NOT NULL,
  payload     JSONB,
  processed   BOOLEAN      NOT NULL DEFAULT false,
  error_msg   TEXT,
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rzp_webhook_event_id
  ON razorpay_webhook_logs(event_id);

CREATE INDEX IF NOT EXISTS idx_rzp_webhook_event_type
  ON razorpay_webhook_logs(event_type);

CREATE INDEX IF NOT EXISTS idx_rzp_webhook_created
  ON razorpay_webhook_logs(created_at DESC);

-- ── driver_subscriptions: add Razorpay tracking columns ─────────────────────
ALTER TABLE driver_subscriptions
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id VARCHAR(120),
  ADD COLUMN IF NOT EXISTS razorpay_order_id        VARCHAR(120),
  ADD COLUMN IF NOT EXISTS razorpay_payment_id      VARCHAR(120),
  ADD COLUMN IF NOT EXISTS subscription_status      VARCHAR(30) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS failure_reason           TEXT;

CREATE INDEX IF NOT EXISTS idx_driver_subs_rzp_sub_id
  ON driver_subscriptions(razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_driver_subs_status
  ON driver_subscriptions(subscription_status);

-- ── driver_payments: add failure tracking + updated_at ──────────────────────
ALTER TABLE driver_payments
  ADD COLUMN IF NOT EXISTS failure_reason   TEXT,
  ADD COLUMN IF NOT EXISTS payment_purpose  VARCHAR(60) NOT NULL DEFAULT 'driver_payment',
  ADD COLUMN IF NOT EXISTS customer_id      UUID,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMP NOT NULL DEFAULT NOW();

-- ── customer_payments: track customer wallet topups / ride payments ──────────
-- Mirrors driver_payments but for customers, enabling webhook reconciliation
-- of customer-side Razorpay orders without touching driver_payments.
CREATE TABLE IF NOT EXISTS customer_payments (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          UUID        NOT NULL,
  amount               NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_type         VARCHAR(60)  NOT NULL DEFAULT 'wallet_topup',
  razorpay_order_id    VARCHAR(120),
  razorpay_payment_id  VARCHAR(120),
  status               VARCHAR(30)  NOT NULL DEFAULT 'pending',
  failure_reason       TEXT,
  description          TEXT,
  verified_at          TIMESTAMP,
  created_at           TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_payments_customer
  ON customer_payments(customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_payments_order
  ON customer_payments(razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_payments_payment_id
  ON customer_payments(razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_payments_status
  ON customer_payments(status);

-- ── admin_revenue: ensure table exists (used throughout routes.ts) ───────────
CREATE TABLE IF NOT EXISTS admin_revenue (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    UUID,
  customer_id  UUID,
  trip_id      UUID,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  revenue_type VARCHAR(60)  NOT NULL,
  breakdown    JSONB,
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_revenue_driver
  ON admin_revenue(driver_id) WHERE driver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_revenue_type
  ON admin_revenue(revenue_type);

CREATE INDEX IF NOT EXISTS idx_admin_revenue_created
  ON admin_revenue(created_at DESC);
