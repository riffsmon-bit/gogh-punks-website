import { build } from "esbuild";
import { writeFile } from 'node:fs/promises';
import trainingRelease from '../deployments/robinhood-forge-training.json' with { type: 'json' };
import { validateTrainingRelease, trainingDeploymentBinding } from '../broker/src/v4/skill-forge/training-release.mjs';
import paidRelease from '../deployments/robinhood-directed-paid-mint.json' with {type:'json'};

const release = validateTrainingRelease(trainingRelease);
await writeFile('site/directed-paid-release.js',`// Generated from the reviewed server release artifact by wallet:build.\nexport const PAID_RELEASE = Object.freeze(${JSON.stringify(paidRelease,null,2)});\n`);
await writeFile('site/forge-training-release.js', `// Generated from the reviewed server release artifact by wallet:build.\nexport const TRAINING_RELEASE = Object.freeze(${JSON.stringify(release,null,2)});\nexport const TRAINING_BINDING = ${release.status === 'OWNER_CANARY' ? `Object.freeze(${JSON.stringify(trainingDeploymentBinding(release))})` : 'null'};\n`);

await build({
  entryPoints: ['client/marketplace-wallet-codec.js'],
  outfile: 'site/marketplace-wallet-codec.js', bundle: true, format: 'esm', platform: 'browser',
  target: ['safari16.4', 'chrome110', 'firefox110'], minify: true, sourcemap: false, legalComments: 'none',
});

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
