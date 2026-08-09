import {
  getAdminExportToken,
  getCaptureConfig,
  getDiscordConfig,
  getRpcUrl,
  getSiteUrl,
} from "../netlify/functions/_shared/config.mjs";

const checks = [
  ["site origin", getSiteUrl],
  ["fixed 200-wallet cap and chain 4663", getCaptureConfig],
  ["Discord OAuth, bot, guild, and role configuration", getDiscordConfig],
  ["Robinhood Chain RPC", getRpcUrl],
  ["protected CSV export token", getAdminExportToken],
];

let failed = false;
for (const [label, check] of checks) {
  try {
    check();
    console.log(`PASS ${label}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${label}: ${error.message}`);
  }
}

if (failed) process.exitCode = 1;
