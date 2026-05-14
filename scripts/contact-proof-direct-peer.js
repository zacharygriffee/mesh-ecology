#!/usr/bin/env node
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { runDirectContactProof } from "../src/contact-proof/direct-peer.js";

function parseArgs(argv) {
  const args = {
    json: false,
    output: null,
    timeoutMs: 10_000
  };
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (part === "--json") args.json = true;
    else if (part === "--output") args.output = argv[++i] || null;
    else if (part === "--timeout-ms") args.timeoutMs = Number.parseInt(argv[++i] || "", 10);
    else if (part === "-h" || part === "--help") args.help = true;
    else throw new Error(`unknown argument: ${part}`);
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 100 || args.timeoutMs > 120_000) {
    throw new Error("--timeout-ms must be an integer from 100 to 120000");
  }
  return args;
}

function usage() {
  return [
    "Usage: node scripts/contact-proof-direct-peer.js [--json] [--output <path>] [--timeout-ms <ms>]",
    "",
    "Runs the narrow Protomux RPC over HyperDHT direct-peer proof lane.",
    "Emits mesh_contact_proof_evidence only; it does not claim distributed readiness."
  ].join("\n");
}

async function main(argv = process.argv.slice(2), stdout = process.stdout, stderr = process.stderr) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    stderr.write(`contact proof argument error: ${error.message}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const evidence = await runDirectContactProof({ timeoutMs: args.timeoutMs });
  const json = `${JSON.stringify(evidence, null, 2)}\n`;

  if (args.output) {
    const outputPath = path.resolve(args.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, json, "utf8");
  }

  if (args.json || !args.output) {
    stdout.write(json);
  } else {
    stdout.write(`mesh contact proof evidence written: ${path.resolve(args.output)}\n`);
    stdout.write(`contactSucceeded=${evidence.contactSucceeded}; distributedReadinessClaimed=${evidence.distributedReadinessClaimed}\n`);
  }

  return evidence.contactSucceeded === true ? 0 : 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { main, parseArgs };
