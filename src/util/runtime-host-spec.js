import path from "path";
import idEncoding from "hypercore-id-encoding";
import { defaultTopics } from "./createKeyPair.js";

const SPEC_VERSION = 1;
const DEFAULT_TOPIC_Z32 = idEncoding.encode(defaultTopics(1)[0]);

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function normalizeAbsLikePath(value, fallback) {
  const raw = String(value || fallback || "").trim();
  if (!raw) throw new Error("path value is required");
  return raw.startsWith("/") ? raw : `/${raw.replace(/^\/+/, "")}`;
}

function toList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
  return String(value)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function toBool(value) {
  if (value == null || value === "") return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizePaths(raw = {}) {
  return {
    configDir: normalizeAbsLikePath(raw.configDir, "/etc/mesh"),
    dataDir: normalizeAbsLikePath(raw.dataDir, "/var/lib/mesh"),
    systemdDir: normalizeAbsLikePath(raw.systemdDir, "/etc/systemd/system")
  };
}

function normalizeDiscoveryHost(raw, paths) {
  const section = asObject(raw, "discoveryHost");
  const config = asObject(section.config || section, "discoveryHost.config");
  const out = {
    configPath: path.posix.join(paths.configDir, "discovery-host.json"),
    unitPath: path.posix.join(paths.systemdDir, "mesh-discovery-host.service"),
    config: {
      corestoreDir: normalizeAbsLikePath(config.corestoreDir, path.posix.join(paths.dataDir, "discovery")),
      discoveryKey: String(config.discoveryKey || "").trim() || null,
      discoveryCreate: toBool(config.discoveryCreate),
      swarmTopics: toList(config.swarmTopics).length ? toList(config.swarmTopics) : [DEFAULT_TOPIC_Z32],
      swarmBootstrap: toList(config.swarmBootstrap),
      swarmSeedHex: String(config.swarmSeedHex || "").trim() || null,
      discoveryWriters: toList(config.discoveryWriters),
      updateIntervalMs: toPositiveInt(config.updateIntervalMs, 1500),
      heartbeatMs: toPositiveInt(config.heartbeatMs, 30000)
    }
  };

  if (!out.config.discoveryKey && !out.config.discoveryCreate) {
    throw new Error("discoveryHost requires discoveryKey or discoveryCreate=true");
  }

  return out;
}

function normalizeConcernHost(raw, paths) {
  const section = asObject(raw, "concernHost");
  const config = asObject(section.config || section, "concernHost.config");
  const concernKeys = toList(config.concernKeys);
  if (concernKeys.length === 0) {
    throw new Error("concernHost requires at least one concernKeys entry");
  }

  return {
    configPath: path.posix.join(paths.configDir, "concern-host.json"),
    unitPath: path.posix.join(paths.systemdDir, "mesh-concern-host.service"),
    config: {
      corestoreDir: normalizeAbsLikePath(config.corestoreDir, path.posix.join(paths.dataDir, "concern")),
      concernKeys,
      swarmTopics: toList(config.swarmTopics).length ? toList(config.swarmTopics) : [DEFAULT_TOPIC_Z32],
      swarmBootstrap: toList(config.swarmBootstrap),
      swarmSeedHex: String(config.swarmSeedHex || "").trim() || null,
      concernWriters: toList(config.concernWriters),
      validation: toPositiveInt(config.validation, 1),
      updateIntervalMs: toPositiveInt(config.updateIntervalMs, 1500),
      heartbeatMs: toPositiveInt(config.heartbeatMs, 30000)
    }
  };
}

function normalizeRuntimeHostSpec(raw = {}, options = {}) {
  const spec = asObject(raw, "spec");
  const version = Number(spec.version || SPEC_VERSION);
  if (version !== SPEC_VERSION) throw new Error(`unsupported runtime host spec version: ${version}`);

  const paths = normalizePaths(spec.paths || {});
  const repoRoot = path.resolve(String(options.repoRoot || spec.repoRoot || process.cwd()));

  return {
    version,
    repoRoot,
    paths,
    discoveryHost: spec.discoveryHost ? normalizeDiscoveryHost(spec.discoveryHost, paths) : null,
    concernHost: spec.concernHost ? normalizeConcernHost(spec.concernHost, paths) : null
  };
}

function resolveInstallPath(rootDir, absLikePath) {
  return path.join(path.resolve(rootDir || "/"), String(absLikePath || "").replace(/^\/+/, ""));
}

export {
  SPEC_VERSION,
  DEFAULT_TOPIC_Z32,
  normalizeRuntimeHostSpec,
  resolveInstallPath
};
