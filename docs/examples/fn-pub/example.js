import crypto from "crypto";

export default async function run(ctx) {
  let firstJob = null;
  for await (const job of ctx.jobs()) {
    if (!job?.key) continue;
    firstJob = job;
    break;
  }

  if (!firstJob) return null;

  const attempt = crypto
    .createHash("sha256")
    .update(firstJob.key)
    .update("docs/examples/fn-pub")
    .digest()
    .subarray(0, 32);

  return {
    jobKey: firstJob.key,
    cap: "cap/example/fn-pub/v1",
    ref: {
      t: "result",
      k: firstJob.key,
      a: attempt
    },
    meta: {
      schema: "mesh/example/fn-pub/v1",
      outUri: `file://fn-pub/${attempt.toString("hex")}`
    }
  };
}
