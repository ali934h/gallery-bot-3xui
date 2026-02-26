#!/bin/bash
# ============================================================
#  Gallery Downloader Bot — 3x-ui Edition
#  Requires: 3x-ui already installed with a 'mixed' inbound
#            on 127.0.0.1:1080
#
#  Usage:
#    bash <(curl -Ls https://raw.githubusercontent.com/ali934h/gallery-bot-3xui/main/install.sh)
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

INSTALL_DIR="/root/gallery-bot-3xui"
REPO_URL="https://github.com/ali934h/gallery-bot-3xui.git"

clear
echo -e ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Gallery Downloader Bot — 3x-ui Edition     ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo -e ""

# ── Root check ────────────────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (sudo -i)"
fi

# ── Pre-flight ────────────────────────────────────────────────────────────────────────────
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
echo -e "  ✅ A separate domain for this bot (different from 3x-ui domain)"
echo -e "  ✅ SSL certificate for the bot domain"
echo ""

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

# ── Collect configuration ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Please answer the following questions:${NC}\n"

ask "Bot Token (from @BotFather):"
read -r BOT_TOKEN
[[ -z "$BOT_TOKEN" ]] && err "Bot token cannot be empty."

ask "Bot domain — MUST be different from 3x-ui domain (e.g. bot.example.com):"
read -r WEBHOOK_DOMAIN
[[ -z "$WEBHOOK_DOMAIN" ]] && err "Domain cannot be empty."

if [[ ! "$WEBHOOK_DOMAIN" =~ ^https?:// ]]; then
  WEBHOOK_DOMAIN="https://${WEBHOOK_DOMAIN}"
  log "Auto-added https:// → ${WEBHOOK_DOMAIN}"
fi
if [[ "$WEBHOOK_DOMAIN" =~ ^http:// ]]; then
  WEBHOOK_DOMAIN="${WEBHOOK_DOMAIN/http:/https:}"
  warn "Changed http:// to https:// (required for Telegram webhooks)"
fi
WEBHOOK_DOMAIN=${WEBHOOK_DOMAIN%/}

ask "SSL certificate path (e.g. /etc/letsencrypt/live/bot.example.com/fullchain.pem):"
read -r SSL_CERT
[[ -z "$SSL_CERT" ]] && err "SSL cert path cannot be empty."

ask "SSL key path (e.g. /etc/letsencrypt/live/bot.example.com/privkey.pem):"
read -r SSL_KEY
[[ -z "$SSL_KEY" ]] && err "SSL key path cannot be empty."

ask "Allowed Telegram user IDs (comma-separated, leave empty to allow everyone):"
read -r ALLOWED_USERS

ask "Download concurrency (1-20, default: 5):"
read -r DOWNLOAD_CONCURRENCY
DOWNLOAD_CONCURRENCY=${DOWNLOAD_CONCURRENCY:-5}

ask "Downloads directory (default: /root/gallery-downloads):"
read -r DOWNLOADS_DIR
DOWNLOADS_DIR=${DOWNLOADS_DIR:-/root/gallery-downloads}

DOWNLOAD_BASE_URL="${WEBHOOK_DOMAIN}/downloads"

# ── Proxy config ──────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Proxy Configuration (3x-ui mixed inbound)${NC}"
echo ""

ask "Did you enable 'Password' in the mixed inbound? [Y/n]:"
read -r HAS_AUTH

if [[ ! "$HAS_AUTH" =~ ^[Nn]$ ]]; then
  ask "Proxy username (from 3x-ui inbound):"
  read -r PROXY_USER
  ask "Proxy password (from 3x-ui inbound):"
  read -r PROXY_PASS
  if [[ -n "$PROXY_USER" && -n "$PROXY_PASS" ]]; then
    PROXY_URL="socks5://${PROXY_USER}:${PROXY_PASS}@127.0.0.1:1080"
  else
    PROXY_URL="socks5://127.0.0.1:1080"
    warn "Username or password empty — using without auth."
  fi
else
  PROXY_URL="socks5://127.0.0.1:1080"
  log "Using proxy without authentication."
fi

echo ""
log "Configuration summary:"
echo    "  Bot domain  : $WEBHOOK_DOMAIN"
echo    "  SSL Cert    : $SSL_CERT"
echo    "  SSL Key     : $SSL_KEY"
echo    "  Downloads   : $DOWNLOADS_DIR"
echo    "  Download URL: $DOWNLOAD_BASE_URL"
echo    "  Concurrency : $DOWNLOAD_CONCURRENCY"
echo    "  Allowed IDs : ${ALLOWED_USERS:-<everyone>}"
echo    "  Proxy       : ${PROXY_URL:-disabled}"
echo ""
ask "Proceed with installation? [Y/n]:"
read -r CONFIRM
[[ "$CONFIRM" =~ ^[Nn]$ ]] && { warn "Aborted."; exit 0; }

# ── System dependencies ───────────────────────────────────────────────────────────────────
log "Updating package list..."
apt-get update -qq

log "Installing dependencies (curl, git, unzip, python3, ffmpeg)..."
apt-get install -y -qq curl git unzip python3 python3-pip ffmpeg

# ── yt-dlp ────────────────────────────────────────────────────────────────────────────────
if command -v yt-dlp &>/dev/null; then
  log "yt-dlp already installed: $(yt-dlp --version)"
else
  log "Installing yt-dlp..."
  curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  chmod +x /usr/local/bin/yt-dlp
  log "yt-dlp installed: $(yt-dlp --version)"
fi

# ── Node.js ───────────────────────────────────────────────────────────────────────────────
if command -v node &>/dev/null; then
  log "Node.js already installed: $(node -v)"
else
  log "Installing Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &>/dev/null
  apt-get install -y -qq nodejs
  log "Node.js installed: $(node -v)"
fi

# ── PM2 ───────────────────────────────────────────────────────────────────────────────────
if command -v pm2 &>/dev/null; then
  log "PM2 already installed: $(pm2 -v)"
else
  log "Installing PM2..."
  npm install -g pm2 --silent
  log "PM2 installed."
fi

# ── Clone / update repo ───────────────────────────────────────────────────────────────────
if [[ -d "$INSTALL_DIR/.git" ]]; then
  warn "Existing installation found. Updating..."
  cd "$INSTALL_DIR"
  git pull origin main --quiet
else
  log "Cloning repository to $INSTALL_DIR ..."
  git clone "$REPO_URL" "$INSTALL_DIR" --quiet
  cd "$INSTALL_DIR"
fi

# ── npm install ───────────────────────────────────────────────────────────────────────────
log "Installing npm packages..."
npm install --silent

# ── Downloads directory ───────────────────────────────────────────────────────────────────
log "Creating downloads directory: $DOWNLOADS_DIR"
mkdir -p "$DOWNLOADS_DIR"

# ── Write .env ────────────────────────────────────────────────────────────────────────────
log "Writing .env file..."
cat > "$INSTALL_DIR/.env" << EOF
# Telegram
BOT_TOKEN=${BOT_TOKEN}

# Environment
NODE_ENV=production

# Webhook — use a SEPARATE domain from 3x-ui!
WEBHOOK_DOMAIN=${WEBHOOK_DOMAIN}
WEBHOOK_PATH=/webhook
HTTPS_PORT=443

# Downloads
DOWNLOADS_DIR=${DOWNLOADS_DIR}
DOWNLOAD_BASE_URL=${DOWNLOAD_BASE_URL}

# SSL (for the bot domain)
SSL_CERT=${SSL_CERT}
SSL_KEY=${SSL_KEY}

# Whitelist
ALLOWED_USERS=${ALLOWED_USERS}

# Concurrency
DOWNLOAD_CONCURRENCY=${DOWNLOAD_CONCURRENCY}

# Proxy — Xray mixed inbound from 3x-ui
PROXY_URL=${PROXY_URL}
EOF

chmod 600 "$INSTALL_DIR/.env"
log ".env written and secured (chmod 600)."

# ── Start / restart with PM2 ──────────────────────────────────────────────────────────────
cd "$INSTALL_DIR"

if pm2 list | grep -q "gallery-bot"; then
  log "Restarting existing PM2 process..."
  pm2 restart gallery-bot --update-env
else
  log "Starting bot with PM2..."
  pm2 start src/index.js --name gallery-bot
fi

log "Saving PM2 process list..."
pm2 save

log "Enabling PM2 on system startup..."
pm2 startup systemd -u root --hp /root 2>/dev/null | tail -1 | bash 2>/dev/null || true

# ── Done ──────────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           Installation Complete!             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Bot URL     : ${WEBHOOK_DOMAIN}"
echo -e "  Install dir : ${INSTALL_DIR}"
echo -e "  Downloads   : ${DOWNLOADS_DIR}"
echo -e "  Download URL: ${DOWNLOAD_BASE_URL}"
echo -e "  Proxy       : ${PROXY_URL:-disabled}"
echo ""
echo -e "  Features:"
echo -e "    🖼 Gallery downloader (multi-site support)"
echo -e "    🎬 YouTube downloader (up to 1080p)"
echo ""
echo -e "  Useful commands:"
echo -e "    pm2 logs gallery-bot       # view live logs"
echo -e "    pm2 restart gallery-bot    # restart bot"
echo -e "    pm2 stop gallery-bot       # stop bot"
echo -e "    systemctl status x-ui      # check 3x-ui status"
echo -e "    yt-dlp --version           # check yt-dlp version"
echo ""
