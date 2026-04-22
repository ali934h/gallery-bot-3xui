#!/bin/bash
# ============================================================
#  tg-gallery — Update Script
#  Usage: bash update.sh
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

if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (sudo -i)"
fi

if [[ ! -d "$INSTALL_DIR" ]]; then
  err "Install directory not found: $INSTALL_DIR — run install.sh first."
fi

cd "$INSTALL_DIR"

log "Pulling latest changes..."
git pull

log "Installing dependencies..."
npm install --silent

log "Restarting bot..."
pm2 restart tg-gallery

log "Update complete."
