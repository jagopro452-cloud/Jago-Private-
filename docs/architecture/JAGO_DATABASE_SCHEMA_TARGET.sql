-- JAGO Target Schema (service-bounded baseline)
-- Non-destructive reference schema for migration planning.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Identity / profiles
CREATE TABLE IF NOT EXISTS id_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(255),
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(191),
  user_type VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (phone, user_type)
);

CREATE TABLE IF NOT EXISTS id_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  platform VARCHAR(20) NOT NULL,
  fcm_token TEXT,
  app_version VARCHAR(50),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Booking
CREATE TABLE IF NOT EXISTS bk_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_id VARCHAR(30) NOT NULL UNIQUE,
  service_type VARCHAR(30) NOT NULL,
  customer_id UUID NOT NULL,
  pickup_address TEXT,
  pickup_lat DOUBLE PRECISION,
  pickup_lng DOUBLE PRECISION,
  drop_address TEXT,
  drop_lat DOUBLE PRECISION,
  drop_lng DOUBLE PRECISION,
  quote_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  quote_distance_km NUMERIC(10,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'created',
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trip lifecycle
CREATE TABLE IF NOT EXISTS tr_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  driver_id UUID,
  vehicle_category_id UUID,
  status VARCHAR(30) NOT NULL DEFAULT 'searching',
  pickup_otp VARCHAR(10),
  delivery_otp VARCHAR(10),
  estimated_fare NUMERIC(12,2) DEFAULT 0,
  actual_fare NUMERIC(12,2) DEFAULT 0,
  estimated_distance_km NUMERIC(10,2) DEFAULT 0,
  actual_distance_km NUMERIC(10,2) DEFAULT 0,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tr_trip_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL,
  event_type VARCHAR(60) NOT NULL,
  event_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Driver location and state
CREATE TABLE IF NOT EXISTS lc_driver_locations (
  driver_id UUID PRIMARY KEY,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  heading DOUBLE PRECISION,
  speed_kmph DOUBLE PRECISION,
  is_online BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Safety
CREATE TABLE IF NOT EXISTS sf_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID,
  user_id UUID,
  severity VARCHAR(10) NOT NULL,
  incident_type VARCHAR(60) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pricing
CREATE TABLE IF NOT EXISTS pr_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type VARCHAR(30) NOT NULL,
  zone_id UUID,
  base_fare NUMERIC(12,2) DEFAULT 0,
  fare_per_km NUMERIC(12,2) DEFAULT 0,
  fare_per_min NUMERIC(12,2) DEFAULT 0,
  min_fare NUMERIC(12,2) DEFAULT 0,
  surge_multiplier NUMERIC(6,2) DEFAULT 1,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Car sharing and intercity
CREATE TABLE IF NOT EXISTS cs_rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL,
  from_location TEXT NOT NULL,
  to_location TEXT NOT NULL,
  departure_time TIMESTAMPTZ NOT NULL,
  total_seats INT NOT NULL,
  available_seats INT NOT NULL,
  fare_per_seat NUMERIC(12,2) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cs_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  seats_booked INT NOT NULL,
  total_fare NUMERIC(12,2) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS it_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_city VARCHAR(120) NOT NULL,
  to_city VARCHAR(120) NOT NULL,
  estimated_km NUMERIC(10,2) NOT NULL,
  base_fare NUMERIC(12,2) NOT NULL,
  fare_per_km NUMERIC(12,2) NOT NULL,
  toll_charges NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Parcel and hyperlocal
CREATE TABLE IF NOT EXISTS pa_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL,
  receiver_name VARCHAR(255),
  receiver_phone VARCHAR(20),
  parcel_type VARCHAR(60),
  weight_kg NUMERIC(8,2),
  helper_required BOOLEAN DEFAULT false,
  pickup_otp VARCHAR(10),
  delivery_otp VARCHAR(10),
  status VARCHAR(30) NOT NULL DEFAULT 'searching',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wallet and settlements
CREATE TABLE IF NOT EXISTS wa_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  entry_type VARCHAR(30) NOT NULL,
  credit NUMERIC(12,2) NOT NULL DEFAULT 0,
  debit NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  ref_type VARCHAR(30),
  ref_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit and outbox
CREATE TABLE IF NOT EXISTS sys_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type VARCHAR(60) NOT NULL,
  aggregate_id UUID,
  event_type VARCHAR(80) NOT NULL,
  payload JSONB NOT NULL,
  published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  actor_type VARCHAR(30),
  action VARCHAR(100) NOT NULL,
  object_type VARCHAR(60),
  object_id UUID,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
