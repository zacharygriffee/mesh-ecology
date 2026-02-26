#!/usr/bin/env node
import { readFile, access, readdir } from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const EXPECTED_PATH = path.join(ROOT, "scripts", "audit-hetzner-packages.expected.json");

async function exists(relPath) {
  try {
    await access(path.join(ROOT, relPath));
    return true;
  } catch {
    return false;
  }
}

async function readText(relPath) {
  return readFile(path.join(ROOT, relPath), "utf8");
}

function linesOf(text) {
  return text.split(/\r?\n/);
}

function findLineNumbers(text, pattern) {
  const out = [];
  const lines = linesOf(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (pattern instanceof RegExp) {
      if (pattern.test(line)) out.push(i + 1);
    } else if (line.includes(pattern)) {
      out.push(i + 1);
    }
  }
  return out;
}

function firstLine(text, pattern) {
  const hits = findLineNumbers(text, pattern);
  return hits.length ? hits[0] : null;
}

function lineInRange(text, pattern, start, end) {
  const hits = findLineNumbers(text, pattern);
  for (const line of hits) {
    if (line >= start && line <= end) return line;
  }
  return null;
}

function formatEvidence(file, line) {
  return `${file}:${line}`;
}

function makeInvariant(id, title) {
  return {
    id,
    title,
    result: "PASS",
    reasons: [],
    evidence: [],
    warnings: []
  };
}

function fail(inv, reason) {
  inv.result = "FAIL";
  inv.reasons.push(reason);
}

function warn(inv, message) {
  if (!inv.warnings.includes(message)) inv.warnings.push(message);
}

function addEvidence(inv, file, line) {
  if (line == null) return;
  const e = formatEvidence(file, line);
  if (!inv.evidence.includes(e)) inv.evidence.push(e);
}

async function walkFiles(relDir, matcher) {
  const dir = path.join(ROOT, relDir);
  const out = [];
  async function walk(abs, relBase) {
    const entries = await readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(abs, entry.name);
      const relPath = path.join(relBase, entry.name).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        await walk(absPath, relPath);
      } else if (matcher(relPath)) {
        out.push(relPath);
      }
    }
  }
  if (await exists(relDir)) await walk(dir, relDir);
  return out;
}

async function loadExpected() {
  if (!(await exists("scripts/audit-hetzner-packages.expected.json"))) {
    return {
      requiredFiles: [],
      invariants: {
        I1: { forbiddenInDiscoveryHost: [] },
        I5: { forbiddenHttpPatterns: [] }
      }
    };
  }
  const raw = await readText("scripts/audit-hetzner-packages.expected.json");
  return JSON.parse(raw);
}

async function main() {
  const expected = await loadExpected();

  const invariants = [
    makeInvariant("I1", "Discovery advertising-only"),
    makeInvariant("I2", "Concern optimistic intake ack discipline"),
    makeInvariant("I3", "Role/process/corestore isolation"),
    makeInvariant("I4", "Pass boundary safety"),
    makeInvariant("I5", "No parallel protocol"),
    makeInvariant("I6", "z32 discipline")
  ];
  const byId = Object.fromEntries(invariants.map((x) => [x.id, x]));

  const requiredFiles = expected.requiredFiles || [];
  const missing = [];
  for (const rel of requiredFiles) {
    if (!(await exists(rel))) missing.push(rel);
  }
  if (missing.length) {
    for (const inv of invariants) {
      fail(inv, `missing required files: ${missing.join(", ")}`);
    }
  }

  const files = {
    locked: "docs/v0-locked.md",
    protocol: "docs/protocol.md",
    discoveryHost: "packages/hetzner-discovery-host/bin/discovery-host.js",
    concernHost: "packages/hetzner-concern-host/bin/concern-host.js",
    meshCli: "packages/mesh-operator-cli/bin/mesh.js",
    unitDiscovery: "deploy/systemd/mesh-discovery-host.service",
    unitConcern: "deploy/systemd/mesh-concern-host.service",
    install: "deploy/install.sh",
    smoke: "scripts/smoke-hetzner-packages.js",
    discoveryCore: "src/discovery.js",
    concernCore: "src/concern.js",
    applyCore: "src/concern/apply.js",
    replicate: "src/replicateBase.js",
    ensureCorestore: "src/ensureCorestore.js"
  };

  const text = {};
  for (const [key, rel] of Object.entries(files)) {
    text[key] = await readText(rel);
  }

  // I1 Discovery advertising-only
  {
    const inv = byId.I1;
    const forbidden = expected.invariants?.I1?.forbiddenInDiscoveryHost || [];
    for (const token of forbidden) {
      const hits = findLineNumbers(text.discoveryHost, token);
      if (hits.length) {
        fail(inv, `discovery-host contains forbidden token '${token}'`);
        addEvidence(inv, files.discoveryHost, hits[0]);
      }
    }

    const importLine = firstLine(text.discoveryHost, "ensureDiscoverySurface");
    const openLine = firstLine(text.discoveryHost, "ensureDiscoverySurface(corestore.namespace(\"mesh-discovery-host\")");
    const writerLine = firstLine(text.discoveryHost, "await addWriter(discovery, writerZ32)");
    const contractLineA = firstLine(text.locked, "Discovery MUST remain advertising-only");
    const contractLineB = firstLine(text.protocol, "Contract: Discovery only advertises pointers");
    const addConcernLine = firstLine(text.discoveryCore, "async function addConcern(");

    if (!importLine || !openLine) fail(inv, "discovery-host does not clearly open existing discovery surface");
    if (!writerLine) fail(inv, "discovery-host does not use discovery writer admission helper");

    addEvidence(inv, files.discoveryHost, importLine);
    addEvidence(inv, files.discoveryHost, openLine);
    addEvidence(inv, files.discoveryHost, writerLine);
    addEvidence(inv, files.locked, contractLineA);
    addEvidence(inv, files.protocol, contractLineB);
    addEvidence(inv, files.discoveryCore, addConcernLine);
  }

  // I2 Concern optimistic intake + ack discipline
  {
    const inv = byId.I2;
    const jsFiles = [
      ...(await walkFiles("src", (p) => p.endsWith(".js"))),
      ...(await walkFiles("packages", (p) => p.endsWith(".js"))),
      ...(await walkFiles("scripts", (p) => p.endsWith(".js")))
    ].filter((p) => p !== "scripts/audit-hetzner-packages.js");

    const ackHits = [];
    for (const rel of jsFiles) {
      const fileText = await readText(rel);
      const lines = findLineNumbers(fileText, /ackWriter\s*\(/);
      for (const line of lines) ackHits.push({ rel, line });
    }

    const outside = ackHits.filter((h) => h.rel !== files.applyCore);
    if (outside.length) {
      fail(inv, `ackWriter found outside apply path: ${outside.map((x) => `${x.rel}:${x.line}`).join(", ")}`);
    }

    const ackLines = findLineNumbers(text.applyCore, "await host.ackWriter(fromKey);");
    if (ackLines.length < 2) {
      fail(inv, "expected two ackWriter calls in concern/apply for PUB and RAT optimistic branches");
    }

    const pubHelperStart = firstLine(text.applyCore, "async function applyPubValue");
    const ratHelperStart = firstLine(text.applyCore, "async function applyRatValue");
    const loopStart = firstLine(text.applyCore, "for await (const update of updates)");
    const pubAck = lineInRange(
      text.applyCore,
      "await host.ackWriter(fromKey);",
      pubHelperStart || 1,
      (ratHelperStart || 9999) - 1
    );
    const ratAck = lineInRange(
      text.applyCore,
      "await host.ackWriter(fromKey);",
      ratHelperStart || 1,
      (loopStart || 9999) - 1
    );

    const optimisticPubCall = firstLine(text.applyCore, "await applyPubValue(value, fromKey, { ackWriter: true });");
    const optimisticRatCall = firstLine(text.applyCore, "await applyRatValue(value, fromKey, { ackWriter: true });");
    if (!optimisticPubCall || !optimisticRatCall) {
      fail(inv, "optimistic branch does not explicitly call helper with ackWriter:true for PUB/RAT");
    }
    addEvidence(inv, files.applyCore, optimisticPubCall);
    addEvidence(inv, files.applyCore, optimisticRatCall);

    const nonOptimisticPubCall = firstLine(text.applyCore, "await applyPubValue(value, fromKey, { ackWriter: false });");
    const nonOptimisticRatCall = firstLine(text.applyCore, "await applyRatValue(value, fromKey, { ackWriter: false });");
    if (!nonOptimisticPubCall || !nonOptimisticRatCall) {
      fail(inv, "non-optimistic branch missing helper call with ackWriter:false for PUB/RAT");
    }
    addEvidence(inv, files.applyCore, nonOptimisticPubCall);
    addEvidence(inv, files.applyCore, nonOptimisticRatCall);

    const admittedGuards = findLineNumbers(text.applyCore, "if (!(await isAdmittedWriter(fromKey))) break;");
    if (admittedGuards.length < 2) {
      fail(inv, "non-optimistic PUB/RAT must be membership-gated before materialization");
    }
    for (const line of admittedGuards) addEvidence(inv, files.applyCore, line);

    const pubGuards = [
      "if (!fromKey || !ref) return;",
      "if (!job) return;",
      "if (existingAttempt) return;",
      "if (!econResult.ok) return;"
    ];
    for (const guard of pubGuards) {
      const gLine = lineInRange(text.applyCore, guard, pubHelperStart || 1, (ratHelperStart || 9999) - 1);
      if (!gLine || !pubAck || gLine > pubAck) {
        fail(inv, `PUB guard missing or after ack: '${guard}'`);
      }
      addEvidence(inv, files.applyCore, gLine);
    }

    const ratGuards = [
      "if (!jobKey || !organismKey || !attemptToken || !ref) return;",
      "if (!job) return;",
      "if (!attempt) return;",
      "if (existingRatification) return;",
      "if (!econResult.ok) return;"
    ];
    for (const guard of ratGuards) {
      const gLine = lineInRange(text.applyCore, guard, ratHelperStart || 1, (loopStart || 9999) - 1);
      if (!gLine || !ratAck || gLine > ratAck) {
        fail(inv, `RAT guard missing or after ack: '${guard}'`);
      }
      addEvidence(inv, files.applyCore, gLine);
    }

    const concernHostAck = findLineNumbers(text.concernHost, /ackWriter\s*\(/);
    if (concernHostAck.length) {
      fail(inv, "concern-host calls ackWriter directly; expected apply-only acknowledgement");
      addEvidence(inv, files.concernHost, concernHostAck[0]);
    }

    const coreOptimisticLine = firstLine(text.protocol, "Optimistic admission: host.ackWriter is called only inside concern.apply()");
    const constitutionLine = firstLine(text.locked, "Concern MUST run on Autobase with optimistic intake");
    addEvidence(inv, files.protocol, coreOptimisticLine);
    addEvidence(inv, files.locked, constitutionLine);
    addEvidence(inv, files.applyCore, pubAck);
    addEvidence(inv, files.applyCore, ratAck);
  }

  // I3 Role isolation
  {
    const inv = byId.I3;

    const dCorestore = findLineNumbers(text.discoveryHost, "ensureCorestore(");
    const cCorestore = findLineNumbers(text.concernHost, "ensureCorestore(");
    if (dCorestore.length !== 1) fail(inv, `discovery-host corestore init count is ${dCorestore.length}, expected 1`);
    if (cCorestore.length !== 1) fail(inv, `concern-host corestore init count is ${cCorestore.length}, expected 1`);

    const dDir = firstLine(text.discoveryHost, '"/var/lib/mesh/discovery"');
    const cDir = firstLine(text.concernHost, '"/var/lib/mesh/concern"');
    if (!dDir || !cDir) fail(inv, "default corestore dirs for discovery/concern not found");

    const dExec = firstLine(text.unitDiscovery, "ExecStart=");
    const cExec = firstLine(text.unitConcern, "ExecStart=");
    const dExecText = linesOf(text.unitDiscovery)[(dExec || 1) - 1] || "";
    const cExecText = linesOf(text.unitConcern)[(cExec || 1) - 1] || "";
    if (!dExecText.includes("discovery-host.js")) fail(inv, "discovery unit ExecStart does not target discovery-host.js");
    if (!cExecText.includes("concern-host.js")) fail(inv, "concern unit ExecStart does not target concern-host.js");
    if (dExecText === cExecText) fail(inv, "discovery/concern units share identical ExecStart");

    const dUser = firstLine(text.unitDiscovery, "User=mesh");
    const cUser = firstLine(text.unitConcern, "User=mesh");
    const dRestart = firstLine(text.unitDiscovery, "Restart=always");
    const cRestart = firstLine(text.unitConcern, "Restart=always");
    if (!dUser || !cUser) fail(inv, "systemd user=mesh missing from one or both units");
    if (!dRestart || !cRestart) fail(inv, "systemd Restart=always missing from one or both units");

    const wdD = firstLine(text.unitDiscovery, "WorkingDirectory=");
    const wdC = firstLine(text.unitConcern, "WorkingDirectory=");
    const wdDText = linesOf(text.unitDiscovery)[(wdD || 1) - 1] || "";
    const wdCText = linesOf(text.unitConcern)[(wdC || 1) - 1] || "";
    if (wdD && wdC && wdDText === wdCText) {
      warn(inv, "discovery/concern units share WorkingDirectory; acceptable but not strongly isolated at cwd level");
    }

    const installDirs = firstLine(text.install, '"${DATA_DIR}/discovery"');
    const installConcernDir = firstLine(text.install, '"${DATA_DIR}/concern"');
    const enableDiscovery = firstLine(text.install, "systemctl enable --now mesh-discovery-host.service");
    const concernGate = firstLine(text.install, 'if [[ "${ENABLE_CONCERN}" == "1" ]]; then');
    if (!installDirs || !installConcernDir) fail(inv, "install.sh missing separate discovery/concern data directory creation");
    if (!enableDiscovery) fail(inv, "install.sh missing discovery service enable/start");
    if (!concernGate) fail(inv, "install.sh missing ENABLE_CONCERN gate");

    addEvidence(inv, files.discoveryHost, dCorestore[0]);
    addEvidence(inv, files.concernHost, cCorestore[0]);
    addEvidence(inv, files.discoveryHost, dDir);
    addEvidence(inv, files.concernHost, cDir);
    addEvidence(inv, files.unitDiscovery, dExec);
    addEvidence(inv, files.unitConcern, cExec);
    addEvidence(inv, files.install, installDirs);
    addEvidence(inv, files.install, concernGate);
    addEvidence(inv, files.locked, firstLine(text.locked, "Corestore Isolation Rule"));
  }

  // I4 Pass boundary safety
  {
    const inv = byId.I4;

    const suspiciousPatterns = [/globalThis/, /global\./, /passCache/, /crossPass/, /singletonCache/];
    const targets = [
      [files.discoveryHost, text.discoveryHost],
      [files.concernHost, text.concernHost],
      [files.meshCli, text.meshCli],
      [files.smoke, text.smoke]
    ];

    for (const [rel, body] of targets) {
      for (const pat of suspiciousPatterns) {
        const hit = findLineNumbers(body, pat);
        if (hit.length) {
          fail(inv, `suspicious pass-agnostic cache/global pattern '${String(pat)}' in ${rel}`);
          addEvidence(inv, rel, hit[0]);
        }
      }
    }

    const localMapD = firstLine(text.discoveryHost, "const joinedTopics = new Map();");
    const localMapC = firstLine(text.concernHost, "const joinedTopics = new Map();");
    const replMap = firstLine(text.replicate, "if (!base[kHandlers]) base[kHandlers] = new Map();");
    const replCleanup = firstLine(text.replicate, "base.once(\"close\"");

    if (!localMapD || !localMapC) fail(inv, "expected lifecycle-local maps not found in host scripts");
    if (!replMap || !replCleanup) fail(inv, "replicateBase lifecycle cleanup evidence missing");

    addEvidence(inv, files.discoveryHost, localMapD);
    addEvidence(inv, files.concernHost, localMapC);
    addEvidence(inv, files.replicate, replMap);
    addEvidence(inv, files.replicate, replCleanup);
    addEvidence(inv, files.locked, firstLine(text.locked, "Observational pass boundary"));
  }

  // I5 No parallel protocol
  {
    const inv = byId.I5;

    const requiredCliTokens = [
      "ensureDiscoverySurface",
      "addConcern",
      "ensureConcernSurface",
      "createJob",
      "getJobView",
      "getPublishView",
      "getRatView"
    ];

    for (const token of requiredCliTokens) {
      const hit = firstLine(text.meshCli, token);
      if (!hit) fail(inv, `mesh CLI missing expected existing API usage token '${token}'`);
      addEvidence(inv, files.meshCli, hit);
    }

    const forbiddenProtocolTokens = [
      "new Autobase(",
      "new Hyperbee(",
      "valueEncoding:",
      "compact-encoding",
      "OP =",
      "discoveryEncoding",
      "baseEncoding"
    ];
    for (const token of forbiddenProtocolTokens) {
      const hit = firstLine(text.meshCli, token);
      if (hit) {
        fail(inv, `mesh CLI appears to define/own protocol internals via token '${token}'`);
        addEvidence(inv, files.meshCli, hit);
      }
    }

    const httpPatterns = expected.invariants?.I5?.forbiddenHttpPatterns || [];
    const scope = [
      [files.discoveryHost, text.discoveryHost],
      [files.concernHost, text.concernHost],
      [files.meshCli, text.meshCli]
    ];
    for (const [rel, body] of scope) {
      for (const token of httpPatterns) {
        const hit = firstLine(body, token);
        if (hit) {
          fail(inv, `forbidden HTTP/server token '${token}' found in ${rel}`);
          addEvidence(inv, rel, hit);
        }
      }
    }

    addEvidence(inv, files.protocol, firstLine(text.protocol, "Payload per entry"));
    addEvidence(inv, files.protocol, firstLine(text.protocol, "Concern surface"));
  }

  // I6 z32 discipline
  {
    const inv = byId.I6;

    const z32Signals = [
      [files.discoveryHost, "idEncoding.encode("],
      [files.discoveryHost, "idEncoding.decode("],
      [files.concernHost, "idEncoding.encode("],
      [files.concernHost, "idEncoding.decode("],
      [files.meshCli, "idEncoding.encode("],
      [files.meshCli, "idEncoding.decode("]
    ];

    for (const [rel, token] of z32Signals) {
      const body = rel === files.discoveryHost
        ? text.discoveryHost
        : rel === files.concernHost
          ? text.concernHost
          : text.meshCli;
      const hit = firstLine(body, token);
      if (!hit) fail(inv, `${rel} missing z32 key codec token '${token}'`);
      addEvidence(inv, rel, hit);
    }

    const hexDisallowedCheckFiles = [
      [files.discoveryHost, text.discoveryHost],
      [files.concernHost, text.concernHost],
      [files.meshCli, text.meshCli]
    ];

    for (const [rel, body] of hexDisallowedCheckFiles) {
      const hexKeyLog = firstLine(body, /toString\(["']hex["']\)/);
      if (hexKeyLog) {
        fail(inv, `${rel} uses hex string rendering, violates z32 UX discipline`);
        addEvidence(inv, rel, hexKeyLog);
      }

      const hexMentions = findLineNumbers(body, /hex/);
      for (const line of hexMentions) {
        const sourceLine = linesOf(body)[line - 1] || "";
        const seedRelated = sourceLine.includes("SWARM_SEED_HEX") || sourceLine.includes("seed") || sourceLine.includes("hex chars") || sourceLine.includes('"hex"');
        if (!seedRelated) {
          warn(inv, `${rel}:${line} contains 'hex'; verify this is not canonical key UX`);
        }
      }
    }

    addEvidence(inv, files.protocol, firstLine(text.protocol, "Internally keys remain 32-byte buffers; z32 strings are only for UX/logging"));
  }

  const failCount = invariants.filter((x) => x.result === "FAIL").length;
  const overall = failCount > 0 ? "FAIL" : "PASS";

  console.log("Mesh Hetzner Package Static Audit");
  console.log(`Expected profile: ${path.relative(ROOT, EXPECTED_PATH)}`);
  console.log("-");
  for (const inv of invariants) {
    console.log(`${inv.id} ${inv.result} - ${inv.title}`);
    for (const reason of inv.reasons) {
      console.log(`  reason: ${reason}`);
    }
    for (const warning of inv.warnings) {
      console.log(`  warning: ${warning}`);
    }
    if (inv.evidence.length) {
      console.log(`  evidence: ${inv.evidence.join(", ")}`);
    }
  }
  console.log("-");
  console.log(`SUMMARY ${overall} (fails=${failCount}, checks=${invariants.length})`);

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`audit fatal: ${err?.stack || err?.message || String(err)}`);
  process.exit(1);
});
