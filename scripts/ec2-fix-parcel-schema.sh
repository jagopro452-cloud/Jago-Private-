#!/bin/bash
set -euo pipefail
export PGPASSWORD=jagopass2026
cd /home/ubuntu/jago-app

echo "=== FIX parcel_vehicle_types schema ==="
psql -h localhost -U jago -d jago -v ON_ERROR_STOP=1 <<'SQL'
-- Legacy parcel_vehicle_types used type_key/display_name. App expects vehicle_key/name + pricing columns.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='parcel_vehicle_types' AND column_name='type_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='parcel_vehicle_types' AND column_name='vehicle_key'
  ) THEN
    ALTER TABLE parcel_vehicle_types RENAME COLUMN type_key TO vehicle_key;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='parcel_vehicle_types' AND column_name='display_name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='parcel_vehicle_types' AND column_name='name'
  ) THEN
    ALTER TABLE parcel_vehicle_types RENAME COLUMN display_name TO name;
  END IF;
END $$;

ALTER TABLE parcel_vehicle_types ADD COLUMN IF NOT EXISTS subtitle TEXT DEFAULT '';
ALTER TABLE parcel_vehicle_types ADD COLUMN IF NOT EXISTS icon TEXT DEFAULT '📦';
ALTER TABLE parcel_vehicle_types ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';
ALTER TABLE parcel_vehicle_types ADD COLUMN IF NOT EXISTS capacity_label TEXT DEFAULT '';
ALTER TABLE parcel_vehicle_types ADD COLUMN IF NOT EXISTS suitable_items TEXT DEFAULT '';
ALTER TABLE parcel_vehicle_types ADD COLUMN IF NOT EXISTS accent_color TEXT DEFAULT '#2F7BFF';
ALTER TABLE parcel_vehicle_types ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

UPDATE parcel_vehicle_types SET
  subtitle = COALESCE(NULLIF(subtitle, ''), capacity_label, 'Delivery'),
  capacity_label = COALESCE(NULLIF(capacity_label, ''), 'Upto ' || COALESCE(max_weight_kg::text, '10') || ' kg'),
  sort_order = CASE vehicle_key
    WHEN 'bike_parcel' THEN 1
    WHEN 'auto_parcel' THEN 2
    WHEN 'mini_parcel' THEN 3
    ELSE COALESCE(sort_order, 99)
  END
WHERE vehicle_key IS NOT NULL;

-- city_parcel_vehicles may reference vehicle_key
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='city_parcel_vehicles' AND column_name='type_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='city_parcel_vehicles' AND column_name='vehicle_key'
  ) THEN
    ALTER TABLE city_parcel_vehicles RENAME COLUMN type_key TO vehicle_key;
  END IF;
END $$;
SQL

pm2 restart jago-server
sleep 15
curl -sS "http://127.0.0.1:5000/api/app/parcel-vehicles?lat=17.385&lng=78.4867" | head -c 500; echo
curl -sS -o /dev/null -w 'parcel-vehicles:%{http_code}\n' "http://127.0.0.1:5000/api/app/parcel-vehicles?lat=17.385&lng=78.4867"
