#!/bin/bash
set -euo pipefail
export PGPASSWORD=jagopass2026
echo "=== platform_services schema ==="
psql -h localhost -U jago -d jago -c "\d platform_services" || true
echo "=== service_revenue_config exists? ==="
psql -h localhost -U jago -d jago -c "SELECT to_regclass('public.service_revenue_config');" || true
echo "=== service_revenue_config schema ==="
psql -h localhost -U jago -d jago -c "\d service_revenue_config" 2>&1 || true
echo "=== API checks ==="
curl -sS -o /dev/null -w 'health:%{http_code} ' http://127.0.0.1:5000/api/health || true
curl -sS -o /dev/null -w 'platform:%{http_code} ' http://127.0.0.1:5000/api/platform-services || true
curl -sS -o /dev/null -w 'module:%{http_code} ' http://127.0.0.1:5000/api/admin/module-revenue || true
curl -sS -o /dev/null -w 'app-services:%{http_code}' http://127.0.0.1:5000/api/app/services/active || true
echo
pm2 logs jago-server --lines 8 --nostream 2>&1 | tail -12 || true
