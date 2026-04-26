#!/usr/bin/env bash
# tg-gallery updater — pulls the latest commit, refreshes deps, restarts PM2.
set -euo pipefail

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; NC=$'\033[0m'
info() { echo "${GREEN}[+]${NC} $*"; }
err()  { echo "${RED}[x]${NC} $*" >&2; exit 1; }

INSTALL_DIR="/root/tg-gallery"

[[ $EUID -eq 0 ]] || err "Must run as root (sudo -i)."
[[ -d "$INSTALL_DIR" ]] || err "Install directory not found: $INSTALL_DIR — run install.sh first."

cd "$INSTALL_DIR"

info "Pulling latest changes"
git pull --ff-only

info "Installing npm packages"
npm install --silent --no-audit --no-fund >/dev/null

info "Restarting bot"
pm2 restart tg-gallery --update-env

info "Update complete."
