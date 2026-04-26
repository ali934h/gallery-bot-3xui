#!/usr/bin/env bash
# tg-gallery uninstaller.
set -euo pipefail

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'
info() { echo "${GREEN}[+]${NC} $*"; }
warn() { echo "${YELLOW}[!]${NC} $*"; }
err()  { echo "${RED}[x]${NC} $*" >&2; exit 1; }

INSTALL_DIR="/root/tg-gallery"
NGINX_CONF_FILE="/etc/nginx/conf.d/tg-gallery.conf"

[[ $EUID -eq 0 ]] || err "Must run as root (sudo -i)."

DOWNLOADS_DIR=""
TEMP_DIR=""
if [[ -f "$INSTALL_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$INSTALL_DIR/.env"; set +a
fi
DOWNLOADS_DIR="${DOWNLOADS_DIR:-/var/lib/tg-gallery/downloads}"
TEMP_DIR="${TEMP_DIR:-/var/lib/tg-gallery/temp}"

echo
echo "${RED}This will completely remove tg-gallery from this server.${NC}"
read -r -p "Continue? [y/N]: " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || { warn "Aborted."; exit 0; }

if command -v pm2 >/dev/null 2>&1; then
  pm2 delete tg-gallery >/dev/null 2>&1 && info "PM2 process removed" || warn "No PM2 process found"
  pm2 save --force >/dev/null 2>&1 || true
fi

if [[ -f "$NGINX_CONF_FILE" ]]; then
  cp "$NGINX_CONF_FILE" "${NGINX_CONF_FILE}.bak.$(date +%Y%m%d%H%M%S)"
  rm -f "$NGINX_CONF_FILE"
  info "nginx conf removed (backup kept)"
  nginx -s reload 2>/dev/null || warn "nginx reload failed — check manually"
fi

if [[ -d "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  info "Install directory removed: $INSTALL_DIR"
fi

read -r -p "Also delete downloaded ZIP files in '$DOWNLOADS_DIR'? [y/N]: " DEL_DOWN
if [[ "$DEL_DOWN" =~ ^[Yy]$ ]]; then
  rm -rf "$DOWNLOADS_DIR"
  info "Removed $DOWNLOADS_DIR"
fi

read -r -p "Also delete temp working dir '$TEMP_DIR'? [y/N]: " DEL_TEMP
if [[ "$DEL_TEMP" =~ ^[Yy]$ ]]; then
  rm -rf "$TEMP_DIR"
  info "Removed $TEMP_DIR"
fi

info "tg-gallery has been uninstalled."
