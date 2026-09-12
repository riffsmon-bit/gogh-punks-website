// Public RPC reads and simulations only. The owner signs the eventual exact
// deployment and registry-acceptance transactions in their own wallet.
import { readFile } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
import { loadForgeDeploymentBuild } from '../broker/src/v4/skill-forge/forge-deployment.mjs';
import { prepareForgeDeployment } from '../broker/src/v4/skill-forge/forge-deployment-preparation.mjs';
import { validateAdministratorSelection } from '../broker/src/v4/skill-forge/registry-administrator-review.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--live-readonly') throw Error('Usage: node scripts/prepare-forge-deployment.mjs --live-readonly');
const endpoints = ['https://robinhood-rpc.publicnode.com', 'https://rpc.mainnet.chain.robinhood.com'];
const clients = endpoints.map(url => createPublicClient({ transport: http(url, { timeout: 15000, retryCount: 0 }), cacheTime: 0 }));
let phase = 'BUILD';
try {
  const build = await loadForgeDeploymentBuild();
  const selection = JSON.parse(await readFile(new URL('../ops/forge-registry-admin-selection.json', import.meta.url), 'utf8'));
  const { administrator } = validateAdministratorSelection(selection);
  const packet = await prepareForgeDeployment({ clients, build, administrator, endpoints });
  console.log(JSON.stringify(packet, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'BLOCKED', phase: error.forgePhase ?? phase, code: /^[A-Z_]+$/.test(error.message) ? error.message : 'FORGE_DEPLOYMENT_READ_OR_SIMULATION_FAILED',
    errorType: error.name, rpcDetail: typeof error.details === 'string' ? error.details.slice(0, 300) : null,
    publicTransactions: 0, productionTrainingAuthorized: false, productionBurnAuthorized: false }));
  process.exitCode = 1;
}
