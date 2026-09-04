import { execFileSync } from "node:child_process";

let databaseUrl;
try {
  databaseUrl = execFileSync("npx", ["netlify", "env:get", "SUPABASE_DATABASE_URL",
    "--context", "production", "--scope", "functions"], {
    cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  throw new Error("The production Supabase Functions variable could not be read.");
}
if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
  throw new Error("The production Supabase Functions variable is unavailable.");
}
execFileSync(process.execPath, [
  "scripts/test-v1-retirement-postgres-integration.mjs", "--production-rollback",
], {
  cwd: process.cwd(),
  env: { ...process.env, SUPABASE_DATABASE_URL: databaseUrl },
  stdio: ["ignore", "inherit", "inherit"],
});
