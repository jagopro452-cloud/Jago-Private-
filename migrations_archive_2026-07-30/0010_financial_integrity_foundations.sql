CREATE TABLE IF NOT EXISTS booking_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status VARCHAR(40) NOT NULL DEFAULT 'initiated',
  quoted_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(40),
  trip_type VARCHAR(40) NOT NULL DEFAULT 'normal',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  razorpay_order_id VARCHAR(120),
  razorpay_payment_id VARCHAR(120),
  trip_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_intents_customer ON booking_intents(customer_id);
CREATE INDEX IF NOT EXISTS idx_booking_intents_status ON booking_intents(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_intents_order ON booking_intents(razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_intents_payment ON booking_intents(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS company_wallet_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES b2b_companies(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  type VARCHAR(16) NOT NULL,
  reason TEXT NOT NULL,
  ref_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_wallet_events_company ON company_wallet_events(company_id, created_at DESC);

ALTER TABLE driver_payments ADD COLUMN IF NOT EXISTS trip_id UUID;
ALTER TABLE driver_payments ADD COLUMN IF NOT EXISTS plan_id UUID;
ALTER TABLE driver_payments ADD COLUMN IF NOT EXISTS insurance_plan_id UUID;
ALTER TABLE driver_payments ADD COLUMN IF NOT EXISTS payment_context JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS trip_id UUID;
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS booking_intent_id UUID;
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS payment_context JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE withdraw_requests ADD COLUMN IF NOT EXISTS driver_payment_id UUID;
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS booking_intent_id UUID;

DELETE FROM customer_payments cp
WHERE NOT EXISTS (
  SELECT 1 FROM users u WHERE u.id = cp.customer_id
);

UPDATE customer_payments cp
SET trip_id = NULL
WHERE trip_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM trip_requests t WHERE t.id = cp.trip_id
  );

UPDATE customer_payments cp
SET booking_intent_id = NULL
WHERE booking_intent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM booking_intents bi WHERE bi.id = cp.booking_intent_id
  );

DELETE FROM driver_payments dp
WHERE NOT EXISTS (
  SELECT 1 FROM users u WHERE u.id = dp.driver_id
);

UPDATE driver_payments dp
SET trip_id = NULL
WHERE trip_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM trip_requests t WHERE t.id = dp.trip_id
  );

UPDATE driver_payments dp
SET plan_id = NULL
WHERE plan_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM subscription_plans sp WHERE sp.id = dp.plan_id
  );

UPDATE driver_payments dp
SET insurance_plan_id = NULL
WHERE insurance_plan_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM insurance_plans ip WHERE ip.id = dp.insurance_plan_id
  );

DELETE FROM withdraw_requests wr
WHERE user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = wr.user_id
  );

UPDATE withdraw_requests wr
SET driver_payment_id = NULL
WHERE driver_payment_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM driver_payments dp WHERE dp.id = wr.driver_payment_id
  );

UPDATE trip_requests tr
SET customer_id = NULL
WHERE customer_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = tr.customer_id
  );

UPDATE trip_requests tr
SET driver_id = NULL
WHERE driver_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = tr.driver_id
  );

UPDATE trip_requests tr
SET vehicle_category_id = NULL
WHERE vehicle_category_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM vehicle_categories vc WHERE vc.id = tr.vehicle_category_id
  );

UPDATE trip_requests tr
SET zone_id = NULL
WHERE zone_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM zones z WHERE z.id = tr.zone_id
  );

UPDATE transactions tx
SET user_id = NULL
WHERE user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = tx.user_id
  );

UPDATE transactions tx
SET trip_id = NULL
WHERE trip_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM trip_requests tr WHERE tr.id = tx.trip_id
  );

DELETE FROM driver_details dd
WHERE user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = dd.user_id
  );

UPDATE driver_details dd
SET vehicle_category_id = NULL
WHERE vehicle_category_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM vehicle_categories vc WHERE vc.id = dd.vehicle_category_id
  );

UPDATE driver_details dd
SET zone_id = NULL
WHERE zone_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM zones z WHERE z.id = dd.zone_id
  );

DELETE FROM referrals r
WHERE NOT EXISTS (
  SELECT 1 FROM users u WHERE u.id = r.referrer_id
);

UPDATE referrals r
SET referred_id = NULL
WHERE referred_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = r.referred_id
  );

UPDATE b2b_companies c
SET owner_id = NULL
WHERE owner_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = c.owner_id
  );

UPDATE vehicle_models vm
SET brand_id = NULL
WHERE brand_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM vehicle_brands vb WHERE vb.id = vm.brand_id
  );

DELETE FROM customer_payments cp
USING customer_payments dup
WHERE cp.id < dup.id
  AND cp.payment_type = dup.payment_type
  AND cp.razorpay_order_id IS NOT NULL
  AND cp.razorpay_order_id = dup.razorpay_order_id;

DELETE FROM driver_payments dp
USING driver_payments dup
WHERE dp.id < dup.id
  AND dp.payment_type = dup.payment_type
  AND dp.razorpay_order_id IS NOT NULL
  AND dp.razorpay_order_id = dup.razorpay_order_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_payments_order_type
  ON customer_payments(razorpay_order_id, payment_type)
  WHERE razorpay_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_payments_payment_type
  ON customer_payments(razorpay_payment_id, payment_type)
  WHERE razorpay_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_payments_order_type
  ON driver_payments(razorpay_order_id, payment_type)
  WHERE razorpay_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_payments_payment_type
  ON driver_payments(razorpay_payment_id, payment_type)
  WHERE razorpay_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_payments_booking_intent
  ON customer_payments(booking_intent_id)
  WHERE booking_intent_id IS NOT NULL AND payment_type = 'ride_payment';

CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_requests_booking_intent
  ON trip_requests(booking_intent_id)
  WHERE booking_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_withdraw_requests_driver_payment
  ON withdraw_requests(driver_payment_id)
  WHERE driver_payment_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_payments_customer_fk') THEN
    ALTER TABLE customer_payments
      ADD CONSTRAINT customer_payments_customer_fk
      FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_payments_trip_fk') THEN
    ALTER TABLE customer_payments
      ADD CONSTRAINT customer_payments_trip_fk
      FOREIGN KEY (trip_id) REFERENCES trip_requests(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_payments_booking_intent_fk') THEN
    ALTER TABLE customer_payments
      ADD CONSTRAINT customer_payments_booking_intent_fk
      FOREIGN KEY (booking_intent_id) REFERENCES booking_intents(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_payments_driver_fk') THEN
    ALTER TABLE driver_payments
      ADD CONSTRAINT driver_payments_driver_fk
      FOREIGN KEY (driver_id) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_payments_trip_fk') THEN
    ALTER TABLE driver_payments
      ADD CONSTRAINT driver_payments_trip_fk
      FOREIGN KEY (trip_id) REFERENCES trip_requests(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_payments_plan_fk') THEN
    ALTER TABLE driver_payments
      ADD CONSTRAINT driver_payments_plan_fk
      FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_payments_insurance_plan_fk') THEN
    ALTER TABLE driver_payments
      ADD CONSTRAINT driver_payments_insurance_plan_fk
      FOREIGN KEY (insurance_plan_id) REFERENCES insurance_plans(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'withdraw_requests_user_fk') THEN
    ALTER TABLE withdraw_requests
      ADD CONSTRAINT withdraw_requests_user_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'withdraw_requests_driver_payment_fk') THEN
    ALTER TABLE withdraw_requests
      ADD CONSTRAINT withdraw_requests_driver_payment_fk
      FOREIGN KEY (driver_payment_id) REFERENCES driver_payments(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_requests_customer_fk') THEN
    ALTER TABLE trip_requests
      ADD CONSTRAINT trip_requests_customer_fk
      FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_requests_driver_fk') THEN
    ALTER TABLE trip_requests
      ADD CONSTRAINT trip_requests_driver_fk
      FOREIGN KEY (driver_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_requests_vehicle_category_fk') THEN
    ALTER TABLE trip_requests
      ADD CONSTRAINT trip_requests_vehicle_category_fk
      FOREIGN KEY (vehicle_category_id) REFERENCES vehicle_categories(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_requests_zone_fk') THEN
    ALTER TABLE trip_requests
      ADD CONSTRAINT trip_requests_zone_fk
      FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_requests_booking_intent_fk') THEN
    ALTER TABLE trip_requests
      ADD CONSTRAINT trip_requests_booking_intent_fk
      FOREIGN KEY (booking_intent_id) REFERENCES booking_intents(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_user_fk') THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_user_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_trip_fk') THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_trip_fk
      FOREIGN KEY (trip_id) REFERENCES trip_requests(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_details_user_fk') THEN
    ALTER TABLE driver_details
      ADD CONSTRAINT driver_details_user_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_details_vehicle_category_fk') THEN
    ALTER TABLE driver_details
      ADD CONSTRAINT driver_details_vehicle_category_fk
      FOREIGN KEY (vehicle_category_id) REFERENCES vehicle_categories(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'driver_details_zone_fk') THEN
    ALTER TABLE driver_details
      ADD CONSTRAINT driver_details_zone_fk
      FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referrals_referrer_fk') THEN
    ALTER TABLE referrals
      ADD CONSTRAINT referrals_referrer_fk
      FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referrals_referred_fk') THEN
    ALTER TABLE referrals
      ADD CONSTRAINT referrals_referred_fk
      FOREIGN KEY (referred_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'b2b_companies_owner_fk') THEN
    ALTER TABLE b2b_companies
      ADD CONSTRAINT b2b_companies_owner_fk
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_models_brand_fk') THEN
    ALTER TABLE vehicle_models
      ADD CONSTRAINT vehicle_models_brand_fk
      FOREIGN KEY (brand_id) REFERENCES vehicle_brands(id) ON DELETE SET NULL;
  END IF;
END $$;
