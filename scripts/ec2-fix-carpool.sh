#!/bin/bash
set -euo pipefail
export PGPASSWORD=jagopass2026
psql -h localhost -U jago -d jago <<'SQL'
ALTER TABLE vehicle_categories ADD COLUMN IF NOT EXISTS is_carpool BOOLEAN DEFAULT false;
UPDATE vehicle_categories SET service_type = CASE
  WHEN COALESCE(is_carpool, false) = true THEN 'pool'
  WHEN LOWER(COALESCE(type, '')) IN ('parcel', 'cargo') THEN LOWER(type)
  WHEN LOWER(COALESCE(vehicle_type, '')) SIMILAR TO '%(parcel|cargo|courier|delivery|pickup|truck|tempo|ace)%' THEN 'parcel'
  ELSE 'ride'
END
WHERE service_type IS NULL OR TRIM(service_type) = '';
SQL
pm2 restart jago-server
sleep 30
curl -sS http://127.0.0.1:5000/api/health; echo
curl -sS -o /dev/null -w "pending:%{http_code}\n" http://127.0.0.1:5000/api/app/customer/ride/pending-recovery
