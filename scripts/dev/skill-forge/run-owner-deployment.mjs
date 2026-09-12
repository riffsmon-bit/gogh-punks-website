import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
import { loadForgeDeploymentBuild } from '../../../broker/src/v4/skill-forge/forge-deployment.mjs';
import { validateAdministratorSelection } from '../../../broker/src/v4/skill-forge/registry-administrator-review.mjs';
import { openOwnerDeploymentSession } from './owner-deployment-session.mjs';
import { startOwnerDeploymentServer } from './owner-deployment-server.mjs';
import { createLiveBurnPairClients } from '../../../broker/src/v4/skill-forge/live-burn-pair.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--live-owner-wallet') throw Error('Requires --live-owner-wallet; only your browser wallet can send transactions');
const build = await loadForgeDeploymentBuild();
const selection = JSON.parse(await readFile(new URL('../../../ops/forge-registry-admin-selection.json', import.meta.url), 'utf8'));
const { administrator } = validateAdministratorSelection(selection);
const burnTestSelection = JSON.parse(await readFile(new URL('../../../ops/forge-burn-test-selection.json', import.meta.url), 'utf8'));
const endpoints = ['https://robinhood-rpc.publicnode.com', 'https://rpc.mainnet.chain.robinhood.com'];
const clients = endpoints.map(url => createPublicClient({ transport: http(url, { timeout: 15000, retryCount: 0 }), cacheTime: 0 }));
const journal = join(homedir(), '.gogh-punks', 'forge-deployment.sqlite');
const session = openOwnerDeploymentSession({ path: journal, build, administrator, clients, endpoints });
const server = await startOwnerDeploymentServer({ session, build, administrator, client: clients[0],
  clients: createLiveBurnPairClients(), burnTestSelection });
console.log(JSON.stringify({ url: server.url, network: 'LIVE_ROBINHOOD_4663', administrator, journal,
  actions: ['DEPLOY_PAUSED_FORGE', 'ACCEPT_REGISTRY_OWNERSHIP'], serverHasSigner: false, burnButton: false }));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); session.close(); process.exit(0); });
