import path from "path";
import dotenv from "dotenv";
import pg from "pg";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const databaseUrl = (process.env.DATABASE_URL || "").trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.match(/localhost|127\\.0\\.0\\.1/) ? false : { rejectUnauthorized: false },
});

async function main() {
  await pool.query(`
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
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_booking_intents_customer ON booking_intents(customer_id);
    CREATE INDEX IF NOT EXISTS idx_booking_intents_status ON booking_intents(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_intents_order
      ON booking_intents(razorpay_order_id)
      WHERE razorpay_order_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_intents_payment
      ON booking_intents(razorpay_payment_id)
      WHERE razorpay_payment_id IS NOT NULL;
  `);

  await pool.query(`
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
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_company_wallet_events_company
      ON company_wallet_events(company_id, created_at DESC);
  `);

  await pool.query(`
    ALTER TABLE driver_payments ADD COLUMN IF NOT EXISTS trip_id UUID;
    ALTER TABLE driver_payments ADD COLUMN IF NOT EXISTS plan_id UUID;
    ALTER TABLE driver_payments ADD COLUMN IF NOT EXISTS insurance_plan_id UUID;
    ALTER TABLE driver_payments ADD COLUMN IF NOT EXISTS payment_context JSONB NOT NULL DEFAULT '{}'::jsonb;

    ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS trip_id UUID;
    ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS booking_intent_id UUID;
    ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS payment_context JSONB NOT NULL DEFAULT '{}'::jsonb;

    ALTER TABLE withdraw_requests ADD COLUMN IF NOT EXISTS driver_payment_id UUID;
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS booking_intent_id UUID;
  `);

  await pool.query(`
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
    SET booking_intent_id = NULL
    WHERE booking_intent_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM booking_intents bi WHERE bi.id = tr.booking_intent_id
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
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_payments_order_type
      ON customer_payments(razorpay_order_id, payment_type)
      WHERE razorpay_order_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_payments_payment_type
      ON customer_payments(razorpay_payment_id, payment_type)
      WHERE razorpay_payment_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_payments_order_type
      ON driver_payments(razorpay_order_id, payment_type)
      WHERE razorpay_order_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_payments_booking_intent
      ON customer_payments(booking_intent_id)
      WHERE booking_intent_id IS NOT NULL AND payment_type = 'ride_payment';

    CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_requests_booking_intent
      ON trip_requests(booking_intent_id)
      WHERE booking_intent_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_withdraw_requests_driver_payment
      ON withdraw_requests(driver_payment_id)
      WHERE driver_payment_id IS NOT NULL;
  `);

  await pool.query(`
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
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_wallet_events_company_fk') THEN
        ALTER TABLE company_wallet_events
          ADD CONSTRAINT company_wallet_events_company_fk
          FOREIGN KEY (company_id) REFERENCES b2b_companies(id) ON DELETE CASCADE;
      END IF;
    END
    $$;
  `);

  console.log("bootstrapped booking_intents and company_wallet_events");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
