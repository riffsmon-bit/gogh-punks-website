#!/usr/bin/env node
import { checkV2ExecutionReadiness } from "../broker/src/v4/execution-readiness.mjs";

if (process.argv.length !== 3 || process.argv[2] !== "--read-only") {
  process.stderr.write("Requires exactly --read-only; checks selected paid history access only.\n");
  process.exitCode = 2;
} else {
  const result = await checkV2ExecutionReadiness();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "READY" ? 0 : 1;
}
