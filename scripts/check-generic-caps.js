#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

const BLOCKED_REPO_NAMESPACES = new Set([
  "edge",
  "platform",
  "translate",
  "bytes"
]);

const LEGACY_ALLOWED_CAPS = new Set([
  "cap/edge/control-panel/hello-status",
  "cap/edge/control-panel/selector-intent",
  "cap/edge/control-panel/yard-lights/set-state"
]);

const SKIP_DIRS = new Set([
  ".git",
  ".codex",
  "node_modules",
  "store",
  "tmp",
  "logs",
  "dist",
  "coverage"
]);

const SKIP_FILES = new Set([
  "package-lock.json"
]);

const DEFAULT_SKIP_PREFIXES = [
  "test/fixtures/generic-cap-guard/"
];

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".json",
  ".md",
  ".txt",
  ".yml",
  ".yaml"
]);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const explicitFiles = args.files.length > 0;
  const files = args.files.length > 0
    ? args.files.map((file) => path.resolve(ROOT, file))
    : collectFiles(ROOT);
  const violations = [];

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    if (!shouldScanFile(file, rel, { explicitFiles })) continue;
    const text = readFileSync(file, "utf8");
    for (const hit of findRepoSpecificCaps(text)) {
      if (LEGACY_ALLOWED_CAPS.has(hit.cap)) continue;
      violations.push({ file: rel, cap: hit.cap, line: lineForOffset(text, hit.index) });
    }
  }

  if (violations.length === 0) {
    console.log("[generic-caps] ok");
    return;
  }

  console.error("[generic-caps] blocked: repo-specific cap namespace introduced");
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} ${violation.cap}`);
  }
  console.error("");
  console.error("Mesh-owned seams should stay generic and concern-local.");
  console.error("Prefer: cap/concern/<intent-family>/v1 plus profile/producer fields.");
  console.error("Examples: cap/concern/call-for-responses/v1, cap/concern/request-review/v1.");
  console.error("If an existing app-specific cap must remain for compatibility, add an explicit legacy allowlist entry with docs explaining why.");
  process.exitCode = 1;
}

function parseArgs(argv) {
  const out = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] || "");
    if (arg === "--files") {
      out.files = normalizeList(argv[++i]);
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown arg: ${arg}`);
  }
  return out;
}

function printHelp() {
  console.log([
    "Usage: node scripts/check-generic-caps.js [--files path1,path2,...]",
    "",
    "Checks that Mesh-owned code/docs do not add new adjacent-repo cap namespaces.",
    "Use generic concern-local caps such as cap/concern/call-for-responses/v1",
    "with producer/profile fields instead of cap/edge/*, cap/platform/*, etc."
  ].join("\n"));
}

function normalizeList(raw) {
  const value = String(raw || "").trim();
  if (!value) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...collectFiles(path.join(dir, entry.name)));
      continue;
    }
    out.push(path.join(dir, entry.name));
  }
  return out;
}

function shouldScanFile(file, rel, { explicitFiles = false } = {}) {
  if (SKIP_FILES.has(rel)) return false;
  if (!explicitFiles && DEFAULT_SKIP_PREFIXES.some((prefix) => rel.startsWith(prefix))) return false;
  const ext = path.extname(file);
  if (!TEXT_EXTENSIONS.has(ext)) return false;
  try {
    return statSync(file).size <= 2_000_000;
  } catch {
    return false;
  }
}

function findRepoSpecificCaps(text) {
  const hits = [];
  const re = /\bcap\/([a-z][a-z0-9_-]*)\/[a-zA-Z0-9._~:/-]+/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const namespace = match[1];
    if (!BLOCKED_REPO_NAMESPACES.has(namespace)) continue;
    hits.push({ cap: match[0], index: match.index });
  }
  return hits;
}

function lineForOffset(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

main();
