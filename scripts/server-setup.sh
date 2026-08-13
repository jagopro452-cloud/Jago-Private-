#!/bin/bash
# ============================================================
# JAGO Platform - DigitalOcean Server Setup Script
# Run ONCE on a fresh Ubuntu 22.04 droplet as root
#
# One-command install:
#   curl -fsSL https://raw.githubusercontent.com/jagopro452-cloud/jago/master/scripts/server-setup.sh | bash
#
# With DATABASE_URL pre-set:
#   DATABASE_URL="postgresql://..." bash server-setup.sh
# ============================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[JAGO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

log "=============================================="
log " JAGO Platform - DigitalOcean Setup"
log "=============================================="

require_secret() {
  local key="$1"
  local prompt="$2"
  local current_value="${!key}"
  if [ -n "$current_value" ]; then
    return 0
  fi
  echo ""
  warn "$prompt"
  echo -n "$key: "
  read -r current_value
  [ -z "$current_value" ] && err "$key is required."
  export "$key=$current_value"
}

# ── Ask for DATABASE_URL if not already set ──────────────────
if [ -z "$DATABASE_URL" ] && [ -f "/var/www/jago/.env" ]; then
  DB_FROM_ENV=$(grep "^DATABASE_URL=" /var/www/jago/.env 2>/dev/null | cut -d= -f2-)
  if [ -n "$DB_FROM_ENV" ]; then
    DATABASE_URL="$DB_FROM_ENV"
  fi
fi

if [ -z "$DATABASE_URL" ]; then
  echo ""
  warn "DATABASE_URL not set. Enter your PostgreSQL connection string:"
  warn "Format: postgresql://user:password@host:5432/dbname"
  warn "Get this from Neon.tech (free) or your managed DB"
  echo -n "DATABASE_URL: "
  read -r DATABASE_URL
  [ -z "$DATABASE_URL" ] && err "DATABASE_URL is required."
fi
log "Database URL provided."

# ── 1. System Update ─────────────────────────────────────────
log "[1/9] System update..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -q
apt-get upgrade -y -q

# ── 2. Install Node.js 20 ────────────────────────────────────
log "[2/9] Installing Node.js 20..."
if ! node --version 2>/dev/null | grep -q "^v20"; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
  apt-get install -y -q nodejs
fi
log "Node: $(node -v) | NPM: $(npm -v)"

# ── 3. Install system tools ──────────────────────────────────
log "[3/9] Installing git, nginx, certbot, ufw..."
apt-get install -y -q git nginx certbot python3-certbot-nginx ufw

# ── 4. Install PM2 ───────────────────────────────────────────
log "[4/9] Installing PM2..."
npm install -g pm2 2>/dev/null

# ── 5. Firewall ──────────────────────────────────────────────
log "[5/9] Configuring firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# ── 6. Clone / Pull Repository ───────────────────────────────
log "[6/9] Cloning JAGO repository..."
mkdir -p /var/www
if [ -d "/var/www/jago/.git" ]; then
  log "Repo exists - pulling latest..."
  cd /var/www/jago
  git fetch origin
  git checkout master
  git pull --ff-only origin master || err "Fast-forward pull failed. Resolve local changes manually before deploying."
else
  git clone https://github.com/jagopro452-cloud/jago.git /var/www/jago
fi
cd /var/www/jago

# ── 7. Write .env ────────────────────────────────────────────
log "[7/9] Writing .env..."
OPS_KEY="jago-ops-$(openssl rand -hex 8)"
require_secret "ADMIN_EMAIL" "Enter the production admin email address."
require_secret "ADMIN_PASSWORD" "Enter a strong production admin password."
require_secret "ADMIN_RESET_KEY" "Enter a unique admin reset key."
require_secret "GOOGLE_MAPS_API_KEY" "Enter the production Google Maps API key."
cat > /var/www/jago/.env << ENVEOF
NODE_ENV=production
PORT=5000
DATABASE_URL=${DATABASE_URL}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_NAME=Admin
ADMIN_RESET_KEY=${ADMIN_RESET_KEY}
OPS_API_KEY=${OPS_KEY}
GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY}
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
FIREBASE_SERVICE_ACCOUNT_KEY=
ENVEOF
chmod 600 /var/www/jago/.env
log ".env written OK"

# ── 8. Build Application ─────────────────────────────────────
log "[8/9] Installing dependencies and building..."
cd /var/www/jago
npm ci --prefer-offline 2>&1 | tail -3
npm run build 2>&1 | tail -5

# ── 9. Configure Nginx + PM2 ─────────────────────────────────
log "[9/9] Configuring nginx and PM2..."

# Nginx config (HTTP only - certbot adds SSL later)
cat > /etc/nginx/sites-available/jago << 'NGINXEOF'
server {
    listen 80;
    server_name jagopro.org www.jagopro.org;

    client_max_body_size 20M;

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/jago /etc/nginx/sites-enabled/jago
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl enable nginx && systemctl reload nginx
log "Nginx configured OK"

mkdir -p /var/log/jago
set -a && source /var/www/jago/.env && set +a
# PM2 start (env vars inherited from shell)
pm2 describe jago > /dev/null 2>&1 && \
  pm2 restart jago --update-env || \
  pm2 start /var/www/jago/dist/index.js --name jago --max-memory-restart 512M

pm2 startup systemd -u root --hp /root 2>/dev/null | grep -v "^$" | bash 2>/dev/null || true
pm2 save
log "PM2 started OK"

# Health check
log "Waiting for startup (5s)..."
sleep 5
if curl -sf http://localhost:5000/api/health > /dev/null 2>&1; then
  log "Health check PASSED!"
else
  warn "Server starting... check: pm2 logs jago"
fi

# Get server IP
SERVER_IP=$(curl -s --max-time 5 https://ifconfig.me 2>/dev/null || curl -s --max-time 5 https://api.ipify.org 2>/dev/null || echo "YOUR_IP")

echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  JAGO Platform Setup Complete!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo -e "${CYAN}Server IP   :${NC}  $SERVER_IP"
echo -e "${CYAN}App URL     :${NC}  http://$SERVER_IP"
echo -e "${CYAN}Admin Panel :${NC}  http://$SERVER_IP/admin"
echo -e "${CYAN}Admin Email :${NC}  ${ADMIN_EMAIL}"
echo -e "${CYAN}Admin Pass  :${NC}  [hidden]"
echo ""
echo -e "${YELLOW}--- STEP A: Point DNS (Cloudflare/GoDaddy) ---${NC}"
echo "  jagopro.org  A record  ->  $SERVER_IP"
echo ""
echo -e "${YELLOW}--- STEP B: Enable HTTPS (run after DNS points here) ---${NC}"
echo "  certbot --nginx -d jagopro.org -d www.jagopro.org"
echo ""
echo -e "${YELLOW}--- STEP C: GitHub Auto-Deploy Secrets ---${NC}"
echo "  URL: https://github.com/jagopro452-cloud/jago/settings/secrets/actions"
echo "  DO_HOST   = $SERVER_IP"
echo "  DO_USER   = root"
echo "  DO_SSH_KEY = (paste contents of: cat ~/.ssh/id_rsa)"
echo ""
echo -e "${YELLOW}--- Useful Commands ---${NC}"
echo "  pm2 logs jago          # live server logs"
echo "  pm2 status             # server status"
echo "  nano /var/www/jago/.env  # edit env vars"
echo -e "${GREEN}============================================================${NC}"
