-- Full module readiness: revenue engine, parcel, carpool, discounts, passes.
-- UTF-8 encoding required. Safe to re-run.

-- ── Revenue settlement audit ────────────────────────────────────────────────
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
  razorpay_payment_id TEXT,
  razorpay_order_id TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_gst_wallet (
  id SERIAL PRIMARY KEY,
  balance NUMERIC(14, 2) DEFAULT 0,
  total_collected NUMERIC(14, 2) DEFAULT 0,
  total_trips INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO company_gst_wallet (id, balance, total_collected, total_trips)
VALUES (1, 0, 0, 0) ON CONFLICT (id) DO NOTHING;

-- ── Trip discount / revenue columns ─────────────────────────────────────────
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50);
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS original_fare NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS driver_wallet_credit NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS user_discount NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS user_payable NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS ride_full_fare NUMERIC(12, 2) DEFAULT 0;

-- ── Users loyalty / referral ────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS jago_coins INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS completed_rides_count INTEGER DEFAULT 0;

-- ── Referrals payout tracking ───────────────────────────────────────────────
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP;

-- ── Subscription plans admin form ───────────────────────────────────────────
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_parcels INTEGER DEFAULT 0;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- ── Driver subscriptions column alignment ─────────────────────────────────────
ALTER TABLE driver_subscriptions ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(12, 2);
ALTER TABLE driver_subscriptions ADD COLUMN IF NOT EXISTS rides_used INTEGER DEFAULT 0;
ALTER TABLE driver_subscriptions ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT;
UPDATE driver_subscriptions SET payment_amount = amount WHERE payment_amount IS NULL AND amount IS NOT NULL;

-- ── Monthly pass (customer) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monthly_passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_name VARCHAR(120) NOT NULL,
  rides_total INTEGER NOT NULL DEFAULT 20,
  rides_used INTEGER NOT NULL DEFAULT 0,
  discount_pct NUMERIC(5, 2) DEFAULT 15,
  amount_paid NUMERIC(12, 2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  valid_until DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monthly_passes_user_active
  ON monthly_passes(user_id, is_active, valid_until);

-- ── Spin wheel plays & coins ledger ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spin_wheel_plays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER,
  reward_type VARCHAR(30),
  reward_value NUMERIC(12, 2) DEFAULT 0,
  played_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coins_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL DEFAULT 0,
  type VARCHAR(50) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── Parcel orders (create if missing, then extend) ────────────────────────────
CREATE TABLE IF NOT EXISTS parcel_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES users(id) ON DELETE SET NULL,
  vehicle_category VARCHAR(100) DEFAULT 'bike_parcel',
  pickup_address TEXT,
  pickup_lat DOUBLE PRECISION,
  pickup_lng DOUBLE PRECISION,
  pickup_contact_name VARCHAR(120),
  pickup_contact_phone VARCHAR(20),
  drop_locations JSONB DEFAULT '[]'::jsonb,
  total_distance_km NUMERIC(10, 2) DEFAULT 0,
  weight_kg NUMERIC(10, 2) DEFAULT 1,
  base_fare NUMERIC(12, 2) DEFAULT 0,
  distance_fare NUMERIC(12, 2) DEFAULT 0,
  weight_fare NUMERIC(12, 2) DEFAULT 0,
  load_charge NUMERIC(12, 2) DEFAULT 0,
  total_fare NUMERIC(12, 2) DEFAULT 0,
  commission_amt NUMERIC(12, 2) DEFAULT 0,
  commission_pct NUMERIC(5, 2) DEFAULT 12,
  gst_amt NUMERIC(12, 2) DEFAULT 0,
  gst_amount NUMERIC(12, 2) DEFAULT 0,
  current_status VARCHAR(50) DEFAULT 'pending',
  status VARCHAR(50) DEFAULT 'PENDING',
  current_drop_index INTEGER DEFAULT 0,
  pickup_otp VARCHAR(10),
  is_b2b BOOLEAN DEFAULT false,
  b2b_company_id UUID,
  payment_method VARCHAR(30) DEFAULT 'cash',
  payment_status VARCHAR(30) DEFAULT 'unpaid',
  notes TEXT,
  parcel_description TEXT,
  length_cm NUMERIC(10, 2),
  width_cm NUMERIC(10, 2),
  height_cm NUMERIC(10, 2),
  volumetric_weight_kg NUMERIC(10, 2),
  billable_weight_kg NUMERIC(10, 2),
  declared_value NUMERIC(12, 2) DEFAULT 0,
  is_fragile BOOLEAN DEFAULT false,
  insurance_enabled BOOLEAN DEFAULT false,
  insurance_premium NUMERIC(12, 2) DEFAULT 0,
  insurance_amount NUMERIC(12, 2) DEFAULT 0,
  expected_delivery_minutes INTEGER DEFAULT 30,
  sla_breached BOOLEAN DEFAULT false,
  idempotency_key VARCHAR(120),
  version INTEGER DEFAULT 0,
  driver_earnings NUMERIC(12, 2) DEFAULT 0,
  revenue_model VARCHAR(30),
  revenue_breakdown JSONB,
  assigned_at TIMESTAMP,
  picked_up_at TIMESTAMP,
  completed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  cancelled_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE parcel_orders ADD COLUMN IF NOT EXISTS load_charge NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE parcel_orders ADD COLUMN IF NOT EXISTS driver_earnings NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE parcel_orders ADD COLUMN IF NOT EXISTS revenue_model VARCHAR(30);
ALTER TABLE parcel_orders ADD COLUMN IF NOT EXISTS revenue_breakdown JSONB;
ALTER TABLE parcel_orders ADD COLUMN IF NOT EXISTS insurance_amount NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE parcel_orders ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 0;
ALTER TABLE parcel_orders ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS idx_parcel_orders_idempotency
  ON parcel_orders(customer_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ── Parcel vehicle types (green accent for parcel brand) ──────────────────────
CREATE TABLE IF NOT EXISTS parcel_vehicle_types (
  id SERIAL PRIMARY KEY,
  vehicle_key VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  subtitle TEXT DEFAULT '',
  icon TEXT DEFAULT '📦',
  image_url TEXT DEFAULT '',
  capacity_label TEXT DEFAULT '',
  max_weight_kg NUMERIC(10, 2) DEFAULT 10,
  suitable_items TEXT DEFAULT '',
  accent_color TEXT DEFAULT '#16A34A',
  base_fare NUMERIC(10, 2) DEFAULT 40,
  per_km NUMERIC(10, 2) DEFAULT 12,
  per_kg NUMERIC(10, 2) DEFAULT 4,
  load_charge NUMERIC(10, 2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO parcel_vehicle_types (vehicle_key, name, subtitle, icon, capacity_label, max_weight_kg, suitable_items, accent_color, base_fare, per_km, per_kg, sort_order)
VALUES
  ('bike_parcel', 'Bike Parcel', 'Fast & lightweight', '🏍️', 'Up to 10 kg', 10, 'Documents · Small boxes · Groceries', '#16A34A', 35, 10, 3, 1),
  ('auto_parcel', 'Auto Parcel', 'Goods carrier auto', '🛺', 'Up to 50 kg', 50, 'Medium boxes · Shop supplies', '#059669', 50, 12, 4, 2),
  ('mini_parcel', 'Mini Cargo', 'Compact cargo auto', '🛺', 'Up to 80 kg', 80, 'Shop stock · Appliances', '#10B981', 60, 14, 5, 3),
  ('tata_ace', 'Mini Truck', 'Tata Ace · Medium goods', '🚛', 'Up to 500 kg', 500, 'Furniture · Bulk items', '#047857', 120, 18, 6, 4),
  ('pickup_truck', 'Pickup Truck', 'Heavy goods', '🚚', 'Up to 2000 kg', 2000, 'Construction · Business logistics', '#065F46', 200, 22, 8, 5),
  ('bolero_cargo', 'Bolero Pickup', 'Heavy-duty pickup', '🚚', 'Up to 1500 kg', 1500, 'Heavy equipment · Large shipments', '#34D399', 180, 20, 7, 6),
  ('tempo_407', 'Tata 407 / Tempo', 'Large commercial tempo', '🚛', 'Up to 2500 kg', 2500, 'Factory goods · Full shifting', '#059669', 250, 24, 10, 7)
ON CONFLICT (vehicle_key) DO UPDATE SET
  name = EXCLUDED.name,
  subtitle = EXCLUDED.subtitle,
  accent_color = EXCLUDED.accent_color,
  max_weight_kg = EXCLUDED.max_weight_kg,
  suitable_items = EXCLUDED.suitable_items,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

-- ── Rolling local pool (carpool) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_pool_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_category_id UUID,
  status VARCHAR(30) DEFAULT 'idle',
  accepting_new_requests BOOLEAN DEFAULT true,
  pool_vehicle_type VARCHAR(50),
  max_seats INTEGER DEFAULT 4,
  available_seats INTEGER DEFAULT 4,
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  current_bearing_deg DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  route_plan JSONB,
  state_version INTEGER DEFAULT 0,
  last_location_at TIMESTAMP,
  ended_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pool_ride_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES driver_pool_sessions(id) ON DELETE SET NULL,
  vehicle_category_id UUID,
  pickup_lat DOUBLE PRECISION,
  pickup_lng DOUBLE PRECISION,
  drop_lat DOUBLE PRECISION,
  drop_lng DOUBLE PRECISION,
  pickup_address TEXT,
  drop_address TEXT,
  seats_requested INTEGER DEFAULT 1,
  fare_per_seat NUMERIC(12, 2) DEFAULT 0,
  total_fare NUMERIC(12, 2) DEFAULT 0,
  distance_km NUMERIC(10, 2) DEFAULT 0,
  commission_amount NUMERIC(12, 2) DEFAULT 0,
  gst_amount NUMERIC(12, 2) DEFAULT 0,
  insurance_amount NUMERIC(12, 2) DEFAULT 0,
  platform_deduction NUMERIC(12, 2) DEFAULT 0,
  revenue_model VARCHAR(30),
  revenue_breakdown JSONB,
  driver_earnings NUMERIC(12, 2) DEFAULT 0,
  payment_method VARCHAR(30) DEFAULT 'cash',
  status VARCHAR(30) DEFAULT 'searching',
  searched_at TIMESTAMP DEFAULT NOW(),
  boarding_otp VARCHAR(10),
  boarding_otp_issued_at TIMESTAMP,
  boarding_otp_expires_at TIMESTAMP,
  boarding_otp_used_at TIMESTAMP,
  cluster_key VARCHAR(120),
  proposed_session_id UUID,
  pickup_order INTEGER,
  drop_order INTEGER,
  seat_lock_expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS insurance_amount NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS platform_deduction NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS revenue_model VARCHAR(30);
ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS revenue_breakdown JSONB;
ALTER TABLE pool_ride_requests ADD COLUMN IF NOT EXISTS driver_earnings NUMERIC(12, 2) DEFAULT 0;

-- ── Outstation pool v2 revenue columns ────────────────────────────────────────
ALTER TABLE outstation_pool_rides ADD COLUMN IF NOT EXISTS vehicle_category_id UUID;
ALTER TABLE outstation_pool_rides ADD COLUMN IF NOT EXISTS from_lat DOUBLE PRECISION;
ALTER TABLE outstation_pool_rides ADD COLUMN IF NOT EXISTS from_lng DOUBLE PRECISION;
ALTER TABLE outstation_pool_rides ADD COLUMN IF NOT EXISTS to_lat DOUBLE PRECISION;
ALTER TABLE outstation_pool_rides ADD COLUMN IF NOT EXISTS to_lng DOUBLE PRECISION;
ALTER TABLE outstation_pool_rides ADD COLUMN IF NOT EXISTS price_per_km_per_seat NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE outstation_pool_rides ADD COLUMN IF NOT EXISTS state_version INTEGER DEFAULT 0;

ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS fare_per_seat NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS segment_km NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION;
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION;
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS drop_lat DOUBLE PRECISION;
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS drop_lng DOUBLE PRECISION;
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS pickup_order INTEGER;
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS insurance_amount NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS driver_earnings NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS revenue_model VARCHAR(30);
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS revenue_breakdown JSONB;

-- ── Parcel support tables ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parcel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_order_id UUID NOT NULL REFERENCES parcel_orders(id) ON DELETE CASCADE,
  event VARCHAR(80) NOT NULL,
  data JSONB DEFAULT '{}'::jsonb,
  actor_id UUID,
  actor_type VARCHAR(30),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parcel_delivery_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES parcel_orders(id) ON DELETE CASCADE,
  drop_index INTEGER DEFAULT 0,
  photo_url TEXT,
  signature_url TEXT,
  delivered_to VARCHAR(120),
  driver_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (order_id, drop_index)
);

CREATE TABLE IF NOT EXISTS parcel_prohibited_items (
  id SERIAL PRIMARY KEY,
  item_name VARCHAR(200) NOT NULL,
  category VARCHAR(80) DEFAULT 'general',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── Driver eligibility for parcel / pool dispatch ─────────────────────────────
ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS service_eligibility JSONB DEFAULT '[]'::jsonb;
ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS parcel_eligibility BOOLEAN DEFAULT true;
ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS pool_eligibility BOOLEAN DEFAULT true;
ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS outstation_eligibility BOOLEAN DEFAULT true;
ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS intercity_eligibility BOOLEAN DEFAULT true;
ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS seat_capacity INTEGER DEFAULT 4;
ALTER TABLE driver_details ADD COLUMN IF NOT EXISTS approval_state VARCHAR(30) DEFAULT 'approved';

-- ── Car sharing extra columns (legacy app carpool) ────────────────────────────
ALTER TABLE car_sharing_rides ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE car_sharing_rides ADD COLUMN IF NOT EXISTS vehicle_info TEXT;
ALTER TABLE car_sharing_bookings ADD COLUMN IF NOT EXISTS booking_otp VARCHAR(10);
ALTER TABLE car_sharing_bookings ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;
