#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

const startFiles = [
  path.resolve(packageRoot, "test/bare-runtime.smoke.js"),
  path.resolve(packageRoot, "test/bare-e2e.materialization.test.js")
];

const forbiddenBuiltin = new Set([
  "fs",
  "path",
  "os",
  "net",
  "tls",
  "stream",
  "child_process",
  "worker_threads"
]);

function parseStaticSpecifiers(source) {
  const specs = [];
  const patterns = [
    /(?:^|\n)\s*import\s+[\s\S]*?\sfrom\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*export\s+[\s\S]*?\sfrom\s*["']([^"']+)["']/g,
    /require\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(source))) specs.push(match[1]);
  }
  return specs;
}

function baseBuiltin(specifier) {
  if (!specifier) return null;
  if (specifier.startsWith("node:")) return "node:*";
  const first = specifier.split("/")[0];
  return forbiddenBuiltin.has(first) ? first : null;
}

function resolveRelative(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, "index.js"),
    path.join(base, "index.mjs"),
    path.join(base, "index.cjs")
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    if (!fs.statSync(candidate).isFile()) continue;
    return candidate;
  }
  return null;
}

function resolveImport(fromFile, specifier) {
  if (specifier === "@mesh/mesh-sdk" || specifier === "@mesh/mesh-sdk/bare") {
    return path.resolve(packageRoot, "src/entry/bare.js");
  }
  if (specifier === "@mesh/mesh-sdk/node") {
    return path.resolve(packageRoot, "src/entry/node.js");
  }
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
    return resolveRelative(fromFile, specifier);
  }
  try {
    return require.resolve(specifier, { paths: [path.dirname(fromFile)] });
  } catch {
    return null;
  }
}

function isForbiddenHelperPath(filePath) {
  const normalized = path.resolve(filePath);
  const legacyHelpers = path.resolve(repoRoot, "test/_helpers");
  const legacyLabs = path.resolve(repoRoot, "test/labs");
  return normalized.startsWith(`${legacyHelpers}${path.sep}`) || normalized.startsWith(`${legacyLabs}${path.sep}`);
}

function scanGraph(startPath) {
  const queue = [startPath];
  const visited = new Set();
  const violations = [];

  while (queue.length) {
    const file = queue.shift();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    if (!/\.(?:js|mjs|cjs)$/.test(file)) continue;

    if (isForbiddenHelperPath(file)) {
      violations.push({
        file,
        specifier: "forbidden-test-helper-path",
        detail: "must not import from test/_helpers or test/labs"
      });
      continue;
    }

    let source = "";
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const specifier of parseStaticSpecifiers(source)) {
      const builtin = baseBuiltin(specifier);
      if (builtin) {
        violations.push({ file, specifier, detail: `forbidden builtin: ${builtin}` });
        continue;
      }

      const resolved = resolveImport(file, specifier);
      if (!resolved || visited.has(resolved)) continue;
      if (resolved.includes(`${path.sep}node_modules${path.sep}`)) continue;
      queue.push(resolved);
    }
  }

  return { visitedCount: visited.size, violations };
}

let totalVisited = 0;
const violations = [];

for (const startFile of startFiles) {
  if (!fs.existsSync(startFile)) {
    violations.push({ file: startFile, specifier: "missing-start-file", detail: "required start file is missing" });
    continue;
  }
  const result = scanGraph(startFile);
  totalVisited += result.visitedCount;
  violations.push(...result.violations);
}

if (violations.length > 0) {
  console.error("[mesh-sdk] Bare e2e import graph guard failed:");
  for (const row of violations) {
    console.error(`- ${path.relative(repoRoot, row.file)} -> ${row.specifier} (${row.detail})`);
  }
  process.exit(1);
}

console.log(`[mesh-sdk] bare e2e import graph check passed (${totalVisited} files scanned)`);
