#!/bin/bash
export PGPASSWORD=jagopass2026
psql -h localhost -U jago -d jago -c "SELECT COUNT(*) FROM parcel_vehicle_types;"
psql -h localhost -U jago -d jago -c "\d parcel_vehicle_types" 2>&1 | head -30
psql -h localhost -U jago -d jago -c "SELECT * FROM parcel_vehicle_types LIMIT 3;"
grep -i parcel /home/ubuntu/.pm2/logs/jago-server-error.log | tail -5
