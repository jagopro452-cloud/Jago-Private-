#!/bin/bash
set -euo pipefail
export PGPASSWORD=jagopass2026
psql -h localhost -U jago -d jago <<'SQL'
INSERT INTO migrations (name) VALUES
  ('001_production_hardening.sql'),
  ('002_registration_schema_standardization.sql'),
  ('003_vehicle_category_service_semantics.sql'),
  ('004_discounts_admin_form_fixes.sql')
ON CONFLICT DO NOTHING;
SQL
pm2 restart jago-server
sleep 40
echo HEALTH:
curl -sS http://127.0.0.1:5000/api/health || true
echo
echo PENDING:
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/api/app/customer/ride/pending-recovery || true
tail -8 /home/ubuntu/.pm2/logs/jago-server-out.log
tail -5 /home/ubuntu/.pm2/logs/jago-server-error.log
