#!/usr/bin/env bash
set -euo pipefail
umask 022

ROOT_DIR="${1:-$(pwd)}"
START_DISCOVERY="${START_DISCOVERY:-if-configured}"

if [[ ! -f "${ROOT_DIR}/package.json" ]]; then
  echo "[remote-deploy] package.json not found at ${ROOT_DIR}" >&2
  echo "[remote-deploy] usage: bash deploy/remote-deploy.sh [/path/to/extracted/release]" >&2
  exit 1
fi

cd "${ROOT_DIR}"
echo "[remote-deploy] release root: ${ROOT_DIR}"

if [[ -f package-lock.json ]]; then
  echo "[remote-deploy] installing dependencies with npm ci --omit=dev"
  npm ci --omit=dev
else
  echo "[remote-deploy] package-lock.json missing; installing dependencies with npm install --omit=dev"
  npm install --omit=dev
fi

echo "[remote-deploy] auditing Hetzner packages"
node scripts/audit-hetzner-packages.js

echo "[remote-deploy] running installer (START_DISCOVERY=${START_DISCOVERY}; concern remains disabled unless ENABLE_CONCERN=1)"
sudo START_DISCOVERY="${START_DISCOVERY}" INSTALL_DEPS=0 bash deploy/install.sh

echo "[remote-deploy] service status"
sudo systemctl --no-pager --full status mesh-discovery-host.service || true
sudo systemctl --no-pager --full status mesh-concern-host.service || true

echo
echo "[remote-deploy] useful commands"
echo "sudo systemctl status mesh-discovery-host.service"
echo "sudo journalctl -u mesh-discovery-host -n 100 --no-pager"
echo "sudo journalctl -u mesh-discovery-host -f"
echo "sudo systemctl status mesh-concern-host.service"
echo "sudo journalctl -u mesh-concern-host -n 100 --no-pager"
echo "sudo journalctl -u mesh-concern-host -f"
echo
echo "[remote-deploy] startup controls:"
echo "  sudo START_DISCOVERY=if-configured INSTALL_DEPS=0 bash deploy/install.sh   # default"
echo "  sudo START_DISCOVERY=never INSTALL_DEPS=0 bash deploy/install.sh          # install/enable only"
echo "  sudo START_DISCOVERY=always INSTALL_DEPS=0 bash deploy/install.sh         # force start now"
