#!/usr/bin/env node
import { execFileSync } from "child_process";

const PROCESS_DOC_FILES = new Set(["AGENTS.md", "AGENT_PROMPT.md"]);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = args.files.length > 0 ? args.files : stagedFiles();

  if (files.length === 0) {
    console.log("[commit-scope] no staged files");
    return;
  }

  const groups = new Map();
  for (const file of files) {
    const bucket = classify(file);
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(file);
  }

  if (groups.size <= 1) {
    const onlyBucket = groups.keys().next().value;
    console.log(`[commit-scope] ok (${onlyBucket})`);
    return;
  }

  console.error("[commit-scope] blocked: mixed commit scope detected");
  for (const [bucket, bucketFiles] of groups.entries()) {
    console.error(`- ${bucket}`);
    for (const file of bucketFiles) {
      console.error(`  - ${file}`);
    }
  }
  console.error("");
  console.error("Split commits by scope:");
  console.error("1) feature/runtime/test/docs-dev files");
  console.error("2) process docs (AGENTS.md, AGENT_PROMPT.md)");
  console.error("3) docs/libs mechanical rename-only files");
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
  console.log(
    [
      "Usage: node scripts/check-commit-scope.js [--files path1,path2,...]",
      "",
      "Without --files, the script checks currently staged files.",
      "Buckets:",
      "- feature: runtime/tests/packs/docs-dev/other implementation files",
      "- process-docs: AGENTS.md and AGENT_PROMPT.md",
      "- docs-libs: docs/libs/* (keep in mechanical rename-only commits)"
    ].join("\n")
  );
}

function normalizeList(raw) {
  const value = String(raw || "").trim();
  if (!value) return [];
  const out = [];
  for (const part of value.split(",")) {
    const item = String(part || "").trim();
    if (item) out.push(item);
  }
  return out;
}

function stagedFiles() {
  const raw = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACDMRTUXB", "-z"],
    { encoding: "utf8" }
  );
  return raw.split("\u0000").filter(Boolean);
}

function classify(file) {
  if (PROCESS_DOC_FILES.has(file)) return "process-docs";
  if (file.startsWith("docs/libs/")) return "docs-libs";
  return "feature";
}

main();
