#!/bin/bash
set -euo pipefail
export PGPASSWORD=jagopass2026
psql -h localhost -U jago -d jago <<'SQL'
INSERT INTO business_settings (key_name, value, settings_type) VALUES
  ('rides_model','commission','revenue'),
  ('parcels_model','commission','revenue'),
  ('city_pool_model','commission','revenue'),
  ('outstation_pool_model','commission','revenue'),
  ('commission_pct','15','revenue')
ON CONFLICT (key_name) DO UPDATE SET value = EXCLUDED.value;
SQL
pm2 restart jago-server
sleep 25
echo HEALTH:
curl -sS http://127.0.0.1:5000/api/health || true
echo
echo PENDING:
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/api/app/customer/ride/pending-recovery || true
grep "Failed to register" /home/ubuntu/.pm2/logs/jago-server-error.log | tail -2 || true
