#!/bin/bash
# Deploy latest server fixes to EC2 production
# Usage: bash scripts/ec2-deploy-server-fixes.sh

set -euo pipefail

EC2_HOST="${EC2_HOST:-15.207.65.184}"
EC2_USER="${EC2_USER:-ubuntu}"
APP_DIR="${APP_DIR:-/home/ubuntu/jago-app}"

echo "==> Syncing server files to $EC2_USER@$EC2_HOST:$APP_DIR"
rsync -avz --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude dist \
  ./canonical-app/server/ "$EC2_USER@$EC2_HOST:$APP_DIR/server/"

echo "==> Building and restarting PM2"
ssh "$EC2_USER@$EC2_HOST" bash -lc "'
  cd $APP_DIR
  npm run build
  pm2 restart jago-server
  pm2 logs jago-server --lines 30 --nostream
'"

echo "==> Smoke tests"
curl -sf "http://$EC2_HOST:5000/api/health" | head -c 200 && echo
curl -sf "http://$EC2_HOST:5000/api/health/maps" | head -c 200 && echo

echo "Deploy complete."
