-- Defense-in-depth for the driver-subscription settlement race fixed in payment-settlement.ts
-- (advisory lock now serializes concurrent settlements per driver). This partial unique index
-- makes "more than one active subscription per driver" impossible at the database level too —
-- verified live that 5-way concurrent settlement could otherwise leave 2 active rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_subscriptions_one_active
  ON driver_subscriptions(driver_id) WHERE is_active = true;
