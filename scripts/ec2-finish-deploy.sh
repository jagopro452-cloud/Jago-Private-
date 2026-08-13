#!/bin/bash
set -euo pipefail
cd /home/ubuntu/jago-app
git init -q 2>/dev/null || true
git add -A
git commit -m "production-deploy" -q || true
export DEPLOYMENT_SHA=b7c90bf
npm run build
pm2 restart jago-server
sleep 10
echo HEALTH:
curl -sS http://127.0.0.1:5000/api/health || true
echo
echo PENDING_RECOVERY:
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/api/app/customer/ride/pending-recovery || true
