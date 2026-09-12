import { build } from "esbuild";
import { writeFile } from 'node:fs/promises';
import trainingRelease from '../deployments/robinhood-forge-training.json' with { type: 'json' };
import { validateTrainingRelease, trainingDeploymentBinding } from '../broker/src/v4/skill-forge/training-release.mjs';

const release = validateTrainingRelease(trainingRelease);
await writeFile('site/forge-training-release.js', `// Generated from the reviewed server release artifact by wallet:build.\nexport const TRAINING_RELEASE = Object.freeze(${JSON.stringify(release,null,2)});\nexport const TRAINING_BINDING = ${release.status === 'OWNER_CANARY' ? `Object.freeze(${JSON.stringify(trainingDeploymentBinding(release))})` : 'null'};\n`);

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
