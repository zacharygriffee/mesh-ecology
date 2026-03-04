#!/usr/bin/env node
import { labName as labAName, runLab as runLabA } from "./lab-a.sdk-hashport.test.js";
import { labName as labBName, runLab as runLabB } from "./lab-b.pump-loop.test.js";
import { labName as labCName, runLab as runLabC } from "./lab-c.materialization.test.js";
import { labName as labDName, runLab as runLabD } from "./lab-d.negative-wait.test.js";
import { labName as labEName, runLab as runLabE } from "./lab-e.reopen-stability.test.js";

const labs = [
  { name: labAName, run: runLabA },
  { name: labBName, run: runLabB },
  { name: labCName, run: runLabC },
  { name: labDName, run: runLabD },
  { name: labEName, run: runLabE }
];

let failed = 0;

for (const lab of labs) {
  try {
    await lab.run();
    console.log(`[bare-labs] ok ${lab.name}`);
  } catch (err) {
    failed += 1;
    const message = err?.stack || err?.message || String(err);
    console.error(`[bare-labs] fail ${lab.name}`);
    console.error(message);
  }
}

if (failed > 0) {
  console.error(`[bare-labs] failed ${failed}/${labs.length}`);
  const bareExit = globalThis.Bare?.exit;
  if (typeof bareExit === "function") bareExit(1);
  throw new Error(`[bare-labs] failed ${failed}/${labs.length}`);
}

console.log(`[bare-labs] passed ${labs.length}/${labs.length}`);
