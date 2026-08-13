#!/bin/bash
set -euo pipefail
export PGPASSWORD=jagopass2026
psql -h localhost -U jago -d jago <<'SQL'
ALTER TABLE vehicle_categories ADD COLUMN IF NOT EXISTS is_carpool BOOLEAN DEFAULT false;
ALTER TABLE vehicle_categories ADD COLUMN IF NOT EXISTS service_type VARCHAR(30) DEFAULT 'ride';
UPDATE vehicle_categories SET service_type = 'ride' WHERE service_type IS NULL OR TRIM(service_type) = '';
INSERT INTO migrations (name) VALUES
  ('0016_admin_form_schema_fixes.sql'),
  ('0017_franchise_core.sql'),
  ('0018_parcel_active_booking_hardening.sql'),
  ('0019_payment_orphan_recovery.sql'),
  ('0020_parcel_payment_status.sql'),
  ('0021_p0_revenue_alignment.sql')
ON CONFLICT DO NOTHING;
SQL
pm2 restart jago-server
sleep 35
echo HEALTH:
curl -sS http://127.0.0.1:5000/api/health || true
echo
echo PENDING:
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/api/app/customer/ride/pending-recovery || true
tail -5 /home/ubuntu/.pm2/logs/jago-server-out.log
