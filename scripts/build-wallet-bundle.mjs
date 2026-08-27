import { build } from "esbuild";

await build({
  entryPoints: ["client/reown-wallet-app.js"],
  outfile: "site/reown-wallet-app.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["safari16.4", "chrome110", "firefox110"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
});
