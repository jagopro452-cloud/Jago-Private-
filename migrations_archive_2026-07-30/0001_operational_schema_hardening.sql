CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(50);
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS rejected_driver_ids UUID[] DEFAULT '{}'::uuid[];
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS driver_accepted_at TIMESTAMP;
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS driver_arriving_at TIMESTAMP;
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS ride_started_at TIMESTAMP;
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS ride_ended_at TIMESTAMP;
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS pickup_otp VARCHAR(10);
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS delivery_otp VARCHAR(10);
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS share_token VARCHAR(64);

ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_status VARCHAR(30) DEFAULT 'pending';
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_lat DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_lng DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_trip_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lock_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS license_expiry DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_brand VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_color VARCHAR(60);
ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_year INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS selfie_image TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS revenue_model VARCHAR(30) DEFAULT 'commission';
ALTER TABLE users ADD COLUMN IF NOT EXISTS model_selected_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(20) DEFAULT 'light';

ALTER TABLE vehicle_brands ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE vehicle_brands ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'two_wheeler';

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_rides INTEGER DEFAULT 0;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS plan_type VARCHAR(30) DEFAULT 'both';

CREATE TABLE IF NOT EXISTS insurance_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(191) NOT NULL,
  plan_type VARCHAR(50) DEFAULT 'vehicle',
  premium_daily NUMERIC(10,2) DEFAULT 0,
  premium_monthly NUMERIC(10,2) DEFAULT 0,
  coverage_amount NUMERIC(12,2) DEFAULT 0,
  features TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS driver_insurance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL,
  plan_id UUID,
  start_date DATE,
  end_date DATE,
  payment_amount NUMERIC(10,2) DEFAULT 0,
  payment_status VARCHAR(30) DEFAULT 'pending',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS driver_locations (
  driver_id UUID PRIMARY KEY,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  heading DOUBLE PRECISION DEFAULT 0,
  speed DOUBLE PRECISION DEFAULT 0,
  is_online BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS driver_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL,
  plan_id UUID,
  start_date TIMESTAMP DEFAULT NOW(),
  end_date TIMESTAMP,
  amount NUMERIC(10,2) DEFAULT 0,
  payment_status VARCHAR(30) DEFAULT 'pending',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS driver_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL,
  doc_type VARCHAR(50) NOT NULL,
  doc_url TEXT,
  expiry_date TEXT,
  verification_status VARCHAR(30) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otp_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,
  otp VARCHAR(10) NOT NULL,
  user_type VARCHAR(30) DEFAULT 'customer',
  is_used BOOLEAN DEFAULT false,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL,
  trip_id UUID,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  reason TEXT,
  payment_method VARCHAR(30) DEFAULT 'wallet',
  status VARCHAR(30) DEFAULT 'pending',
  admin_note TEXT,
  approved_by VARCHAR(120),
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ride_complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL,
  customer_id UUID,
  driver_id UUID,
  complaint_type VARCHAR(50) DEFAULT 'general',
  description TEXT NOT NULL,
  status VARCHAR(30) DEFAULT 'open',
  resolution_note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trip_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL,
  status VARCHAR(50) NOT NULL,
  source VARCHAR(50) DEFAULT 'system',
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ride_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  actor_id UUID,
  actor_type VARCHAR(50) DEFAULT 'system',
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email VARCHAR(191),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id UUID,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS car_sharing_rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID,
  vehicle_category_id UUID,
  zone_id UUID,
  from_location TEXT,
  to_location TEXT,
  departure_time TIMESTAMP,
  seat_price NUMERIC(10,2) DEFAULT 0,
  max_seats INTEGER DEFAULT 4,
  seats_booked INTEGER DEFAULT 0,
  status VARCHAR(30) DEFAULT 'scheduled',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS car_sharing_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID,
  customer_id UUID,
  seats_booked INTEGER DEFAULT 1,
  total_fare NUMERIC(10,2) DEFAULT 0,
  status VARCHAR(30) DEFAULT 'confirmed',
  payment_status VARCHAR(30) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS intercity_cs_settings (
  key_name VARCHAR(120) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS intercity_cs_rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID,
  from_city VARCHAR(120) NOT NULL,
  to_city VARCHAR(120) NOT NULL,
  route_km NUMERIC(10,2) DEFAULT 0,
  departure_date DATE,
  departure_time VARCHAR(20),
  total_seats INTEGER DEFAULT 4,
  vehicle_number VARCHAR(60),
  vehicle_model VARCHAR(120),
  note TEXT,
  fare_per_seat NUMERIC(10,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  status VARCHAR(30) DEFAULT 'scheduled',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS intercity_cs_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID,
  customer_id UUID,
  seats_booked INTEGER DEFAULT 1,
  total_fare NUMERIC(10,2) DEFAULT 0,
  status VARCHAR(30) DEFAULT 'confirmed',
  payment_status VARCHAR(30) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS car_sharing_settings (
  key_name VARCHAR(120) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS intercity_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_city VARCHAR(120) NOT NULL,
  to_city VARCHAR(120) NOT NULL,
  estimated_km NUMERIC(10,2) DEFAULT 0,
  base_fare NUMERIC(10,2) DEFAULT 0,
  fare_per_km NUMERIC(10,2) DEFAULT 0,
  toll_charges NUMERIC(10,2) DEFAULT 0,
  vehicle_category_id UUID,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS safety_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  trip_id UUID,
  alert_type VARCHAR(40) DEFAULT 'sos',
  triggered_by VARCHAR(20) DEFAULT 'customer',
  status VARCHAR(20) DEFAULT 'active',
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  location_address TEXT,
  nearby_drivers_notified INTEGER DEFAULT 0,
  acknowledged_by_name VARCHAR(120),
  acknowledged_at TIMESTAMP,
  resolved_at TIMESTAMP,
  police_notified BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS police_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(191) NOT NULL,
  zone_id UUID,
  address TEXT,
  phone VARCHAR(30),
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revenue_model_settings (
  key_name VARCHAR(120) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_auth_token ON users(auth_token);
CREATE INDEX IF NOT EXISTS idx_driver_locations_online ON driver_locations(is_online);
CREATE INDEX IF NOT EXISTS idx_otp_logs_phone_created ON otp_logs(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ride_complaints_status_created ON ride_complaints(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trip_status_trip_created ON trip_status(trip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ride_events_trip_created ON ride_events(trip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at DESC);

INSERT INTO revenue_model_settings (key_name, value)
VALUES
  ('driver_commission_pct', '20'),
  ('auto_lock_threshold', '-100'),
  ('subscription_enabled', 'true')
ON CONFLICT (key_name) DO NOTHING;

INSERT INTO intercity_routes (
  from_city,
  to_city,
  estimated_km,
  base_fare,
  fare_per_km,
  toll_charges,
  is_active
)
SELECT 'Hyderabad', 'Vijayawada', 275, 300, 12, 80, true
WHERE NOT EXISTS (
  SELECT 1 FROM intercity_routes WHERE is_active = true
);

-- driver_payments: wallet debit/credit ledger for drivers
CREATE TABLE IF NOT EXISTS driver_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_type VARCHAR(60) NOT NULL DEFAULT 'commission_debit',
  razorpay_order_id VARCHAR(120),
  razorpay_payment_id VARCHAR(120),
  trip_id UUID,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  description TEXT,
  verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_driver_payments_driver ON driver_payments(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_payments_status ON driver_payments(status);

-- outstation_pool_rides: driver posts city-to-city rides
CREATE TABLE IF NOT EXISTS outstation_pool_rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL,
  from_city VARCHAR(120) NOT NULL,
  to_city VARCHAR(120) NOT NULL,
  route_km NUMERIC(10,2) DEFAULT 0,
  departure_date DATE,
  departure_time VARCHAR(20),
  total_seats INTEGER DEFAULT 4,
  available_seats INTEGER DEFAULT 4,
  vehicle_number VARCHAR(60),
  vehicle_model VARCHAR(120),
  fare_per_seat NUMERIC(10,2) DEFAULT 0,
  note TEXT,
  is_active BOOLEAN DEFAULT true,
  status VARCHAR(30) DEFAULT 'scheduled',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- outstation_pool_bookings: customer seat bookings for pool rides
CREATE TABLE IF NOT EXISTS outstation_pool_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL,
  customer_id UUID,
  seats_booked INTEGER DEFAULT 1,
  total_fare NUMERIC(10,2) DEFAULT 0,
  from_city VARCHAR(120),
  to_city VARCHAR(120),
  pickup_address TEXT,
  dropoff_address TEXT,
  status VARCHAR(30) DEFAULT 'confirmed',
  payment_status VARCHAR(30) DEFAULT 'pending',
  payment_method VARCHAR(40) DEFAULT 'cash',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
