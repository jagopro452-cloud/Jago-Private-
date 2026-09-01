import { pool } from "./db";

/**
 * Every statement below is a best-effort, idempotent repair (IF NOT EXISTS /
 * ADD COLUMN IF NOT EXISTS) run on every boot — failures are expected when the
 * object already exists on a given DB, so execution intentionally continues
 * past a failing statement. This logger makes those failures visible instead
 * of silently discarding them, without changing that continue-past behavior.
 */
function logBootstrapStepError(step: string) {
  return (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[schema-health] bootstrap step failed: ${step} — ${message}`);
  };
}

/** Auto-repair tables/indexes that block boot on legacy production DBs. */
export async function ensureBootstrapSchema() {
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
    )
  `).catch(logBootstrapStepError("create table booking_intents"));

  await pool.query(`
    CREATE TABLE IF NOT EXISTS commission_settlements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      driver_id UUID REFERENCES users(id) ON DELETE SET NULL,
      trip_id UUID,
      settlement_type VARCHAR(50) DEFAULT 'commission',
      commission_amount NUMERIC(12, 2) DEFAULT 0,
      gst_amount NUMERIC(12, 2) DEFAULT 0,
      total_amount NUMERIC(12, 2) DEFAULT 0,
      direction VARCHAR(20) DEFAULT 'debit',
      balance_before NUMERIC(12, 2) DEFAULT 0,
      balance_after NUMERIC(12, 2) DEFAULT 0,
      service_type VARCHAR(50),
      payment_method VARCHAR(30),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(logBootstrapStepError("create table commission_settlements"));

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ledger_entries_trip_id ON ledger_entries(trip_id)`).catch(logBootstrapStepError("create index idx_ledger_entries_trip_id"));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_booking_intents_customer ON booking_intents(customer_id)`).catch(logBootstrapStepError("create index idx_booking_intents_customer"));
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_requests_booking_intent
    ON trip_requests(booking_intent_id) WHERE booking_intent_id IS NOT NULL
  `).catch(logBootstrapStepError("create index idx_trip_requests_booking_intent"));

  await pool.query(`
    ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS booking_intent_id UUID
  `).catch(logBootstrapStepError("customer_payments.booking_intent_id"));
  await pool.query(`
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS booking_intent_id UUID
  `).catch(logBootstrapStepError("trip_requests.booking_intent_id"));
  await pool.query(`
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50)
  `).catch(logBootstrapStepError("trip_requests.coupon_code"));
  await pool.query(`
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2) DEFAULT 0
  `).catch(logBootstrapStepError("trip_requests.discount_amount"));
  await pool.query(`
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS original_fare NUMERIC(12, 2) DEFAULT 0
  `).catch(logBootstrapStepError("trip_requests.original_fare"));
  await pool.query(`
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(12, 2) DEFAULT 0
  `).catch(logBootstrapStepError("trip_requests.commission_amount"));
  await pool.query(`
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(120)
  `).catch(logBootstrapStepError("trip_requests.razorpay_payment_id"));
  await pool.query(`
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS offered_driver_id UUID REFERENCES users(id) ON DELETE SET NULL
  `).catch(logBootstrapStepError("trip_requests.offered_driver_id"));
  await pool.query(`
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS offer_expires_at TIMESTAMPTZ
  `).catch(logBootstrapStepError("trip_requests.offer_expires_at"));
  await pool.query(`
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS offer_payload JSONB DEFAULT '{}'::jsonb
  `).catch(logBootstrapStepError("trip_requests.offer_payload"));
  await pool.query(`
    ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(50)
  `).catch(logBootstrapStepError("driver_details.vehicle_number"));
  await pool.query(`
    ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS vehicle_model VARCHAR(100)
  `).catch(logBootstrapStepError("driver_details.vehicle_model"));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_devices (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      fcm_token TEXT,
      device_type VARCHAR(30) DEFAULT 'android',
      app_version VARCHAR(40) DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(logBootstrapStepError("create table user_devices"));
  await pool.query(`
    ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS vehicle_subcategory VARCHAR(100) DEFAULT ''
  `).catch(logBootstrapStepError("driver_details.vehicle_subcategory"));
  await pool.query(`
    ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS city_eligibility TEXT[] DEFAULT '{}'::text[]
  `).catch(logBootstrapStepError("driver_details.city_eligibility"));
  // Persistent, driver-set "Available for Car Share?" flag on their
  // registered vehicle — separate from the per-shift Local Pool Mode
  // toggle. A driver must enable this once before Pool Mode can be started.
  await pool.query(`
    ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS car_share_enabled BOOLEAN DEFAULT false
  `).catch(logBootstrapStepError("driver_details.car_share_enabled"));
  // Persistent, driver-set "Enable Intercity?" capability flag on their
  // registered vehicle — gates Outstation Pool ride-posting/availability,
  // independent of car_share_enabled. Deliberately a fresh column rather
  // than the pre-existing outstation_eligibility/intercity_eligibility
  // pair: neither is read by the actual outstation-pool-v2.ts/matcher.ts
  // code, both default true (wrong direction for a new capability gate),
  // and only one of the two even has admin UI.
  await pool.query(`
    ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS intercity_enabled BOOLEAN DEFAULT false
  `).catch(logBootstrapStepError("driver_details.intercity_enabled"));
  // Pre-existing gap: update-registration's driver_details upsert writes
  // updated_at=now(), but the live production table never had this column —
  // every registration submit that included a vehicleType failed outright
  // with "column \"updated_at\" of relation \"driver_details\" does not exist".
  await pool.query(`
    ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `).catch(logBootstrapStepError("driver_details.updated_at"));
  // Pre-existing gap: /pool/cancel writes cancel_reason/refund_amount/
  // cancelled_at, but the original pool_ride_requests CREATE TABLE never
  // included them — cancelling a Car Share booking was failing with
  // "column refund_amount does not exist" before these were added.
  await pool.query(`
    ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS cancel_reason TEXT
  `).catch(logBootstrapStepError("pool_ride_requests.cancel_reason"));
  await pool.query(`
    ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(12, 2) DEFAULT 0
  `).catch(logBootstrapStepError("pool_ride_requests.refund_amount"));
  await pool.query(`
    ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP
  `).catch(logBootstrapStepError("pool_ride_requests.cancelled_at"));
  await pool.query(`
    ALTER TABLE vehicle_categories ADD COLUMN IF NOT EXISTS total_seats INTEGER DEFAULT 4
  `).catch(logBootstrapStepError("vehicle_categories.total_seats"));
  await pool.query(`
    ALTER TABLE vehicle_categories ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(50)
  `).catch(logBootstrapStepError("vehicle_categories.vehicle_type"));
  await pool.query(`
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS seats_booked INTEGER DEFAULT 1
  `).catch(logBootstrapStepError("trip_requests.seats_booked"));
  await pool.query(`
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS vehicle_type_name VARCHAR(100)
  `).catch(logBootstrapStepError("trip_requests.vehicle_type_name"));
  await pool.query(`
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS seat_price NUMERIC(10, 2) DEFAULT 0
  `).catch(logBootstrapStepError("trip_requests.seat_price"));
  await pool.query(`
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS driver_fare NUMERIC(12, 2) DEFAULT 0
  `).catch(logBootstrapStepError("trip_requests.driver_fare"));
  await pool.query(`
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS customer_fare NUMERIC(12, 2) DEFAULT 0
  `).catch(logBootstrapStepError("trip_requests.customer_fare"));
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS prefer_female_driver BOOLEAN DEFAULT false
  `).catch(logBootstrapStepError("users.prefer_female_driver"));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      quiet_ride BOOLEAN DEFAULT false,
      ac_preferred BOOLEAN DEFAULT true,
      music_off BOOLEAN DEFAULT false,
      wheelchair_accessible BOOLEAN DEFAULT false,
      extra_luggage BOOLEAN DEFAULT false,
      preferred_gender VARCHAR(20) DEFAULT 'any',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(logBootstrapStepError("create table user_preferences"));
  await pool.query(`
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS tips NUMERIC(10, 2) DEFAULT 0
  `).catch(logBootstrapStepError("trip_requests.tips"));
  await pool.query(`
    ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS pending_payment_amount NUMERIC(12, 2) DEFAULT 0
  `).catch(logBootstrapStepError("trip_requests.pending_payment_amount"));

  // Transactional outbox for pool settlement — prevents lost/duplicate settlements
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pool_settlement_outbox (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id UUID NOT NULL,
      module VARCHAR(30) NOT NULL,
      driver_id UUID NOT NULL,
      fare NUMERIC(12,2) NOT NULL,
      payment_method VARCHAR(30) NOT NULL DEFAULT 'cash',
      service_label VARCHAR(50) NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(logBootstrapStepError("create table pool_settlement_outbox"));
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_settlement_outbox_booking_id
    ON pool_settlement_outbox (booking_id)
  `).catch(logBootstrapStepError("create index idx_pool_settlement_outbox_booking_id"));
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pool_settlement_outbox_status_retry
    ON pool_settlement_outbox (status, retry_count)
    WHERE status IN ('pending', 'processing')
  `).catch(logBootstrapStepError("create index idx_pool_settlement_outbox_status_retry"));

  // settlement_status + outbox linkage on pool booking tables
  await pool.query(`ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS settlement_status VARCHAR(20) DEFAULT 'pending'`).catch(logBootstrapStepError("pool_ride_requests.settlement_status"));
  await pool.query(`ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS settlement_outbox_id UUID`).catch(logBootstrapStepError("pool_ride_requests.settlement_outbox_id"));
  await pool.query(`ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS settlement_status VARCHAR(20) DEFAULT 'pending'`).catch(logBootstrapStepError("outstation_pool_bookings.settlement_status"));
  await pool.query(`ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS settlement_outbox_id UUID`).catch(logBootstrapStepError("outstation_pool_bookings.settlement_outbox_id"));
  // 'seat' (default, shared) or 'whole_car' (exclusive — booking consumes
  // every seat on the ride and the ride stops accepting further requests).
  await pool.query(`ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS booking_mode VARCHAR(20) DEFAULT 'seat'`).catch(logBootstrapStepError("outstation_pool_bookings.booking_mode"));

  // Generic admin key/value settings store — used by dispatch.ts's DB-driven
  // dispatch_configs override (falls back to hardcoded defaults if no row exists)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      key VARCHAR(100) PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(logBootstrapStepError("create table admin_settings"));

  // spin_wheel_plays.item_id was created as integer but spin_wheel_items.id is uuid —
  // every play insert failed with "column is of type integer but expression is of type
  // uuid" before this fix, so no legacy integer data exists to migrate.
  await pool.query(`
    ALTER TABLE spin_wheel_plays ALTER COLUMN item_id TYPE UUID USING item_id::text::uuid
  `).catch(logBootstrapStepError("spin_wheel_plays.item_id type change"));

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pool_user_blocks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      blocker_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      module VARCHAR(30) NOT NULL DEFAULT 'local_pool',
      reason TEXT,
      created_by_role VARCHAR(20) DEFAULT 'driver',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(logBootstrapStepError("create table pool_user_blocks"));

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_user_blocks_unique_active
    ON pool_user_blocks (blocker_user_id, blocked_user_id, module)
    WHERE active = true
  `).catch(logBootstrapStepError("create index idx_pool_user_blocks_unique_active"));

  // Transactional outbox for trip completion notifications — prevents lost events
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outbox_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type VARCHAR(50) NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      processed BOOLEAN DEFAULT false,
      processing BOOLEAN DEFAULT false,
      failed BOOLEAN DEFAULT false,
      processing_started_at TIMESTAMPTZ,
      next_attempt_at TIMESTAMPTZ,
      attempts INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(logBootstrapStepError("create table outbox_events"));

  // Enforce one active trip per driver/customer (race condition guard)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_one_active_trip
    ON trip_requests (driver_id)
    WHERE driver_id IS NOT NULL
      AND current_status IN ('driver_assigned', 'accepted', 'arrived', 'on_the_way')
  `).catch(logBootstrapStepError("create index uq_driver_one_active_trip"));

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_one_active_trip
    ON trip_requests (customer_id)
    WHERE customer_id IS NOT NULL
      AND current_status IN ('searching', 'driver_assigned', 'accepted', 'arrived', 'on_the_way')
  `).catch(logBootstrapStepError("create index uq_customer_one_active_trip"));
}

type TableColumnCheck = {
  table: string;
  columns: string[];
};

type IndexCheck = {
  table: string;
  pattern: string;
  description: string;
};

const requiredTables = [
  "admins",
  "admin_sessions",
  "admin_refresh_tokens",
  "admin_login_otp",
  "admin_otp_resets",
  "sessions",
  "refresh_tokens",
  "otp_request_events",
  "driver_documents",
  "booking_intents",
  "wallet_events",
  "company_wallet_events",
  "customer_payments",
  "driver_payments",
  "withdraw_requests",
  "trip_requests",
  "transactions",
  "referrals",
];

const requiredColumns: TableColumnCheck[] = [
  { table: "customer_payments", columns: ["booking_intent_id", "payment_context", "trip_id", "razorpay_order_id", "payment_type", "status"] },
  { table: "driver_payments", columns: ["trip_id", "plan_id", "insurance_plan_id", "payment_context", "razorpay_order_id", "payment_type", "status"] },
  { table: "withdraw_requests", columns: ["driver_payment_id", "user_id", "status", "amount"] },
  { table: "trip_requests", columns: ["booking_intent_id", "customer_id", "payment_status", "current_status"] },
  { table: "booking_intents", columns: ["customer_id", "status", "razorpay_order_id", "razorpay_payment_id"] },
  { table: "wallet_events", columns: ["user_id", "amount", "type", "reason", "created_at"] },
  { table: "company_wallet_events", columns: ["company_id", "amount", "type", "reason", "created_at"] },
  { table: "admin_sessions", columns: ["admin_id", "token", "device_id", "expires_at"] },
  { table: "sessions", columns: ["user_id", "token", "device_id", "expires_at"] },
  { table: "driver_documents", columns: ["driver_id", "doc_type", "file_url", "file_data", "mime_type", "status"] },
];

const requiredIndexes: IndexCheck[] = [
  { table: "customer_payments", pattern: "%razorpay_order_id%payment_type%", description: "customer_payments unique order/payment type index" },
  { table: "customer_payments", pattern: "%booking_intent_id%", description: "customer_payments booking_intent_id unique linkage index" },
  { table: "driver_payments", pattern: "%razorpay_order_id%payment_type%", description: "driver_payments unique order/payment type index" },
  { table: "withdraw_requests", pattern: "%driver_payment_id%", description: "withdraw_requests driver_payment_id unique/indexed linkage" },
  { table: "trip_requests", pattern: "%booking_intent_id%", description: "trip_requests booking_intent_id unique linkage index" },
  { table: "wallet_events", pattern: "%user_id%created_at%", description: "wallet_events user/time lookup index" },
  { table: "sessions", pattern: "%token%", description: "sessions token index" },
  { table: "admin_sessions", pattern: "%token%", description: "admin_sessions token index" },
];

const requiredForeignKeys = [
  { table: "customer_payments", column: "customer_id", references: "users" },
  { table: "customer_payments", column: "trip_id", references: "trip_requests" },
  { table: "customer_payments", column: "booking_intent_id", references: "booking_intents" },
  { table: "driver_payments", column: "driver_id", references: "users" },
  { table: "driver_payments", column: "trip_id", references: "trip_requests" },
  { table: "withdraw_requests", column: "user_id", references: "users" },
  { table: "withdraw_requests", column: "driver_payment_id", references: "driver_payments" },
  { table: "trip_requests", column: "customer_id", references: "users" },
  { table: "trip_requests", column: "driver_id", references: "users" },
  { table: "trip_requests", column: "booking_intent_id", references: "booking_intents" },
  { table: "transactions", column: "user_id", references: "users" },
  { table: "transactions", column: "trip_id", references: "trip_requests" },
  { table: "wallet_events", column: "user_id", references: "users" },
  { table: "referrals", column: "referrer_id", references: "users" },
  { table: "referrals", column: "referred_id", references: "users" },
  { table: "company_wallet_events", column: "company_id", references: "b2b_companies" },
];

type SchemaAssertionInput = {
  tables?: string[];
  columns?: TableColumnCheck[];
  indexes?: IndexCheck[];
  foreignKeys?: Array<{ table: string; column: string; references: string }>;
};

async function assertTablesExist(tables: string[]) {
  if (!tables.length) return;
  const result = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1::text[])`,
    [tables],
  );
  const present = new Set(result.rows.map((row) => String(row.tablename)));
  const missing = tables.filter((table) => !present.has(table));
  if (missing.length) {
    throw new Error(`Missing required tables: ${missing.join(", ")}`);
  }
}

async function assertColumnsExist(checks: TableColumnCheck[]) {
  for (const check of checks) {
    const result = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name = ANY($2::text[])`,
      [check.table, check.columns],
    );
    const present = new Set(result.rows.map((row) => String(row.column_name)));
    const missing = check.columns.filter((column) => !present.has(column));
    if (missing.length) {
      throw new Error(`Missing required columns on ${check.table}: ${missing.join(", ")}`);
    }
  }
}

async function assertIndexesExist(checks: IndexCheck[]) {
  for (const check of checks) {
    const result = await pool.query(
      `SELECT 1
       FROM pg_indexes
       WHERE schemaname='public'
         AND tablename=$1
         AND indexdef ILIKE $2
       LIMIT 1`,
      [check.table, check.pattern],
    );
    if (!result.rowCount) {
      throw new Error(`Missing required index on ${check.table}: ${check.description}`);
    }
  }
}

async function assertForeignKeysExist(checks: Array<{ table: string; column: string; references: string }>) {
  for (const check of checks) {
    const result = await pool.query(
      `SELECT 1
       FROM information_schema.key_column_usage kcu
       JOIN information_schema.referential_constraints rc
         ON rc.constraint_schema = kcu.constraint_schema
        AND rc.constraint_name = kcu.constraint_name
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_schema = rc.unique_constraint_schema
        AND ccu.constraint_name = rc.unique_constraint_name
       WHERE kcu.table_schema='public'
         AND kcu.table_name=$1
         AND kcu.column_name=$2
         AND ccu.table_name=$3
       LIMIT 1`,
      [check.table, check.column, check.references],
    );
    if (!result.rowCount) {
      throw new Error(`Missing foreign key ${check.table}.${check.column} -> ${check.references}`);
    }
  }
}

export async function verifyCriticalSchemaOrThrow() {
  await ensureBootstrapSchema();
  await assertSchemaObjectsOrThrow({
    tables: requiredTables,
    columns: requiredColumns,
    indexes: requiredIndexes,
    foreignKeys: requiredForeignKeys,
  });
}

export async function assertSchemaObjectsOrThrow(input: SchemaAssertionInput) {
  await assertTablesExist(input.tables || []);
  await assertColumnsExist(input.columns || []);
  await assertIndexesExist(input.indexes || []);
  await assertForeignKeysExist(input.foreignKeys || []);
}
