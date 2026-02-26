#!/usr/bin/env bash
set -euo pipefail
umask 022

if [[ "${EUID}" -ne 0 ]]; then
  echo "run as root" >&2
  exit 1
fi

REPO_ROOT="${MESH_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MESH_USER="${MESH_USER:-mesh}"
MESH_GROUP="${MESH_GROUP:-mesh}"
CONFIG_DIR="/etc/mesh"
DATA_DIR="/var/lib/mesh"
SYSTEMD_DIR="/etc/systemd/system"
ENABLE_CONCERN="${ENABLE_CONCERN:-0}"
INSTALL_DEPS="${INSTALL_DEPS:-1}"
START_DISCOVERY="${START_DISCOVERY:-if-configured}"

ensure_group() {
  if ! getent group "${MESH_GROUP}" >/dev/null; then
    groupadd --system "${MESH_GROUP}"
  fi
}

ensure_user() {
  if ! id -u "${MESH_USER}" >/dev/null 2>&1; then
    useradd --system --home "${DATA_DIR}" --create-home --shell /usr/sbin/nologin --gid "${MESH_GROUP}" "${MESH_USER}"
  fi
}

render_unit() {
  local src="$1"
  local dst="$2"
  local escaped
  escaped="${REPO_ROOT//&/\\&}"
  sed "s#__MESH_REPO__#${escaped}#g" "${src}" > "${dst}"
}

install_config_if_missing() {
  local src="$1"
  local dst="$2"
  if [[ -f "${dst}" ]]; then
    return
  fi
  install -m 0644 "${src}" "${dst}"
}

ensure_repo_readable_by_mesh() {
  if [[ ! -d "${REPO_ROOT}" ]]; then
    return
  fi

  echo "[install] ensuring repo is readable by ${MESH_USER}:${MESH_GROUP}"
  chgrp -R "${MESH_GROUP}" "${REPO_ROOT}"
  chmod -R g+rX "${REPO_ROOT}"

  if command -v runuser >/dev/null 2>&1; then
    if ! runuser -u "${MESH_USER}" -- test -r "${REPO_ROOT}/material" >/dev/null 2>&1; then
      echo "[install] warning: ${MESH_USER} still cannot read ${REPO_ROOT}/material (check parent directory execute permissions)" >&2
    fi
  fi
}

discovery_config_ready() {
  local cfg="${CONFIG_DIR}/discovery-host.json"
  if [[ ! -f "${cfg}" ]]; then
    return 1
  fi

  node -e '
const fs = require("fs");
const cfg = process.argv[1];
try {
  const parsed = JSON.parse(fs.readFileSync(cfg, "utf8"));
  const rawKey = String(parsed.discoveryKey || parsed.DISCOVERY_KEY || "").trim();
  const rawCreate = String(parsed.DISCOVERY_CREATE || parsed.create || "").trim().toLowerCase();
  const createMode = rawCreate === "1" || rawCreate === "true" || rawCreate === "yes" || rawCreate === "on";

  if (createMode) process.exit(0);
  if (!rawKey) process.exit(1);
  if (rawKey.startsWith("<") || rawKey.includes("authority-discovery-z32")) process.exit(1);
  process.exit(0);
} catch {
  process.exit(1);
}
' "${cfg}"
}

echo "[install] repo=${REPO_ROOT}"
ensure_group
ensure_user

install -d -m 0755 "${CONFIG_DIR}" "${DATA_DIR}" "${DATA_DIR}/discovery" "${DATA_DIR}/concern"
chown -R "${MESH_USER}:${MESH_GROUP}" "${DATA_DIR}"

if [[ "${INSTALL_DEPS}" == "1" ]]; then
  echo "[install] installing node dependencies"
  cd "${REPO_ROOT}"
  if [[ -f package-lock.json ]]; then
    npm ci --omit=dev
  else
    npm install --omit=dev
  fi
fi

ensure_repo_readable_by_mesh

install_config_if_missing "${REPO_ROOT}/deploy/config/discovery-host.example.json" "${CONFIG_DIR}/discovery-host.json"
install_config_if_missing "${REPO_ROOT}/deploy/config/concern-host.example.json" "${CONFIG_DIR}/concern-host.json"

render_unit "${REPO_ROOT}/deploy/systemd/mesh-discovery-host.service" "${SYSTEMD_DIR}/mesh-discovery-host.service"
render_unit "${REPO_ROOT}/deploy/systemd/mesh-concern-host.service" "${SYSTEMD_DIR}/mesh-concern-host.service"

systemctl daemon-reload
case "${START_DISCOVERY}" in
  1|true|yes|on|always)
    systemctl enable --now mesh-discovery-host.service
    ;;
  auto|if-configured)
    systemctl enable mesh-discovery-host.service
    if discovery_config_ready; then
      systemctl start mesh-discovery-host.service
    else
      echo "[install] discovery host enabled but not started (set /etc/mesh/discovery-host.json discoveryKey or DISCOVERY_CREATE=1)"
    fi
    ;;
  0|false|no|off|never)
    systemctl enable mesh-discovery-host.service
    echo "[install] discovery host enabled but not started (START_DISCOVERY=${START_DISCOVERY})"
    ;;
  *)
    echo "[install] invalid START_DISCOVERY=${START_DISCOVERY} (use: always | if-configured | never)" >&2
    exit 1
    ;;
esac

if [[ "${ENABLE_CONCERN}" == "1" ]]; then
  systemctl enable --now mesh-concern-host.service
else
  echo "[install] concern host not enabled (set ENABLE_CONCERN=1 to enable)"
fi

echo "[install] done"
echo "[install] discovery logs: journalctl -u mesh-discovery-host -f"
echo "[install] concern logs:   journalctl -u mesh-concern-host -f"
