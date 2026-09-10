// Public receipt/code reads only. Verification never authorizes deployment,
// adopts a deployment manifest, changes status, or activates production training.
import { readFile, stat } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
import { loadRegistryCanaryInputs, verifyRegistryCanary } from '../broker/src/v4/skill-forge/registry-canary.mjs';
const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== '--live-readonly' || !args[1].startsWith('--proposal=')
  || !/^--transactions=0x[0-9a-f]{64}(,0x[0-9a-f]{64}){7}$/i.test(args[2])) {
  throw Error('Usage: node scripts/verify-forge-registry-canary.mjs --live-readonly --proposal=FILE --transactions=HASH1,...,HASH8 (reads only)');
}
try {
  const path = args[1].slice('--proposal='.length), info = await stat(path);
  if (!info.isFile() || info.size > 1_000_000) throw Error('INVALID_CANARY_PROPOSAL_FILE');
  const packet = JSON.parse(await readFile(path, 'utf8'));
  const client = createPublicClient({ transport: http('https://robinhood-rpc.publicnode.com', { timeout: 12000, retryCount: 0 }), cacheTime: 0 });
  const result = await verifyRegistryCanary({ client, inputs: await loadRegistryCanaryInputs(), proposal: packet.proposal ?? packet,
    transactionHashes: args[2].slice('--transactions='.length).split(',') });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'BLOCKED', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'CANARY_RECEIPT_OR_BUILD_UNVERIFIED',
    broadcastAuthorized: false, productionTrainingAuthorized: false, productionBurnAuthorized: false }));
  process.exitCode = 1;
}
