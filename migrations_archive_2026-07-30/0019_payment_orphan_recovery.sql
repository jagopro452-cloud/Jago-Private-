-- H1 Phase 2: Orphan payment recovery metadata + audit trail

ALTER TABLE booking_intents ADD COLUMN IF NOT EXISTS recovery_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE booking_intents ADD COLUMN IF NOT EXISTS last_recovery_at TIMESTAMPTZ;
ALTER TABLE booking_intents ADD COLUMN IF NOT EXISTS recovered_at TIMESTAMPTZ;
ALTER TABLE booking_intents ADD COLUMN IF NOT EXISTS recovery_error TEXT;

CREATE INDEX IF NOT EXISTS idx_booking_intents_orphan_recovery
  ON booking_intents(status, updated_at)
  WHERE trip_id IS NULL
    AND status IN ('payment_verified', 'booking_in_progress', 'recovery_pending', 'recovery_failed');

CREATE INDEX IF NOT EXISTS idx_customer_payments_orphan_ride
  ON customer_payments(payment_type, status, updated_at)
  WHERE payment_type = 'ride_payment'
    AND status = 'completed'
    AND trip_id IS NULL;

CREATE TABLE IF NOT EXISTS payment_recovery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_intent_id UUID REFERENCES booking_intents(id) ON DELETE SET NULL,
  customer_payment_id UUID,
  customer_id UUID,
  event_type VARCHAR(40) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_recovery_events_intent
  ON payment_recovery_events(booking_intent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_recovery_events_customer
  ON payment_recovery_events(customer_id, created_at DESC);
