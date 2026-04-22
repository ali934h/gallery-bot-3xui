#!/bin/bash
# ============================================================
#  tg-gallery — Telegram Gallery Downloader Bot
#  Requires: 3x-ui already installed with a 'mixed' inbound
#            on 127.0.0.1:1080
#
#  Usage:
#    bash <(curl -Ls https://raw.githubusercontent.com/ali934h/tg-gallery/main/install.sh)
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[x]${NC} $1"; exit 1; }
ask()  { echo -e "${BLUE}[?]${NC} $1"; }

INSTALL_DIR="/root/tg-gallery"
REPO_URL="https://github.com/ali934h/tg-gallery.git"
NGINX_CONF_FILE="/etc/nginx/conf.d/tg-gallery.conf"

clear
echo -e ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║        tg-gallery — Gallery Downloader Bot        ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo -e ""

# ── Root check ───────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (sudo -i)"
fi

# ── Pre-flight ───────────────────────────────────────────────
echo -e "${YELLOW}═══════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  Pre-flight Check${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════${NC}"
echo ""
echo -e "This installer assumes you have:"
echo -e "  ✅ 3x-ui already installed and running"
echo -e "  ✅ A 'mixed' inbound created in 3x-ui panel:"
echo -e "      Protocol  : mixed"
echo -e "      Listen IP : 127.0.0.1"
echo -e "      Port      : 1080"
echo -e "      Password  : enabled (with username & password)"
echo ""
echo -e "  ✅ nginx installed on this server"
echo -e "  ✅ A separate domain for this bot (different from 3x-ui domain)"
echo -e "  ✅ SSL certificate for the bot domain"
echo ""
echo -e "  ${YELLOW}Warning: Any previous tg-gallery installation will be fully removed.${NC}"
echo ""

# Check nginx
if ! command -v nginx &>/dev/null; then
  warn "nginx not found. Installing..."
  apt-get update -qq
  apt-get install -y -qq nginx
  log "nginx installed."
else
  log "nginx already installed: $(nginx -v 2>&1)"
fi

# Test proxy availability
PROXY_AVAILABLE=false
if ss -tlnp 2>/dev/null | grep -q '127.0.0.1:1080'; then
  log "Proxy detected on 127.0.0.1:1080 ✓"
  PROXY_AVAILABLE=true
else
  warn "Proxy NOT detected on 127.0.0.1:1080"
  warn "Make sure you created a 'mixed' inbound in 3x-ui panel."
  echo ""
  ask "Continue anyway? [y/N]:"
  read -r CONTINUE_ANYWAY
  [[ ! "$CONTINUE_ANYWAY" =~ ^[Yy]$ ]] && { warn "Aborted."; exit 0; }
fi

# ── Collect configuration ────────────────────────────────────
echo ""
echo -e "${YELLOW}Please answer the following questions:${NC}\n"

# Bot Token
while true; do
  ask "Bot Token (from @BotFather):"
  read -r BOT_TOKEN
  [[ -n "$BOT_TOKEN" ]] && break
  warn "Bot token cannot be empty. Please try again."
done

# Webhook domain
while true; do
  ask "Bot domain — MUST be different from 3x-ui domain (e.g. bot.example.com):"
  read -r WEBHOOK_DOMAIN
  [[ -n "$WEBHOOK_DOMAIN" ]] && break
  warn "Domain cannot be empty. Please try again."
done

if [[ ! "$WEBHOOK_DOMAIN" =~ ^https?:// ]]; then
  WEBHOOK_DOMAIN="https://${WEBHOOK_DOMAIN}"
  log "Auto-added https:// → ${WEBHOOK_DOMAIN}"
fi
if [[ "$WEBHOOK_DOMAIN" =~ ^http:// ]]; then
  WEBHOOK_DOMAIN="${WEBHOOK_DOMAIN/http:/https:}"
  warn "Changed http:// to https:// (required for Telegram webhooks)"
fi
WEBHOOK_DOMAIN=${WEBHOOK_DOMAIN%/}
BARE_DOMAIN=${WEBHOOK_DOMAIN#https://}
BARE_DOMAIN=${BARE_DOMAIN%/}

# SSL cert
while true; do
  ask "SSL certificate path (e.g. /etc/letsencrypt/live/bot.example.com/fullchain.pem):"
  read -r SSL_CERT
  if [[ -z "$SSL_CERT" ]]; then
    warn "SSL cert path cannot be empty. Please try again."
  elif [[ ! -f "$SSL_CERT" ]]; then
    warn "File not found: $SSL_CERT — please check the path and try again."
  else
    break
  fi
done

# SSL key
while true; do
  ask "SSL key path (e.g. /etc/letsencrypt/live/bot.example.com/privkey.pem):"
  read -r SSL_KEY
  if [[ -z "$SSL_KEY" ]]; then
    warn "SSL key path cannot be empty. Please try again."
  elif [[ ! -f "$SSL_KEY" ]]; then
    warn "File not found: $SSL_KEY — please check the path and try again."
  else
    break
  fi
done

# Internal port
while true; do
  ask "Internal HTTP port for Node.js (default: 3000, change if already in use):"
  read -r INPUT_PORT
  INTERNAL_PORT=${INPUT_PORT:-3000}
  if ! [[ "$INTERNAL_PORT" =~ ^[0-9]+$ ]] || (( INTERNAL_PORT < 1024 || INTERNAL_PORT > 65535 )); then
    warn "Invalid port. Must be a number between 1024 and 65535. Please try again."
    continue
  fi
  RESERVED_PORTS=(80 443 1080 8080 8443)
  IS_RESERVED=false
  for p in "${RESERVED_PORTS[@]}"; do
    [[ "$INTERNAL_PORT" -eq "$p" ]] && IS_RESERVED=true && break
  done
  if $IS_RESERVED; then
    warn "Port $INTERNAL_PORT is reserved. Please choose a different port."
    continue
  fi
  if ss -tlnp 2>/dev/null | grep -q ":${INTERNAL_PORT} "; then
    warn "Port ${INTERNAL_PORT} is already in use. Please choose a different port."
    continue
  fi
  break
done

ask "Allowed Telegram user IDs (comma-separated, leave empty to allow everyone):"
read -r ALLOWED_USERS

# Concurrency
while true; do
  ask "Download concurrency (1-20, default: 5):"
  read -r DOWNLOAD_CONCURRENCY
  DOWNLOAD_CONCURRENCY=${DOWNLOAD_CONCURRENCY:-5}
  if [[ "$DOWNLOAD_CONCURRENCY" =~ ^[0-9]+$ ]] && (( DOWNLOAD_CONCURRENCY >= 1 && DOWNLOAD_CONCURRENCY <= 20 )); then
    break
  fi
  warn "Concurrency must be a number between 1 and 20. Please try again."
done

# Downloads directory
ask "Downloads directory (default: /root/tg-gallery-downloads):"
read -r DOWNLOADS_DIR
DOWNLOADS_DIR=${DOWNLOADS_DIR:-/root/tg-gallery-downloads}

DOWNLOAD_BASE_URL="${WEBHOOK_DOMAIN}/downloads"

# ── Proxy config ─────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Proxy Configuration (3x-ui mixed inbound)${NC}"
echo ""

ask "Did you enable 'Password' in the mixed inbound? [Y/n]:"
read -r HAS_AUTH

if [[ ! "$HAS_AUTH" =~ ^[Nn]$ ]]; then
  while true; do
    ask "Proxy username (from 3x-ui inbound):"
    read -r PROXY_USER
    [[ -n "$PROXY_USER" ]] && break
    warn "Proxy username cannot be empty. Please try again."
  done
  while true; do
    ask "Proxy password (from 3x-ui inbound):"
    read -r PROXY_PASS
    [[ -n "$PROXY_PASS" ]] && break
    warn "Proxy password cannot be empty. Please try again."
  done
  PROXY_URL="socks5://${PROXY_USER}:${PROXY_PASS}@127.0.0.1:1080"
else
  PROXY_URL="socks5://127.0.0.1:1080"
  log "Using proxy without authentication."
fi

# ── Configuration summary & confirm ──────────────────────────
echo ""
log "Configuration summary:"
echo    "  Bot domain    : $WEBHOOK_DOMAIN"
echo    "  Internal port : $INTERNAL_PORT"
echo    "  SSL Cert      : $SSL_CERT"
echo    "  SSL Key       : $SSL_KEY"
echo    "  Downloads     : $DOWNLOADS_DIR"
echo    "  Download URL  : $DOWNLOAD_BASE_URL"
echo    "  Concurrency   : $DOWNLOAD_CONCURRENCY"
echo    "  Allowed IDs   : ${ALLOWED_USERS:-<everyone>}"
echo    "  Proxy         : ${PROXY_URL:-disabled}"
echo    "  nginx conf    : $NGINX_CONF_FILE"
echo ""
ask "Proceed with installation? [Y/n]:"
read -r CONFIRM
[[ "$CONFIRM" =~ ^[Nn]$ ]] && { warn "Aborted."; exit 0; }

# ── [0] Cleanup previous installation ────────────────────────
echo ""
log "[0/6] Cleaning up previous installation..."

if command -v pm2 &>/dev/null; then
  pm2 delete tg-gallery 2>/dev/null && warn "PM2 process 'tg-gallery' removed." || true
  pm2 save --force 2>/dev/null || true
fi

if [[ -f "$NGINX_CONF_FILE" ]]; then
  BACKUP_PATH="${NGINX_CONF_FILE}.bak.$(date +%Y%m%d%H%M%S)"
  cp "$NGINX_CONF_FILE" "$BACKUP_PATH"
  rm -f "$NGINX_CONF_FILE"
  warn "nginx config backed up to: $BACKUP_PATH and removed."
fi

if [[ -d "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  warn "Removed old install directory: $INSTALL_DIR"
fi

log "Cleanup complete."

# ── [1] System dependencies ───────────────────────────────────
log "[1/6] Updating package list..."
apt-get update -qq

log "Installing dependencies (curl, git, unzip)..."
apt-get install -y -qq curl git unzip

# ── [2] Node.js & PM2 ────────────────────────────────────────
log "[2/6] Checking Node.js..."
if command -v node &>/dev/null; then
  log "Node.js already installed: $(node -v)"
else
  log "Installing Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &>/dev/null
  apt-get install -y -qq nodejs
  log "Node.js installed: $(node -v)"
fi

if command -v pm2 &>/dev/null; then
  log "PM2 already installed: $(pm2 -v)"
else
  log "Installing PM2..."
  npm install -g pm2 --silent
  log "PM2 installed."
fi

log "Installing pm2-logrotate..."
pm2 install pm2-logrotate --silent 2>/dev/null || true
pm2 set pm2-logrotate:max_size 10M 2>/dev/null || true
pm2 set pm2-logrotate:retain 7 2>/dev/null || true
log "pm2-logrotate configured."

# ── [3] Clone repo & npm install ─────────────────────────────
log "[3/6] Cloning repository to $INSTALL_DIR ..."
git clone "$REPO_URL" "$INSTALL_DIR" --quiet
cd "$INSTALL_DIR"

log "Installing npm packages..."
npm install --silent

log "Creating logs directory..."
mkdir -p "$INSTALL_DIR/logs"

log "Creating downloads directory: $DOWNLOADS_DIR"
mkdir -p "$DOWNLOADS_DIR"

log "Setting directory permissions for nginx..."
chmod 755 /root
chmod -R 755 "$DOWNLOADS_DIR"

# ── [4] Write .env ───────────────────────────────────────────
log "[4/6] Writing .env file..."
cat > "$INSTALL_DIR/.env" << EOF
# Telegram
BOT_TOKEN=${BOT_TOKEN}

# Environment
NODE_ENV=production

# Webhook — use a SEPARATE domain from 3x-ui!
WEBHOOK_DOMAIN=${WEBHOOK_DOMAIN}
WEBHOOK_PATH=/webhook

# Internal HTTP port (nginx reverse proxy handles SSL on 443)
PORT=${INTERNAL_PORT}

# Downloads
DOWNLOADS_DIR=${DOWNLOADS_DIR}
DOWNLOAD_BASE_URL=${DOWNLOAD_BASE_URL}

# Whitelist
ALLOWED_USERS=${ALLOWED_USERS}

# Concurrency
DOWNLOAD_CONCURRENCY=${DOWNLOAD_CONCURRENCY}

# Proxy — Xray mixed inbound from 3x-ui
PROXY_URL=${PROXY_URL}
EOF

chmod 600 "$INSTALL_DIR/.env"
log ".env written and secured (chmod 600)."

# ── [5] nginx config ─────────────────────────────────────────
log "[5/6] Writing nginx config: $NGINX_CONF_FILE"

cat > "$NGINX_CONF_FILE" << NGINXEOF
server {
    listen 80;
    server_name ${BARE_DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${BARE_DOMAIN};

    ssl_certificate     ${SSL_CERT};
    ssl_certificate_key ${SSL_KEY};
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location /webhook {
        proxy_pass         http://127.0.0.1:${INTERNAL_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }

    location /downloads/ {
        alias ${DOWNLOADS_DIR}/;
        add_header Content-Disposition "attachment";
        autoindex off;
    }

    location /health {
        proxy_pass         http://127.0.0.1:${INTERNAL_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host \$host;
    }
}
NGINXEOF

if ! nginx -t 2>/dev/null; then
  err "nginx config test failed! Check $NGINX_CONF_FILE manually."
fi

nginx -s reload
log "nginx configured and reloaded."

# ── [6] Start with PM2 ───────────────────────────────────────
cd "$INSTALL_DIR"
log "[6/6] Starting tg-gallery with PM2..."
pm2 start src/index.js --name tg-gallery --log "$INSTALL_DIR/logs/app.log"
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null | tail -1 | bash 2>/dev/null || true

# ── Done ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         tg-gallery installed successfully!         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Bot URL      : ${WEBHOOK_DOMAIN}"
echo -e "  Install dir  : ${INSTALL_DIR}"
echo -e "  Downloads    : ${DOWNLOADS_DIR}"
echo -e "  Download URL : ${DOWNLOAD_BASE_URL}"
echo -e "  Proxy        : ${PROXY_URL:-disabled}"
echo -e "  Node port    : 127.0.0.1:${INTERNAL_PORT} (internal)"
echo -e "  nginx conf   : ${NGINX_CONF_FILE}"
echo ""
echo -e "  Architecture:"
echo -e "    Internet → nginx:443 (SSL) → Node.js:${INTERNAL_PORT} (webhook/health)"
echo -e "    Internet → nginx:443 (SSL) → disk (downloads served directly)"
echo -e "    Other projects on nginx are NOT affected."
echo ""
echo -e "  Useful commands:"
echo -e "    pm2 logs tg-gallery         # view live logs"
echo -e "    pm2 restart tg-gallery      # restart bot"
echo -e "    pm2 stop tg-gallery         # stop bot"
echo -e "    bash update.sh             # update to latest version"
echo -e "    bash uninstall.sh          # remove completely"
echo -e "    nginx -t                    # test nginx config"
echo -e "    nginx -s reload             # reload nginx"
echo -e "    systemctl status x-ui       # check 3x-ui status"
echo ""
