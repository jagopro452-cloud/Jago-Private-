#!/bin/bash
# Deploy JagoFinal-Code app/ to AWS EC2 production (senior-dev safe deploy)
# Usage on EC2:
#   bash scripts/ec2-deploy-from-jagofinal.sh
#
# Env overrides:
#   REPO_DIR=/home/ubuntu/JagoFinal-Code
#   APP_DIR=/home/ubuntu/jago-app
#   BRANCH=main

set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/ubuntu/JagoFinal-Code}"
APP_DIR="${APP_DIR:-/home/ubuntu/jago-app}"
BRANCH="${BRANCH:-main}"
REPO_URL="${REPO_URL:-https://github.com/jagopro452-cloud/JagoFinal-Code-.git}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:5000/api/health}"
PM2_NAME="${PM2_NAME:-jago-server}"

log() { echo "[deploy] $*"; }
fail() { echo "[deploy] ERROR: $*" >&2; exit 1; }

command -v git >/dev/null || fail "git not installed"
command -v npm >/dev/null || fail "npm not installed"
command -v pm2 >/dev/null || fail "pm2 not installed"
command -v curl >/dev/null || fail "curl not installed"
command -v rsync >/dev/null || fail "rsync not installed"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  log "Cloning $REPO_URL -> $REPO_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
else
  log "Pulling latest $BRANCH in $REPO_DIR"
  git -C "$REPO_DIR" fetch origin "$BRANCH"
  git -C "$REPO_DIR" checkout "$BRANCH"
  git -C "$REPO_DIR" pull --ff-only origin "$BRANCH"
fi

COMMIT="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
log "Deploying commit $COMMIT"

# Pre-deploy verification — abort if critical fixes missing
grep -q "driver/car-sharing/create" "$REPO_DIR/app/server/routes.ts" || fail "routes.ts missing driver car-sharing APIs"
grep -q "TOO_FAR_FROM_PICKUP" "$REPO_DIR/app/server/routes.ts" || fail "routes.ts missing pickup geofence"

mkdir -p "$APP_DIR"
log "Syncing app/ -> $APP_DIR"
rsync -a --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude "public/apks" \
  "$REPO_DIR/app/" "$APP_DIR/"

cd "$APP_DIR"
log "Building..."
npm ci
npm run build

log "Restarting PM2 ($PM2_NAME)"
pm2 restart "$PM2_NAME" || pm2 start dist/index.js --name "$PM2_NAME"

log "Health check..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    log "SUCCESS — deployed $COMMIT"
    curl -fsS "$HEALTH_URL"
    exit 0
  fi
  sleep 3
done

fail "Health check failed after deploy"
