#!/bin/bash
set -euo pipefail
cd /home/ubuntu/jago-app
export DATABASE_URL="${DATABASE_URL:-postgresql://jago:jagopass2026@localhost:5432/jago}"
export PGPASSWORD=jagopass2026

MIGS=(
  migrations/0010_financial_integrity_foundations.sql
  migrations/0016_admin_form_schema_fixes.sql
  migrations/0017_franchise_core.sql
  migrations/0019_payment_orphan_recovery.sql
  migrations/0020_parcel_payment_status.sql
  migrations/0021_p0_revenue_alignment.sql
)

for f in "${MIGS[@]}"; do
  echo "=== APPLY $f ==="
  if [ -f "$f" ]; then
    psql -h localhost -U jago -d jago -v ON_ERROR_STOP=0 -f "$f" || true
    echo "done $f"
  else
    echo "missing $f"
  fi
done

echo "=== VERIFY ==="
psql -h localhost -U jago -d jago -c "SELECT to_regclass('public.booking_intents') AS booking_intents, to_regclass('public.payment_recovery_events') AS payment_recovery_events;"
psql -h localhost -U jago -d jago -c "SELECT column_name FROM information_schema.columns WHERE table_name='parcel_orders' AND column_name='payment_status';"
psql -h localhost -U jago -d jago -c "SELECT column_name FROM information_schema.columns WHERE table_name='franchisees' AND column_name='state';"
psql -h localhost -U jago -d jago -c "INSERT INTO business_settings (key_name, value) VALUES ('rides_model','commission'),('parcels_model','commission'),('city_pool_model','commission'),('outstation_pool_model','commission'),('commission_pct','15') ON CONFLICT (key_name) DO UPDATE SET value=EXCLUDED.value;"

pm2 restart jago-server
sleep 15
echo HEALTH:
curl -sS http://127.0.0.1:5000/api/health || true
echo
echo PENDING:
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/api/app/customer/ride/pending-recovery || true
