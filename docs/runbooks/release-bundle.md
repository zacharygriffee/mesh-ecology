# Release Bundle Runbook (Hetzner)

This runbook creates and deploys a release tarball for Hetzner without rsync.

## Build Bundle Locally

From repo root:

```bash
npm run bundle
```

The script writes:

- `dist/mesh-v0-2-<shortsha>.tar.gz` when git metadata is available
- `dist/mesh-v0-2-ts<UTC timestamp>.tar.gz` when git metadata is unavailable

Bundle contents are allowlisted and deterministic by file selection/order. It excludes `.git/`, `node_modules/`, `dist/`, `.DS_Store`, `tmp/`, `logs/`, corestore data dirs, env files, and key/cert-like files.

## Upload Bundle To Hetzner (scp)

Example:

```bash
scp dist/mesh-v0-2-<shortsha>.tar.gz <user>@<server>:/tmp/
```

No server IPs, usernames, or secrets are embedded in repo scripts; substitute your own target values.

## Unpack + Run Remote Deploy

On the Hetzner server:

```bash
sudo mkdir -p /opt/mesh/releases
sudo tar -xzf /tmp/mesh-v0-2-<shortsha>.tar.gz -C /opt/mesh/releases
sudo ln -sfn /opt/mesh/releases/mesh-v0-2-<shortsha> /opt/mesh-current
cd /opt/mesh-current
bash deploy/remote-deploy.sh
```

What `deploy/remote-deploy.sh` does:

1. Installs dependencies with `npm ci --omit=dev` when lockfile exists, otherwise `npm install --omit=dev`.
2. Runs `node scripts/audit-hetzner-packages.js` and fails on non-zero exit.
3. Runs `sudo INSTALL_DEPS=0 bash deploy/install.sh` (discovery host enabled by default).
4. Prints service status and journal commands.

## Enable Concern Host Later

Concern remains disabled by default.

To enable later:

```bash
cd /opt/mesh-current
sudo ENABLE_CONCERN=1 INSTALL_DEPS=0 bash deploy/install.sh
sudo systemctl enable --now mesh-concern-host.service
sudo systemctl status mesh-concern-host.service
```

## Rollback Strategy

Keep older tarballs and extracted release directories under `/opt/mesh/releases`.

Rollback by switching symlink to the previous release and reinstalling units/config wiring:

```bash
sudo ln -sfn /opt/mesh/releases/mesh-v0-2-<previous> /opt/mesh-current
cd /opt/mesh-current
bash deploy/remote-deploy.sh
```

Verify rollback:

```bash
sudo systemctl status mesh-discovery-host.service
sudo journalctl -u mesh-discovery-host -n 100 --no-pager
```
