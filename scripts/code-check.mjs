import { readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["broker", "netlify/functions", "scripts", "site", "tests"];
const failures = [];

function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const target = join(path, entry.name);
    if (entry.isDirectory()) return files(target);
    return [target];
  });
}

const scripts = roots
  .flatMap((root) => files(resolve(process.cwd(), root)))
  .filter((file) => [".js", ".mjs"].includes(extname(file)));

for (const file of scripts) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) failures.push(`${file}\n${result.stderr.trim()}`);
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(`PASS syntax check for ${scripts.length} JavaScript modules`);
}
