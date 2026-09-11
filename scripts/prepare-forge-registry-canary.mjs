// Opt-in PublicNode reads/estimates only. No keys, env loading, signing or sending.
import { createPublicClient, http } from 'viem';
import { loadRegistryCanaryInputs, prepareRegistryCanaryLive } from '../broker/src/v4/skill-forge/registry-canary.mjs';
if (process.argv.length !== 4 || process.argv[2] !== '--live-readonly' || !/^--guardian=0x[0-9a-f]{40}$/i.test(process.argv[3])) {
  throw Error('Usage: node scripts/prepare-forge-registry-canary.mjs --live-readonly --guardian=0xADDRESS (proposal only)');
}
const client = createPublicClient({ transport: http('https://robinhood-rpc.publicnode.com', { timeout: 12000, retryCount: 0 }), cacheTime: 0 });
try {
  const result = await prepareRegistryCanaryLive({ client, inputs: await loadRegistryCanaryInputs(), guardian: process.argv[3].split('=')[1] });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'BLOCKED', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'CANARY_READ_OR_BUILD_FAILED',
    broadcastAuthorized: false, productionTrainingAuthorized: false, productionBurnAuthorized: false }));
  process.exitCode = 1;
}
