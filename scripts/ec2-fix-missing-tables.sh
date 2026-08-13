#!/bin/bash
set -euo pipefail
cd /home/ubuntu/jago-app
export PGPASSWORD=jagopass2026
echo "Applying 0022_platform_revenue_tables.sql..."
psql -h localhost -U jago -d jago -v ON_ERROR_STOP=1 -f migrations/0022_platform_revenue_tables.sql
echo "Restarting PM2..."
pm2 restart jago-server
sleep 20
echo "=== VERIFY ==="
curl -sS http://127.0.0.1:5000/api/health | head -c 200; echo
curl -sS -o /dev/null -w "platform-services:%{http_code}\n" http://127.0.0.1:5000/api/platform-services || true
curl -sS -o /dev/null -w "module-revenue:%{http_code}\n" http://127.0.0.1:5000/api/admin/module-revenue || true
curl -sS -o /dev/null -w "app-services:%{http_code}\n" http://127.0.0.1:5000/api/app/services/active || true
