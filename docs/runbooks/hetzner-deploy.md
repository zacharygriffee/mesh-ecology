# Hetzner Deployment Runbook (v0-safe, mirror mode)

This deployment is additive and keeps v0 protocol/runtime semantics unchanged.
Hetzner hosts run as always-on replicas of authority-provided discovery/concern keys.

## Components

- Discovery host service: `packages/hetzner-discovery-host/bin/discovery-host.js`
- Concern host service (optional): `packages/hetzner-concern-host/bin/concern-host.js`
- Operator CLI: `packages/mesh-operator-cli/bin/mesh.js`

## Config Files

- Discovery host: `/etc/mesh/discovery-host.json`
- Concern host: `/etc/mesh/concern-host.json`

Example templates:

- `deploy/config/discovery-host.example.json`
- `deploy/config/concern-host.example.json`

Config naming preference:

- JSON config files prefer camelCase keys such as `corestoreDir`, `swarmTopics`, `concernKeys`, and `updateIntervalMs`.
- Environment variables remain uppercase, for example `CORESTORE_DIR`, `SWARM_TOPICS`, and `CONCERN_KEYS`.
- Legacy uppercase JSON fields and legacy concern aliases (`concerns`, `CONCERNS`) remain accepted for compatibility.

## Mirror Mode Contract

- Discovery host mirrors an existing discovery base by key.
  - Set `DISCOVERY_KEY` in env or `discoveryKey` in JSON config.
  - If key is missing, host fails fast unless explicit create mode is requested (`--create` or `DISCOVERY_CREATE=1`).
- Concern host mirrors existing concern base keys.
  - Set `CONCERN_KEYS` in env or `concernKeys` in JSON config.
  - Legacy `concerns`/`CONCERNS` remain accepted for compatibility.
  - Empty list fails fast.
  - Host still enforces max 1 concern by default.

## 1) Authority Creates Discovery Key (local authority device)

Create/open discovery locally and capture its key:

```bash
CORESTORE_DIR=./store/discovery-authority \
SWARM_TOPICS=<topic-z32> \
node packages/hetzner-discovery-host/bin/discovery-host.js --create
```

Read `DISCOVERY_KEY=...` from startup logs, then stop the process.

## 2) Install On Hetzner

```bash
sudo bash deploy/install.sh
```

## 3) Configure Hetzner Discovery Host In Mirror Mode

Edit `/etc/mesh/discovery-host.json`:

```json
{
  "corestoreDir": "/var/lib/mesh/discovery",
  "discoveryKey": "<authority-discovery-z32>",
  "swarmTopics": ["<topic-z32>"],
  "swarmBootstrap": [],
  "discoveryWriters": ["<optional-operator-writer-z32>"],
  "updateIntervalMs": 1500,
  "heartbeatMs": 30000
}
```

Restart and verify:

```bash
sudo systemctl restart mesh-discovery-host
sudo journalctl -u mesh-discovery-host -n 100 --no-pager
```

Expected startup log includes:

- `mode=mirror`
- `discovery=<authority-discovery-z32>`
- `corestore=/var/lib/mesh/discovery`

## 4) Authority Adds Writer + Advertises Concern (durability barrier)

Admit authority/laptop writer key when needed:

```bash
CORESTORE_DIR=./store/operator \
SWARM_TOPICS=<topic-z32> \
node packages/mesh-operator-cli/bin/mesh.js discovery add-writer \
  --discovery <authority-discovery-z32> \
  --writer <laptop-writer-z32> \
  --wait --min-peers 1 --timeout-ms 45000
```

Advertise concern:

```bash
CORESTORE_DIR=./store/operator \
SWARM_TOPICS=<topic-z32> \
node packages/mesh-operator-cli/bin/mesh.js discovery advertise-concern \
  --discovery <authority-discovery-z32> \
  --concern <concern-z32> \
  --label "workstation-concern" \
  --wait --min-peers 1 --timeout-ms 45000
```

`durability: met` means write barrier succeeded before authority exits.

## 5) Mirror Concern On Hetzner (later)

Edit `/etc/mesh/concern-host.json`:

```json
{
  "corestoreDir": "/var/lib/mesh/concern",
  "concernKeys": ["<concern-z32>"],
  "swarmTopics": ["<topic-z32>"],
  "swarmBootstrap": [],
  "concernWriters": ["<optional-operator-writer-z32>"],
  "validation": 1,
  "updateIntervalMs": 1500,
  "heartbeatMs": 30000
}
```

Enable and verify:

```bash
sudo systemctl enable --now mesh-concern-host
sudo journalctl -u mesh-concern-host -n 100 --no-pager
```

Expected startup log includes:

- `mode=mirror`
- `concerns=<concern-z32>`
- `corestore=/var/lib/mesh/concern`

## Submit Job + Status

```bash
cat > /tmp/job.json << 'JSON'
{
  "cap": "cap/operator/manual",
  "in": {
    "task": "example",
    "payload": {"n": 1}
  }
}
JSON

CORESTORE_DIR=./store/operator \
SWARM_TOPICS=<topic-z32> \
node packages/mesh-operator-cli/bin/mesh.js job submit \
  --concern <concern-z32> \
  --json /tmp/job.json \
  --wait --min-peers 1 --timeout-ms 45000

CORESTORE_DIR=./store/operator \
SWARM_TOPICS=<topic-z32> \
node packages/mesh-operator-cli/bin/mesh.js status --concern <concern-z32>
```

## Update Procedure

```bash
cd /path/to/mesh-v0-2
git pull
sudo bash deploy/install.sh
sudo systemctl restart mesh-discovery-host
# Optional
sudo systemctl restart mesh-concern-host
```

## Logs

```bash
sudo journalctl -u mesh-discovery-host -f
sudo journalctl -u mesh-concern-host -f
```

## Common Issues

- Discovery host exits immediately:
  - `DISCOVERY_KEY`/`discoveryKey` is missing. Provide key for mirror mode.
  - Only use `--create`/`DISCOVERY_CREATE=1` for explicit bootstrap.

- Concern host exits immediately:
  - `CONCERN_KEYS`/`concerns` is empty.
  - More than one concern configured; host currently enforces max 1.

- No peers/connections:
  - Confirm all roles share at least one identical `SWARM_TOPICS` value.
  - If using private DHT, configure reachable `SWARM_BOOTSTRAP`.

- Discovery advertise or job submit not writable:
  - Admit operator key using `DISCOVERY_WRITERS` or `CONCERN_WRITERS` on writable host.
