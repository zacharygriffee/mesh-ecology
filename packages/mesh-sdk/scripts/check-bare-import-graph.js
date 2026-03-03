#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryFile = path.resolve(packageRoot, "src/entry/bare.js");

const FORBIDDEN = new Set([
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

function isForbiddenSpecifier(specifier) {
  if (!specifier) return false;
  if (specifier.startsWith("node:")) return true;
  return FORBIDDEN.has(specifier);
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
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
  if (isRelative) return resolveRelative(fromFile, specifier);
  try {
    return require.resolve(specifier, { paths: [path.dirname(fromFile)] });
  } catch {
    return null;
  }
}

function scanGraph(startFile) {
  const queue = [startFile];
  const visited = new Set();
  const violations = [];

  while (queue.length) {
    const file = queue.shift();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    if (!/\.(?:js|mjs|cjs)$/.test(file)) continue;

    let source = "";
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const specifier of parseStaticSpecifiers(source)) {
      if (isForbiddenSpecifier(specifier)) {
        violations.push({ file, specifier });
        continue;
      }

      const resolved = resolveImport(file, specifier);
      if (!resolved || visited.has(resolved)) continue;
      // Third-party packages can use conditional exports and runtime-specific entrypoints.
      // We guard first-party Bare entry graph here and avoid Node-only false positives from
      // dependency internals resolved under Node's condition set.
      if (resolved.includes(`${path.sep}node_modules${path.sep}`)) continue;
      queue.push(resolved);
    }
  }

  return { visitedCount: visited.size, violations };
}

const { visitedCount, violations } = scanGraph(entryFile);

if (violations.length > 0) {
  console.error("[mesh-sdk] Bare import graph includes forbidden Node builtins:");
  for (const row of violations) {
    console.error(`- ${path.relative(packageRoot, row.file)} -> ${row.specifier}`);
  }
  process.exit(1);
}

console.log(`[mesh-sdk] bare import graph check passed (${visitedCount} files scanned)`);
