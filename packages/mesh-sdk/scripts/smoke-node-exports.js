#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(packageRoot, "package.json");
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const packageName = String(pkg.name || "").trim();

if (!packageName) throw new Error("package.json name is required");

const mainMod = await import(packageName);
const nodeMod = await import(`${packageName}/node`);

if (typeof mainMod.createMeshClient !== "function") {
  throw new Error(`Missing createMeshClient export from ${packageName}`);
}
if (typeof nodeMod.createMeshClient !== "function") {
  throw new Error(`Missing createMeshClient export from ${packageName}/node`);
}
if (mainMod.createMeshClient !== nodeMod.createMeshClient) {
  throw new Error(`${packageName} and ${packageName}/node must resolve to the same Node entry`);
}
if (typeof mainMod.asHashPort !== "function" || typeof nodeMod.asHashPort !== "function") {
  throw new Error(`Missing asHashPort export from ${packageName} and/or ${packageName}/node`);
}
if (typeof mainMod.assertHashPort !== "function" || typeof nodeMod.assertHashPort !== "function") {
  throw new Error(`Missing assertHashPort export from ${packageName} and/or ${packageName}/node`);
}
if (typeof mainMod.createHashPortBlake2b256 !== "function" || typeof nodeMod.createHashPortBlake2b256 !== "function") {
  throw new Error(`Missing createHashPortBlake2b256 export from ${packageName} and/or ${packageName}/node`);
}
if (mainMod.asHashPort !== nodeMod.asHashPort || mainMod.assertHashPort !== nodeMod.assertHashPort) {
  throw new Error(`${packageName} and ${packageName}/node must resolve to the same HashPort helpers`);
}
if (mainMod.createHashPortBlake2b256 !== nodeMod.createHashPortBlake2b256) {
  throw new Error(`${packageName} and ${packageName}/node must resolve to the same HashPort factory`);
}

console.log(`[mesh-sdk] node exports smoke passed for ${packageName} and ${packageName}/node`);
