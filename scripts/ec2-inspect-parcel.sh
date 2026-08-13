#!/bin/bash
export PGPASSWORD=jagopass2026
psql -h localhost -U jago -d jago -c "SELECT to_regclass('public.parcel_vehicle_types') AS pvt, to_regclass('public.parcel_fares') AS pf, to_regclass('public.city_parcel_vehicles') AS cpv;"
psql -h localhost -U jago -d jago -c "SELECT column_name FROM information_schema.columns WHERE table_name='vehicle_categories' ORDER BY ordinal_position;"
curl -sS http://127.0.0.1:5000/api/app/parcel-vehicles?lat=17.385&lng=78.4867 2>&1 | head -c 300; echo
pm2 logs jago-server --lines 5 --nostream 2>&1 | tail -8
