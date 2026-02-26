# Prompt Audit: Authority → Mirror Bootstrap

## Scope Note
- Requested input path `/mnt/data/codex-authority-mirror-bootstrap-prompt.md` is not present in this environment.
- Audit source used: `docs/dev/codex-authority-mirror-bootstrap-prompt.md` (current in-repo draft).

## Prompt Audit Report

### Issue 1: Remote config application is not executable (missing ssh/scp)
- Problematic prompt excerpt:
  - `Apply remote config and restart service:`
  - `sudo systemctl restart mesh-discovery-host`
  - `sudo systemctl enable --now mesh-concern-host`
- Why this fails:
  - The draft does not specify how config files are transferred/installed on the remote host.
  - It assumes commands are already running on remote, which is ambiguous for an LLM/human automation flow.
- Repo evidence:
  - systemd units read fixed config paths via `--config /etc/mesh/*.json`:
    - `deploy/systemd/mesh-discovery-host.service:12-13`
    - `deploy/systemd/mesh-concern-host.service:12-13`
  - Installer only copies example configs if missing (does not overwrite existing live config):
    - `deploy/install.sh:38-45`
    - `deploy/install.sh:64-65`
- Fix applied in corrected prompt:
  - Added explicit `scp` + `ssh` + `sudo install -m 0644 ... /etc/mesh/*.json` commands, then `systemctl restart/enable`.

### Issue 2: Writer-key strategy is ambiguous (`<WRITER_Z32>` placeholder only)
- Problematic prompt excerpt:
  - `--writer <WRITER_Z32>` (no deterministic generation method)
- Why this fails:
  - Operator writer keys are namespace-derived and must be known before admission.
  - Placeholder-only guidance causes drift and non-reproducible setup.
- Repo evidence:
  - Operator CLI uses fixed namespaces:
    - discovery writer namespace: `packages/mesh-operator-cli/bin/mesh.js:278-281`
    - concern writer namespace: `packages/mesh-operator-cli/bin/mesh.js:391-394`
  - Deterministic writer derivation pattern exists in smoke script:
    - `scripts/smoke-hetzner-packages.js:95-104`
  - Host-side writer admission knobs exist:
    - discovery: `packages/hetzner-discovery-host/bin/discovery-host.js:136-138`, `196-211`
    - concern: `packages/hetzner-concern-host/bin/concern-host.js:114-116`, `180-196`
- Fix applied in corrected prompt:
  - Chosen posture **B** explicitly: separate operator writer keys, admitted once.
  - Added deterministic writer-key derivation command (`Autobase.getLocalKey(...)`).

### Issue 3: Concern key acquisition is unspecified
- Problematic prompt excerpt:
  - `Determine CONCERN_KEY_Z32 (authority-created concern key).`
- Why this fails:
  - No executable method is provided.
  - Concern host does not support `--create`; it requires configured key(s).
- Repo evidence:
  - concern-host CLI supports only `--config`/`--help`:
    - `packages/hetzner-concern-host/bin/concern-host.js:19-35`
  - concern-host refuses empty concern list and enforces max 1:
    - `packages/hetzner-concern-host/bin/concern-host.js:203-207`
  - existing repo pattern to mint concern key via API exists:
    - `scripts/smoke-hetzner-packages.js:80-93`
- Fix applied in corrected prompt:
  - Added exact command to create a concern key locally via `ensureConcernSurface(...)` and print z32.

### Issue 4: Missing stop conditions for interface drift
- Problematic prompt excerpt:
  - No explicit STOP behavior if required interfaces are absent.
- Why this fails:
  - LLMs may continue with invalid assumptions when flags/commands differ.
- Repo evidence:
  - discovery create path exists now (`--create`):
    - `packages/hetzner-discovery-host/bin/discovery-host.js:31-33`, `45-53`
  - concern host does not have `--create` and requires concern keys:
    - `packages/hetzner-concern-host/bin/concern-host.js:19-35`, `203-205`
  - CLI durability contract is specific and should be verified:
    - `packages/mesh-operator-cli/bin/mesh.js:32-40`, `214-227`
- Fix applied in corrected prompt:
  - Added explicit preflight checks and STOP conditions with exact commands.

### Issue 5: Packaging semantics are implicit and may drift
- Problematic prompt excerpt:
  - No explicit statement of preferred replication model vs snapshot copying.
- Why this fails:
  - Readers may incorrectly assume data-copy is required for mirror bring-up.
- Repo evidence:
  - Discovery/concern hosts replicate via swarm and open by key:
    - discovery open-by-key path: `packages/hetzner-discovery-host/bin/discovery-host.js:250-258`
    - concern open-by-key path: `packages/hetzner-concern-host/bin/concern-host.js:231-237`
  - runbook states mirror-by-key model:
    - `docs/runbooks/hetzner-deploy.md:22-30`
- Fix applied in corrected prompt:
  - Added explicit framing: ship software + key(s), replicate over swarm.
  - Marked corestore snapshot copy as optional bootstrap optimization only.

### Issue 6: Durability verification is under-specified for machine execution
- Problematic prompt excerpt:
  - `Confirm output contains: durability: met` (no explicit linkage to command defaults/flags)
- Why this fails:
  - Should tie to concrete command semantics and defaults to avoid omission.
- Repo evidence:
  - write commands and durability defaults/flags:
    - `packages/mesh-operator-cli/bin/mesh.js:32-40`
    - `packages/mesh-operator-cli/bin/mesh.js:265-269`
    - `packages/mesh-operator-cli/bin/mesh.js:376-380`
  - machine-parseable durability lines:
    - `packages/mesh-operator-cli/bin/mesh.js:214-227`
  - contract doc:
    - `docs/dev/agent-cli-contract.md:16-40`
- Fix applied in corrected prompt:
  - Added explicit `--wait --min-peers --timeout-ms` usage and pass/fail checks for `durability: met`.

---

# Authority → Mirror Bootstrap (Repo-Accurate Prompt)

```text
TASK: Create local authority Discovery + Concern surfaces, mirror them on a remote host, and perform authority writes with durability barriers using current repo interfaces only.

REPO
- /home/zevilz/WebstormProjects/mesh-v0-2

HARD RULES
1) No protocol/runtime semantic changes.
2) No refactors.
3) Use existing binaries/scripts/APIs only.
4) No HTTP/RPC services.
5) Keep role isolation: separate corestore dirs for discovery vs concern.

WRITER STRATEGY (EXPLICIT)
- Posture B: Use a separate operator writer store.
- Generate operator writer keys deterministically, admit once on writable authority hosts, then use mesh CLI for writes.

INPUTS
- TOPIC_Z32=<shared-topic-z32>
- REMOTE_SSH=<user@remote-host>
- AUTH_DISCOVERY_DIR=./store/authority-discovery
- AUTH_CONCERN_DIR=./store/authority-concern
- OPERATOR_DIR=./store/operator
- OBSERVER_DIR=./store/observer

PREFLIGHT CHECKS (STOP IF ANY FAIL)
1) Verify discovery create capability exists:
   node packages/hetzner-discovery-host/bin/discovery-host.js --help | rg -- '--create'
2) Verify concern host key-based mirror interface exists:
   node packages/hetzner-concern-host/bin/concern-host.js --help | rg -- 'CONCERN_KEYS'
3) Verify mesh CLI write commands + durability flags exist:
   node packages/mesh-operator-cli/bin/mesh.js --help | rg -- 'discovery add-writer'
   node packages/mesh-operator-cli/bin/mesh.js --help | rg -- '--wait\|--no-wait'

STOP CONDITIONS
- If (1) fails: STOP. Run prerequisite prompt that adds discovery create-mode support.
- If (2) fails: STOP. Run prerequisite prompt that adds concern key-based mirror config support.
- If (3) fails: STOP. Run prerequisite prompt that adds CLI durability barrier/write command support.

STEP 1: Generate operator writer keys deterministically
- Command:
  eval "$(CORESTORE_DIR=\"$OPERATOR_DIR\" node --input-type=module <<'NODE'
import Autobase from "autobase";
import idEncoding from "hypercore-id-encoding";
import { ensureCorestore } from "./src/ensureCorestore.js";

const cs = ensureCorestore(process.env.CORESTORE_DIR);
await cs.ready?.();
const discoveryWriter = await Autobase.getLocalKey(cs.namespace("mesh-operator-discovery"));
const concernWriter = await Autobase.getLocalKey(cs.namespace("mesh-operator-concern"));
console.log(`DISCOVERY_WRITER=${idEncoding.encode(discoveryWriter)}`);
console.log(`CONCERN_WRITER=${idEncoding.encode(concernWriter)}`);
await cs.close?.().catch(() => {});
NODE
)"
- Expected outputs now available in env:
  - $DISCOVERY_WRITER
  - $CONCERN_WRITER

STEP 2: Start local authority Discovery in create mode and capture key
- Run (foreground terminal):
  CORESTORE_DIR="$AUTH_DISCOVERY_DIR" \
  SWARM_TOPICS="$TOPIC_Z32" \
  DISCOVERY_WRITERS="$DISCOVERY_WRITER" \
  node packages/hetzner-discovery-host/bin/discovery-host.js --create
- Capture from stdout:
  - DISCOVERY_KEY=<z32>
- Export it for later steps:
  - export DISCOVERY_KEY=<captured-z32>
- Keep this authority discovery host running while testing.

STEP 3: Create local authority Concern key and start local authority Concern host
- Create concern key once (non-interactive):
  CONCERN_KEY_Z32="$(CORESTORE_DIR="$AUTH_CONCERN_DIR" node --input-type=module <<'NODE'
import idEncoding from "hypercore-id-encoding";
import { ensureCorestore } from "./src/ensureCorestore.js";
import { ensureConcernSurface } from "./src/concern.js";

const cs = ensureCorestore(process.env.CORESTORE_DIR);
await cs.ready?.();
const swarm = { connections: new Set(), on() {}, off() {} };
const concern = await ensureConcernSurface(cs.namespace("mesh-concern-host-1"), swarm, {});
console.log(idEncoding.encode(concern.key));
await concern.close().catch(() => {});
await cs.close?.().catch(() => {});
NODE
)"
  echo "$CONCERN_KEY_Z32"
- Start authority concern host (foreground terminal):
  CORESTORE_DIR="$AUTH_CONCERN_DIR" \
  CONCERN_KEYS="$CONCERN_KEY_Z32" \
  SWARM_TOPICS="$TOPIC_Z32" \
  CONCERN_WRITERS="$CONCERN_WRITER" \
  node packages/hetzner-concern-host/bin/concern-host.js
- Keep this authority concern host running while testing.

STEP 4: Apply remote mirror configs concretely (scp + ssh)
- Ensure remote units/config skeleton are installed first:
  ssh "$REMOTE_SSH" "cd /path/to/mesh-v0-2 && sudo bash deploy/install.sh"
  (Units read `/etc/mesh/discovery-host.json` and `/etc/mesh/concern-host.json`.)
- Create local temp discovery mirror config:
  cat > /tmp/discovery-host.json <<JSON
  {
    "CORESTORE_DIR": "/var/lib/mesh/discovery",
    "discoveryKey": "${DISCOVERY_KEY}",
    "SWARM_TOPICS": ["${TOPIC_Z32}"],
    "SWARM_BOOTSTRAP": [],
    "DISCOVERY_WRITERS": [],
    "UPDATE_INTERVAL_MS": 1500,
    "HEARTBEAT_MS": 30000
  }
  JSON
- Ship + install + restart discovery mirror:
  scp /tmp/discovery-host.json "$REMOTE_SSH:/tmp/discovery-host.json"
  ssh "$REMOTE_SSH" "sudo install -m 0644 /tmp/discovery-host.json /etc/mesh/discovery-host.json && sudo systemctl restart mesh-discovery-host && sudo journalctl -u mesh-discovery-host -n 80 --no-pager"
- Verify journal includes:
  - mode=mirror
  - discovery=${DISCOVERY_KEY}
  - corestore=/var/lib/mesh/discovery

- Create local temp concern mirror config:
  cat > /tmp/concern-host.json <<JSON
  {
    "CORESTORE_DIR": "/var/lib/mesh/concern",
    "concerns": ["${CONCERN_KEY_Z32}"],
    "SWARM_TOPICS": ["${TOPIC_Z32}"],
    "SWARM_BOOTSTRAP": [],
    "CONCERN_WRITERS": [],
    "VALIDATION": 1,
    "UPDATE_INTERVAL_MS": 1500,
    "HEARTBEAT_MS": 30000
  }
  JSON
- Ship + install + enable concern mirror:
  scp /tmp/concern-host.json "$REMOTE_SSH:/tmp/concern-host.json"
  ssh "$REMOTE_SSH" "sudo install -m 0644 /tmp/concern-host.json /etc/mesh/concern-host.json && sudo systemctl enable --now mesh-concern-host && sudo journalctl -u mesh-concern-host -n 80 --no-pager"
- Verify journal includes:
  - mode=mirror
  - concerns=${CONCERN_KEY_Z32}
  - corestore=/var/lib/mesh/concern

STEP 5: Authority writes with durability barrier (no timing hacks)
- Discovery advertise-concern:
  ADV_OUT="$(CORESTORE_DIR="$OPERATOR_DIR" SWARM_TOPICS="$TOPIC_Z32" node packages/mesh-operator-cli/bin/mesh.js discovery advertise-concern --discovery "$DISCOVERY_KEY" --concern "$CONCERN_KEY_Z32" --label "authority-concern" --wait --min-peers 1 --timeout-ms 45000)"
  echo "$ADV_OUT"
  echo "$ADV_OUT" | rg -- 'durability: met'

- Concern job submit:
  cat > /tmp/job.json <<JSON
  {
    "cap": "cap/operator/manual",
    "in": { "task": "bootstrap-check", "payload": { "n": 1 } }
  }
  JSON
  JOB_OUT="$(CORESTORE_DIR="$OPERATOR_DIR" SWARM_TOPICS="$TOPIC_Z32" node packages/mesh-operator-cli/bin/mesh.js job submit --concern "$CONCERN_KEY_Z32" --json /tmp/job.json --wait --min-peers 1 --timeout-ms 45000)"
  echo "$JOB_OUT"
  echo "$JOB_OUT" | rg -- 'durability: met'

STEP 6: Verify mirrored concern can read materialized job state
- Run observer status command (read-only check):
  CORESTORE_DIR="$OBSERVER_DIR" SWARM_TOPICS="$TOPIC_Z32" node packages/mesh-operator-cli/bin/mesh.js status --concern "$CONCERN_KEY_Z32"
- Pass condition:
  - JSON output has counts.jobs > 0

PACKAGING NOTE (IMPORTANT)
- Preferred mode: ship software + config + surface key(s), then replicate logs over swarm.
- Optional only: copy corestore snapshot to seed faster catch-up; this is not required for mirror correctness.

OUTPUT FORMAT
1) DISCOVERY_KEY and CONCERN_KEY_Z32 values.
2) Discovery/Concern writer keys used for operator admission.
3) Exact ssh/scp commands run.
4) Journal evidence lines for both mirrors (mode + key + corestore).
5) CLI evidence lines showing durability: met for discovery/job writes.
6) Observer status JSON showing jobs materialized.
7) Any stop condition triggered and next prerequisite prompt required.
```
