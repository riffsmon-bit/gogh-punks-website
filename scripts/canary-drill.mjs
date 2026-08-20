import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const allowedArguments = new Set(["--", "--skip-preflight", "--skip-local"]);
const args = process.argv.slice(2);
const unknownArguments = args.filter((argument) => !allowedArguments.has(argument));
const skipPreflight = args.includes("--skip-preflight");
const skipLocal = args.includes("--skip-local");

function usageFailure(message) {
  console.error(`CANARY DRILL: ${message}`);
  console.error(
    "Usage: node scripts/canary-drill.mjs [--skip-preflight | --skip-local]",
  );
  process.exitCode = 2;
}

function runCommand(label, command, commandArgs = []) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, commandArgs, {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`\nCANARY DRILL FAILED: ${label} could not start: ${result.error.message}`);
    return false;
  }
  if (result.signal) {
    console.error(`\nCANARY DRILL FAILED: ${label} stopped by signal ${result.signal}`);
    return false;
  }
  if (result.status !== 0) {
    console.error(`\nCANARY DRILL FAILED: ${label} exited with code ${result.status}`);
    return false;
  }
  return true;
}

if (unknownArguments.length > 0) {
  usageFailure(`unknown argument${unknownArguments.length === 1 ? "" : "s"}: ${unknownArguments.join(", ")}`);
} else if (skipPreflight && skipLocal) {
  usageFailure("refusing a no-op run that skips both preflight and the local rehearsal");
} else {
  console.log("CANARY DRILL START");
  console.log("This runs the live preflight guardrail and local autonomous canary rehearsal.");

  let passed = true;
  if (!skipPreflight) {
    passed = runCommand("Live preflight", process.execPath, [
      resolve(projectRoot, "scripts/canary-preflight.mjs"),
    ]);
  }

  if (passed && !skipLocal) {
    passed = runCommand("Local autonomous canary", "forge", [
      "test",
      "--offline",
      "--match-contract",
      "AutonomousCanaryTest",
      "-vv",
    ]);
  }

  if (!passed) {
    process.exitCode = 1;
  } else {
    console.log("\nCANARY DRILL COMPLETE");
    if (skipPreflight) {
      console.log(
        "Local rehearsal passed. This does not validate a deployment or authorize a live transaction.",
      );
    } else {
      console.log(
        "Live preflight and local rehearsal passed. Continue only with the staged, owner-approved steps in docs/CANARY.md.",
      );
    }
  }
}
