import { readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

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
  .filter((file) => [".js", ".mjs"].includes(extname(file)))
  .filter((file) => !file.endsWith("/site/reown-wallet-app.js"));

function check(file) {
  return new Promise((resolveResult) => {
    let child;
    try { child = spawn(process.execPath, ["--check", file], { stdio: ["ignore", "ignore", "pipe"] }); }
    catch (error) { resolveResult(`${file}\nUnable to start syntax check: ${error.message}`); return; }
    let stderr = "", spawnError = null;
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", chunk => { stderr += chunk; });
    child.once("error", error => { spawnError = error; });
    // close follows exit/error after stderr has drained, preserving diagnostics.
    child.once("close", (code, signal) => {
      if (!spawnError && code === 0 && signal === null) { resolveResult(null); return; }
      const detail = spawnError ? `Unable to start syntax check: ${spawnError.message}`
        : signal ? `Syntax check terminated by ${signal}` : `Syntax check exited with code ${code}`;
      const diagnostic = spawnError || signal ? [stderr.trim(), detail].filter(Boolean).join("\n") : stderr.trim() || detail;
      resolveResult(`${file}\n${diagnostic}`);
    });
  });
}

// Two children bound CPU/memory use while overlapping Node startup. Retain the
// discovery order for diagnostics even when checks finish in a different order.
const results = new Array(scripts.length);
let next = 0;
async function worker() {
  while (next < scripts.length) {
    const index = next++;
    results[index] = await check(scripts[index]);
  }
}
await Promise.all([worker(), worker()]);
failures.push(...results.filter(result => result !== null));

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(`PASS syntax check for ${scripts.length} JavaScript modules`);
}
