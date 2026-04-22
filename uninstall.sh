#!/bin/bash
# ============================================================
#  tg-gallery — Uninstall Script
#  Usage: bash uninstall.sh
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[x]${NC} $1"; exit 1; }

INSTALL_DIR="/root/tg-gallery"
NGINX_CONF_FILE="/etc/nginx/conf.d/tg-gallery.conf"

if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (sudo -i)"
fi

echo ""
echo -e "${RED}This will completely remove tg-gallery from this server.${NC}"
echo ""
read -r -p "Are you sure? [y/N]: " CONFIRM
[[ ! "$CONFIRM" =~ ^[Yy]$ ]] && { warn "Aborted."; exit 0; }

# Remove PM2 process
if command -v pm2 &>/dev/null; then
  pm2 delete tg-gallery 2>/dev/null && log "PM2 process 'tg-gallery' removed." || warn "No PM2 process found."
  pm2 save --force 2>/dev/null || true
fi

# Remove nginx config
if [[ -f "$NGINX_CONF_FILE" ]]; then
  rm -f "$NGINX_CONF_FILE"
  log "nginx config removed: $NGINX_CONF_FILE"
  nginx -s reload 2>/dev/null && log "nginx reloaded." || warn "nginx reload failed — check manually."
else
  warn "nginx config not found: $NGINX_CONF_FILE"
fi

# Remove install directory
if [[ -d "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  log "Install directory removed: $INSTALL_DIR"
else
  warn "Install directory not found: $INSTALL_DIR"
fi

echo ""
log "tg-gallery has been completely removed."
warn "Downloads directory was NOT removed. Delete it manually if needed:"
warn "  rm -rf /root/tg-gallery-downloads"
echo ""
