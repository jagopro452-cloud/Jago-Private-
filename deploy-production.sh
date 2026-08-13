#!/bin/bash

set -euo pipefail

# ─── DEPRECATED (2026-08-04) ────────────────────────────────────────────────
# Production deploys moved to the GitHub Actions push pipeline in
# .github/workflows/deploy.yml on 2026-08-03 (see that file's header comment
# for the full migration history). That workflow targets a different app
# directory (/home/ubuntu/jago-app/app), a different PM2 process name
# (jago-server vs. jago-pro here), and even a different default branch
# (main vs. "master" hardcoded below) — confirming this script is a leftover
# from the earlier server-pull deploy model, not a currently-used alternate
# path. Running it against the same server as the GitHub Actions pipeline
# would create two divergent app directories / PM2 processes and is unsafe.
#
# If this script is still genuinely needed for some environment, remove the
# guard below AND update this comment to document exactly when/where it's
# used, per PHASE FINAL-2 P0-5 (do not leave two undocumented competing
# production paths).
if [[ "${I_UNDERSTAND_THIS_SCRIPT_IS_DEPRECATED:-}" != "1" ]]; then
  echo "ERROR: deploy-production.sh is deprecated — production deploys now run" >&2
  echo "via .github/workflows/deploy.yml (GitHub Actions push-to-EC2 pipeline)." >&2
  echo "Running this script accidentally would deploy to a different app" >&2
  echo "directory/PM2 process than the one CI manages, causing drift." >&2
  echo "If you are certain you need to run this script, set" >&2
  echo "I_UNDERSTAND_THIS_SCRIPT_IS_DEPRECATED=1 and re-run." >&2
  exit 1
fi
# ─────────────────────────────────────────────────────────────────────────────

APP_DIR="${APP_DIR:-/var/www/jago}"
PM2_APP_NAME="${PM2_APP_NAME:-jago-pro}"
PM2_ECOSYSTEM_FILE="${PM2_ECOSYSTEM_FILE:-ecosystem.config.cjs}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:5000/api/health}"
BRANCH="${BRANCH:-master}"
RELEASES_DIR="${RELEASES_DIR:-$APP_DIR/releases}"
ROLLBACK_LINK="${ROLLBACK_LINK:-$APP_DIR/previous}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_env_value() {
  local key="$1"
  if ! grep -Eq "^${key}=.+" "$ENV_FILE"; then
    echo "Missing required env key in $ENV_FILE: $key" >&2
    exit 1
  fi
}

require_command git
require_command npm
require_command node
require_command pm2
require_command curl

if [[ ! -d "$APP_DIR" ]]; then
  echo "APP_DIR does not exist: $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Production env file not found: $ENV_FILE" >&2
  exit 1
fi

for key in DATABASE_URL REDIS_URL GOOGLE_MAPS_API_KEY SOCKET_ALLOWED_ORIGINS RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET AUTH_JWT_SECRET APP_BASE_URL; do
  require_env_value "$key"
done

mkdir -p "$RELEASES_DIR"
CURRENT_COMMIT="$(git rev-parse HEAD)"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$RELEASES_DIR/$STAMP"

git fetch origin "$BRANCH"
TARGET_COMMIT="$(git rev-parse "origin/$BRANCH")"

if [[ "$CURRENT_COMMIT" == "$TARGET_COMMIT" ]]; then
  echo "Already at latest commit: $CURRENT_COMMIT"
else
  mkdir -p "$BACKUP_DIR"
  git archive "$CURRENT_COMMIT" | tar -x -C "$BACKUP_DIR"
  ln -sfn "$BACKUP_DIR" "$ROLLBACK_LINK"
  git pull --ff-only origin "$BRANCH"
fi

npm ci
npm run check
npm run build

if npm run | grep -q " migrate"; then
  npm run migrate
fi

pm2 startOrReload "$PM2_ECOSYSTEM_FILE" --env production

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    echo "Deployment health check passed"
    exit 0
  fi
  sleep 5
done

echo "Health check failed after deploy. Rolling back to previous release." >&2

if [[ -L "$ROLLBACK_LINK" ]]; then
  PREVIOUS_DIR="$(readlink "$ROLLBACK_LINK")"
  if [[ -d "$PREVIOUS_DIR" ]]; then
    rsync -a --delete "$PREVIOUS_DIR"/ "$APP_DIR"/
    npm ci
    npm run build
    pm2 startOrReload "$PM2_ECOSYSTEM_FILE" --env production
  fi
fi

exit 1
