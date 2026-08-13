-- Production market-readiness: columns/tables that cause admin 500 errors when missing.
-- UTF-8 encoding required.

-- Users: gender matching
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS prefer_female_driver BOOLEAN DEFAULT false;

-- Ride preferences
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
);

-- Trip revenue columns used by admin dashboard + settlements
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(12, 2) DEFAULT 0;

-- Driver wallet columns used by admin dashboard
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_pending_balance NUMERIC(12, 2) DEFAULT 0;

-- Driver subscriptions: dashboard queried status column; align schema
ALTER TABLE driver_subscriptions ADD COLUMN IF NOT EXISTS status VARCHAR(30);
UPDATE driver_subscriptions SET status = CASE WHEN is_active = true THEN 'active' ELSE 'inactive' END WHERE status IS NULL;

-- Dynamic city services (admin city-services page)
CREATE TABLE IF NOT EXISTS city_services (
  id SERIAL PRIMARY KEY,
  city_name VARCHAR(120) NOT NULL,
  city_lat DOUBLE PRECISION,
  city_lng DOUBLE PRECISION,
  service_key VARCHAR(100) NOT NULL,
  radius_km DOUBLE PRECISION DEFAULT 30,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (city_name, service_key)
);

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

CREATE TABLE IF NOT EXISTS city_parcel_vehicles (
  id SERIAL PRIMARY KEY,
  city_name VARCHAR(120) NOT NULL,
  vehicle_key VARCHAR(100) NOT NULL,
  eta_minutes INTEGER DEFAULT 5,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (city_name, vehicle_key)
);

-- Parcel SLA dashboard
ALTER TABLE parcel_orders ADD COLUMN IF NOT EXISTS sla_breached BOOLEAN DEFAULT false;
ALTER TABLE parcel_orders ADD COLUMN IF NOT EXISTS expected_delivery_minutes INTEGER DEFAULT 0;
ALTER TABLE parcel_orders ADD COLUMN IF NOT EXISTS current_status VARCHAR(50) DEFAULT 'pending';

-- Safety settings default
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS description TEXT;
INSERT INTO business_settings (key_name, value, settings_type, description)
VALUES ('female_to_female_matching', '1', 'safety_settings', 'Prioritize female drivers for female customers')
ON CONFLICT (key_name) DO NOTHING;
