import { execFileSync } from "node:child_process";

function productionDatabaseUrl() {
  let value;
  try {
    value = execFileSync("npx", ["netlify", "env:get", "SUPABASE_DATABASE_URL",
      "--context", "production", "--scope", "functions"], {
      cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error("The production Supabase Functions variable could not be read.");
  }
  if (!/^postgres(?:ql)?:\/\//.test(value)) {
    throw new Error("The production Supabase Functions variable is unavailable.");
  }
  return value;
}

const environment = { ...process.env, SUPABASE_DATABASE_URL: productionDatabaseUrl() };
execFileSync(process.execPath, ["scripts/apply-supabase-operational-migration.mjs", "--apply",
  ...process.argv.slice(2)], {
  cwd: process.cwd(), env: environment, stdio: ["ignore", "inherit", "inherit"],
});
