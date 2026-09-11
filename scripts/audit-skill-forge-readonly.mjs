// Opt-in, read-only acceptance probe. No signer, credential loading or transactions.
import { createPublicClient, http } from 'viem';
import { inspectContract, retrieveInlineMetadata, rankTraitSample } from '../broker/src/v4/skill-forge/research-tools.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--live-readonly') {
  console.error('Usage: node scripts/audit-skill-forge-readonly.mjs --live-readonly');
  process.exitCode = 2;
} else {
  const client = createPublicClient({ transport: http('https://robinhood-rpc.publicnode.com', { timeout: 12_000, retryCount: 1 }) });
  const contract = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6';
  const evidence = { observedAt: new Date().toISOString(), walletAuthority: 'NONE', productionReady: false };
  try {
    evidence.contract = await inspectContract({ client, contract });
    evidence.metadata = await retrieveInlineMetadata({ client, contract, tokenIds: ['93', '94', '95'] });
    evidence.sampleRanking = rankTraitSample(evidence.metadata.tokens, { numericMode: 'categorical' });
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    // Do not dump RPC request bodies or any provider credentials on failure.
    console.error(JSON.stringify({ status: 'BLOCKED', reason: error.shortMessage ?? error.message,
      productionReady: false, walletAuthority: 'NONE' }));
    process.exitCode = 1;
  }
}
