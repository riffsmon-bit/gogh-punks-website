import { constants, open } from "node:fs/promises";

import { buildReviewedFreeMintRunPlan } from "../broker/src/recommendation/reviewed-free-mint-run-plan.mjs";

function fail(message) { throw new TypeError(message); }

function parseArgs(argv) {
  if (argv.length !== 4 || argv[0] !== "--queue" || argv[2] !== "--live-state") {
    fail("usage: --queue FILE --live-state FILE");
  }
  if (!argv[1] || !argv[3] || argv[1] === argv[3]) fail("two distinct input files are required");
  return { queuePath: argv[1], liveStatePath: argv[3] };
}

async function readJson(path, label) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size <= 0n || before.size > 1_000_000n) fail(`${label} must be a bounded regular file`);
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || bytes.length !== Number(before.size)) {
      fail(`${label} changed while being read`);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { await handle.close(); }
}

try {
  const args = parseArgs(process.argv.slice(2));
  const [queue, liveState] = await Promise.all([
    readJson(args.queuePath, "queue"), readJson(args.liveStatePath, "live state"),
  ]);
  const result = buildReviewedFreeMintRunPlan(queue, liveState, { nowSeconds: Math.floor(Date.now() / 1000) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`REVIEWED_RUN_PLAN_FAIL [${error?.code ?? "INVALID_INPUT"}]\n`);
  process.exitCode = 1;
}
