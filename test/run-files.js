#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const testDir = resolve(new URL(".", import.meta.url).pathname);
const allFiles = listTests(testDir).sort();
const { selectors, brittleArgs } = parseCliArgs(process.argv.slice(2));
const files = selectFiles(allFiles, selectors);

if (!files.length) {
  if (selectors.length) {
    console.error(`[run-files] no tests matched selectors: ${selectors.join(", ")}`);
    process.exit(1);
  }
  console.error("[run-files] no test files found");
  process.exit(1);
}

const finalBrittleArgs = brittleArgs.includes("--runInBand")
  ? brittleArgs
  : ["--runInBand", ...brittleArgs];

if (envTrue("TEST_RUN_FILES_DEBUG")) {
  console.log(`[run-files] selectors=${JSON.stringify(selectors)}`);
  console.log(`[run-files] brittleArgs=${JSON.stringify(finalBrittleArgs)}`);
  console.log(`[run-files] selected=${JSON.stringify(files)}`);
}

const selectedLabFiles = files.filter((f) => f.startsWith("test/labs/"));
if (envTrue("LAB_CALIBRATE") && selectedLabFiles.length > 5) {
  console.warn(`[run-files] LAB_CALIBRATE=1 with ${selectedLabFiles.length} lab files selected; run may be slow.`);
}

for (const file of files) {
  const res = spawnSync(
    "npx",
    ["brittle", file, ...finalBrittleArgs],
    { stdio: "inherit", env: process.env }
  );
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

function parseCliArgs(args) {
  const selectors = [];
  const brittleArgs = [];
  for (const arg of args) {
    if (!arg || arg === "--") continue;
    if (arg.startsWith("-")) {
      brittleArgs.push(arg);
      continue;
    }
    selectors.push(arg);
  }
  return { selectors, brittleArgs };
}

function selectFiles(allFiles, selectors) {
  if (!selectors.length) return allFiles;
  const chosen = new Set();
  const allSet = new Set(allFiles);

  for (const rawSelector of selectors) {
    const selector = normalizePath(rawSelector);
    if (allSet.has(selector)) {
      chosen.add(selector);
      continue;
    }

    const byDir = allFiles.filter((f) => f.startsWith(`${stripTrailingSlash(selector)}/`));
    if (byDir.length) {
      for (const file of byDir) chosen.add(file);
      continue;
    }

    if (hasGlobSyntax(selector)) {
      const re = globToRegExp(selector);
      for (const file of allFiles) {
        if (re.test(file)) chosen.add(file);
      }
    }
  }

  return Array.from(chosen).sort();
}

function hasGlobSyntax(value) {
  return /[*?\[\]]/.test(value);
}

function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i += 1;
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    out += escapeRegex(ch);
  }
  out += "$";
  return new RegExp(out);
}

function escapeRegex(ch) {
  return ch.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function stripTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function envTrue(name) {
  const v = process.env[name];
  if (!v) return false;
  const n = String(v).trim().toLowerCase();
  return n === "1" || n === "true" || n === "yes" || n === "on";
}

function listTests(dir) {
  const out = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTests(full));
      continue;
    }
    if (entry.name.endsWith(".test.js") && entry.name !== "run-files.js") {
      out.push(relative(process.cwd(), full));
    }
  }
  return out;
}
