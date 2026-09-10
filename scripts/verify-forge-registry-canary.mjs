// Public receipt/code reads only. Verification never authorizes deployment,
// adopts a deployment manifest, changes status, or activates production training.
import { readFile, stat } from 'node:fs/promises';
import { createPublicClient, http } from 'viem';
import { loadRegistryCanaryInputs, verifyRegistryCanary } from '../broker/src/v4/skill-forge/registry-canary.mjs';
import { validateRegistryFeeReview, assertRegistryTransactionFeeLimits } from '../broker/src/v4/skill-forge/registry-administrator-review.mjs';
const args = process.argv.slice(2);
if (![3, 4].includes(args.length) || args[0] !== '--live-readonly' || !args[1].startsWith('--proposal=')
  || !/^--transactions=0x[0-9a-f]{64}(,0x[0-9a-f]{64}){7}$/i.test(args[2]) || args[3] && !args[3].startsWith('--fee-review=')) {
  throw Error('Usage: node scripts/verify-forge-registry-canary.mjs --live-readonly --proposal=FILE --transactions=HASH1,...,HASH8 [--fee-review=FILE] (reads only)');
}
async function jsonFile(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size > 1_000_000) throw Error('INVALID_CANARY_PROPOSAL_FILE');
  return JSON.parse(await readFile(path, 'utf8'));
}
try {
  const packet = await jsonFile(args[1].slice('--proposal='.length));
  const proposal = packet.proposal ?? packet, inputs = await loadRegistryCanaryInputs();
  const client = createPublicClient({ transport: http('https://robinhood-rpc.publicnode.com', { timeout: 12000, retryCount: 0 }), cacheTime: 0 });
  const result = await verifyRegistryCanary({ client, inputs, proposal,
    transactionHashes: args[2].slice('--transactions='.length).split(',') });
  result.feeLimitsVerified = false;
  if (args[3]) {
    const feePacket = await jsonFile(args[3].slice('--fee-review='.length)), feeReview = feePacket.feeReview ?? feePacket;
    const selection = await jsonFile(new URL('../ops/forge-registry-admin-selection.json', import.meta.url));
    validateRegistryFeeReview({ inputs, proposal, selection, feeReview });
    for (const [i, hash] of result.transactionHashes.entries()) assertRegistryTransactionFeeLimits(await client.getTransaction({ hash }), feeReview.steps[i]);
    result.feeLimitsVerified = true; result.feeReviewHash = feeReview.reviewHash;
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'BLOCKED', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'CANARY_RECEIPT_OR_BUILD_UNVERIFIED',
    broadcastAuthorized: false, productionTrainingAuthorized: false, productionBurnAuthorized: false }));
  process.exitCode = 1;
}
