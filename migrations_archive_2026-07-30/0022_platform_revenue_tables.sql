-- Create platform_services + service_revenue_config if missing (removed from runtime bootstrap in 0011).
-- Safe to re-run. Renames legacy platform_services (service_type schema) if present.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'platform_services' AND column_name = 'service_type'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'platform_services' AND column_name = 'service_key'
  ) THEN
    ALTER TABLE platform_services RENAME TO platform_services_legacy;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS platform_services (
  id SERIAL PRIMARY KEY,
  service_key VARCHAR(100) UNIQUE NOT NULL,
  service_name VARCHAR(255) NOT NULL,
  service_status VARCHAR(50) DEFAULT 'active',
  revenue_model VARCHAR(50) DEFAULT 'commission',
  commission_rate NUMERIC(10,2) DEFAULT 15,
  icon VARCHAR(100),
  color VARCHAR(100),
  description TEXT,
  short_description TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  eta_label VARCHAR(50) DEFAULT '',
  service_category VARCHAR(50) DEFAULT 'rides',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE platform_services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

INSERT INTO platform_services
  (service_key, service_name, service_category, service_status, revenue_model, commission_rate, sort_order)
VALUES
  ('bike_ride', 'Bike Ride', 'rides', 'active', 'commission', 15, 1),
  ('auto_ride', 'Auto Ride', 'rides', 'inactive', 'commission', 15, 2),
  ('mini_car', 'Mini Car', 'rides', 'inactive', 'commission', 15, 3),
  ('sedan', 'Sedan', 'rides', 'inactive', 'commission', 15, 4),
  ('suv', 'SUV', 'rides', 'inactive', 'commission', 15, 5),
  ('city_pool', 'City Car Pool', 'carpool', 'inactive', 'commission', 10, 6),
  ('intercity_pool', 'Intercity Car Pool', 'carpool', 'inactive', 'commission', 12, 7),
  ('outstation_pool', 'Outstation Pool', 'carpool', 'inactive', 'commission', 15, 8),
  ('parcel_delivery', 'Parcel Delivery', 'parcel', 'active', 'commission', 15, 9)
ON CONFLICT (service_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS service_revenue_config (
  module_name VARCHAR(30) PRIMARY KEY,
  revenue_model VARCHAR(20) NOT NULL DEFAULT 'commission',
  commission_percentage NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  commission_gst_percentage NUMERIC(5,2) NOT NULL DEFAULT 18.00,
  subscription_required BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO service_revenue_config
  (module_name, revenue_model, commission_percentage, commission_gst_percentage, subscription_required, is_active)
VALUES
  ('ride', 'commission', 15.00, 18.00, false, true),
  ('parcel', 'commission', 12.00, 18.00, false, true),
  ('carpool', 'commission', 10.00, 18.00, false, true),
  ('outstation', 'commission', 12.00, 18.00, false, true),
  ('b2b', 'subscription', 0.00, 0.00, true, true)
ON CONFLICT (module_name) DO UPDATE SET
  revenue_model = EXCLUDED.revenue_model,
  commission_percentage = EXCLUDED.commission_percentage,
  commission_gst_percentage = EXCLUDED.commission_gst_percentage,
  subscription_required = EXCLUDED.subscription_required,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();
