# CLI Authority Runbook

This runbook covers stateless authority CLI writes with a durability barrier:
append, wait for replication, exit.

## Prereqs

- Repo checkout with dependencies installed.
- At least one shared swarm topic (`z32`).
- Discovery host and concern host/peer online for replication.

## 1) Init Discovery (authoritative host)

Start discovery host once to create or reopen the discovery base:

```bash
CORESTORE_DIR=/var/lib/mesh/discovery \
SWARM_TOPICS=<topic-z32> \
node packages/hetzner-discovery-host/bin/discovery-host.js
```

Capture the printed `DISCOVERY_KEY` (`z32`).

## 2) Run Hetzner Host

Preferred production mode is systemd:

```bash
sudo bash deploy/install.sh
sudo systemctl restart mesh-discovery-host
sudo journalctl -u mesh-discovery-host -n 100 --no-pager
```

## 3) Add Writer (laptop/operator key admission)

Use the operator CLI against the discovery key:

```bash
CORESTORE_DIR=./store/operator \
SWARM_TOPICS=<topic-z32> \
node packages/mesh-operator-cli/bin/mesh.js discovery add-writer \
  --discovery <discovery-z32> \
  --writer <laptop-writer-z32> \
  --wait \
  --min-peers 1 \
  --timeout-ms 45000
```

## 4) Advertise Concern

```bash
CORESTORE_DIR=./store/operator \
SWARM_TOPICS=<topic-z32> \
node packages/mesh-operator-cli/bin/mesh.js discovery advertise-concern \
  --discovery <discovery-z32> \
  --concern <concern-z32> \
  --label "laptop-concern" \
  --wait \
  --min-peers 1 \
  --timeout-ms 45000
```

## 5) Submit Job

```bash
cat > /tmp/job.json <<'JSON'
{
  "cap": "cap/operator/manual",
  "in": {
    "task": "demo",
    "payload": {"n": 1}
  }
}
JSON

CORESTORE_DIR=./store/operator \
SWARM_TOPICS=<topic-z32> \
node packages/mesh-operator-cli/bin/mesh.js job submit \
  --concern <concern-z32> \
  --json /tmp/job.json \
  --wait \
  --min-peers 1 \
  --timeout-ms 45000
```

## Durability Behavior

Write commands default to waiting for durability.

- `durability: met` means at least one remote peer reported `remoteLength >= targetLength`.
- `durability: timeout` means timeout before that threshold; process exits nonzero.
- `--no-wait` skips the barrier (`durability: skipped`).

Use `--min-peers` to require a minimum connected peer count before barrier completion unless a peer already reaches target length.
