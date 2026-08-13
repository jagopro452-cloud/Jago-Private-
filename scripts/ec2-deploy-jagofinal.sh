#!/bin/bash
set -euo pipefail
export HOME=/home/ubuntu
APP_DIR=/home/ubuntu/jago-app
SRC_DIR=/home/ubuntu/jago-src
REPO=https://github.com/jagopro452-cloud/JagoFinal-Code-.git
BACKUP=/home/ubuntu/jago-app-backup-$(date +%Y%m%d_%H%M%S)

echo "=== JAGO DEPLOY START $(date -Is) ==="
cp -a "$APP_DIR" "$BACKUP"
echo "Backup: $BACKUP"

if [ -d "$SRC_DIR/.git" ]; then
  cd "$SRC_DIR"
  git fetch origin main
  git reset --hard origin/main
else
  rm -rf "$SRC_DIR"
  git clone --depth 1 --branch main "$REPO" "$SRC_DIR"
fi
cd "$SRC_DIR"
COMMIT=$(git rev-parse --short HEAD)
echo "Source commit: $COMMIT"

if [ -f app/server/routes.ts ]; then
  CODE_ROOT="$SRC_DIR/app"
elif [ -f server/routes.ts ]; then
  CODE_ROOT="$SRC_DIR"
else
  echo "ERROR: cannot find server/routes.ts" >&2
  exit 1
fi
echo "Code root: $CODE_ROOT"

cp "$APP_DIR/.env" /tmp/jago-env-backup
rsync -a --delete \
  --exclude node_modules \
  --exclude .env \
  --exclude dist \
  "$CODE_ROOT/" "$APP_DIR/"
cp /tmp/jago-env-backup "$APP_DIR/.env"

cd "$APP_DIR"
git init -q 2>/dev/null || true
git add -A
git commit -m "production-deploy" -q || true

echo "=== npm ci ==="
npm ci
echo "=== npm run build ==="
export DEPLOYMENT_SHA="$COMMIT"
npm run build
echo "=== pm2 restart ==="
pm2 restart jago-server || pm2 start dist/index.js --name jago-server
sleep 8
echo "=== HEALTH ==="
curl -sS http://127.0.0.1:5000/api/health || true
echo ""
echo "=== PENDING RECOVERY ==="
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/api/app/customer/ride/pending-recovery || true
echo "=== DEPLOY DONE commit=$COMMIT ==="
