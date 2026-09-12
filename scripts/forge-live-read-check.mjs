// Hosted, read-only acceptance check. Secrets stay in Netlify; logs contain counts only.
import { createPublicClient, http } from 'viem';
import { inspectContract, retrieveInlineMetadata, rankTraitSample } from '../broker/src/v4/skill-forge/research-tools.mjs';
import { createMarketReader } from '../broker/src/v4/skill-forge/market-reader.mjs';
if (!process.env.GOGH_FORGE_TEST_OWNER) {
  console.log('FORGE_LIVE_READ_CHECK_SKIPPED: canary owner not configured');
} else {
  const contract = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6';
  const client = createPublicClient({ transport: http('https://robinhood-rpc.publicnode.com', { timeout: 8000, retryCount: 1 }) });
  try {
    const inspected = await inspectContract({ client, contract });
    console.log(`FORGE_LIVE_CONTRACT_PASS: block=${inspected.blockNumber}, bytes=${inspected.codeBytes}, authority=NONE`);
    const metadata = await retrieveInlineMetadata({ client, contract, tokenIds: ['93', '94', '95'] });
    const ranked = rankTraitSample(metadata.tokens, { numericMode: 'categorical' });
    console.log(`FORGE_LIVE_RARITY_PASS: sample=${ranked.sampleSize}, scope=SAMPLE_ONLY, authority=NONE`);
    const market = await createMarketReader({ apiKey: process.env.OPENSEA_API_KEY }).getListings({
      slug: 'gogh-punks-255843210', contract, limit: 5 });
    console.log(`FORGE_LIVE_MARKET_PASS: listings=${market.listings.length}, chain=${market.chainId}, authority=NONE`);
  } catch (error) {
    // Never log request headers, secret values or raw provider error objects.
    const message = String(error?.message ?? 'UNKNOWN');
    console.error(`FORGE_LIVE_READ_CHECK_FAILED: ${/^[A-Z_0-9]+$/.test(message) ? message : 'PROVIDER_READ_UNAVAILABLE'}`);
    process.exitCode = 1;
  }
}
