#!/usr/bin/env node
import { runFourBringup } from "../util/bringup/runner.js";

console.log("Dev bring-up runner skeleton.");
console.log("Provide spawn/adverise/checker functions via a custom script or REPL.");
console.log("This stub does not auto-wire run*.js; see src/util/bringup/runner.js.");

async function main() {
  console.error("No spawn functions provided. Implement your own CLI wrapper.");
  process.exit(1);
}

main();
