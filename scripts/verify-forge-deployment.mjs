import { readFile, stat } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
import { loadForgeDeploymentBuild, verifyForgeDeployment, forgeManifestCandidates } from '../broker/src/v4/skill-forge/forge-deployment.mjs';
import { createFinalizedStateClients, finalizedStateEndpoints } from './dev/skill-forge/finalized-state-clients.mjs';

const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== '--live-readonly' || !args[1].startsWith('--plan=')
  || !/^--transactions=0x[0-9a-f]{64},0x[0-9a-f]{64}$/i.test(args[2])) {
  throw Error('Usage: node scripts/verify-forge-deployment.mjs --live-readonly --plan=FILE --transactions=DEPLOY_HASH,ACCEPT_HASH');
}
try {
  const path = args[1].slice('--plan='.length), file = await stat(path);
  if (!file.isFile() || file.size > 500000) throw Error('INVALID_FORGE_DEPLOYMENT_FILE');
  const packet = JSON.parse(await readFile(path, 'utf8')), plan = packet.plan ?? packet.packet?.plan ?? packet;
  const acceptanceReview = packet.acceptanceReview ?? packet.steps?.[1]?.review ?? null;
  const clients = ['https://robinhood-rpc.publicnode.com', 'https://rpc.mainnet.chain.robinhood.com'].map(url =>
    createPublicClient({ transport: http(url, { timeout: 15000, retryCount: 0 }), cacheTime: 0 }));
  const build = await loadForgeDeploymentBuild();
  const evidence = await verifyForgeDeployment({ clients, stateClients: createFinalizedStateClients(), plan, build, acceptanceReview, transactionHashes: args[2].slice('--transactions='.length).split(',') });
  console.log(JSON.stringify({ evidence, manifestCandidates: forgeManifestCandidates({ plan, evidence, build }),
    stateEndpoints: finalizedStateEndpoints, publicTransactions: 0, manifestsWritten: false }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'BLOCKED', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'FORGE_PUBLIC_DEPLOYMENT_UNVERIFIED',
    publicTransactions: 0, manifestsWritten: false })); process.exitCode = 1;
}
