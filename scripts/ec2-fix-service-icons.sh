#!/bin/bash
set -euo pipefail
export PGPASSWORD=jagopass2026
psql -h localhost -U jago -d jago -v ON_ERROR_STOP=1 <<'SQL'
-- Align platform_services visuals with JAGO app JT palette + vehicle artwork keys.
UPDATE platform_services SET icon = '🏍️', color = '#2D8CFF', description = 'Quick bike rides' WHERE service_key = 'bike_ride';
UPDATE platform_services SET icon = '🛺', color = '#5B9DFF', description = 'Auto rickshaw rides' WHERE service_key = 'auto_ride';
UPDATE platform_services SET icon = '🚗', color = '#2563EB', description = 'Mini car rides' WHERE service_key = 'mini_car';
UPDATE platform_services SET icon = '🚕', color = '#1A6FDB', description = 'Sedan rides' WHERE service_key = 'sedan';
UPDATE platform_services SET icon = '🚙', color = '#1A6FDB', description = 'SUV rides' WHERE service_key = 'suv';
UPDATE platform_services SET icon = '🚐', color = '#2D8CFF', description = 'Shared city pool' WHERE service_key = 'city_pool';
UPDATE platform_services SET icon = '🛣️', color = '#5B9DFF', description = 'Intercity shared rides' WHERE service_key = 'intercity_pool';
UPDATE platform_services SET icon = '🛣️', color = '#1A6FDB', description = 'Outstation pool trips' WHERE service_key = 'outstation_pool';
UPDATE platform_services SET icon = '📦', color = '#1A6FDB', description = 'Parcel and cargo delivery' WHERE service_key = 'parcel_delivery';
SQL
curl -sS http://127.0.0.1:5000/api/app/services/active | head -c 500; echo
