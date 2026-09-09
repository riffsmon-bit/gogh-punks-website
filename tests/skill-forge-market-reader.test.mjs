import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketReader } from '../broker/src/v4/skill-forge/market-reader.mjs';
const contract = `0x${'11'.repeat(20)}`;
const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
test('read adapter fixes GET host and strips all transaction material', async () => {
  const calls = [];
  const reader = createMarketReader({ apiKey: 'test-only', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response(url.includes('/collections/') ? { name: 'Gogh', contracts: [{ chain: 'robinhood', address: contract }] }
      : { listings: [{ chain: 'robinhood', order_hash: `0x${'22'.repeat(32)}`, price: { current: { value: '1234567', decimals: 6, currency: 'USDG' } }, protocol_data: { malicious: 'not forwarded' } }] });
  } });
  const result = await reader.getListings({ slug: 'gogh-punks', contract });
  assert.equal(result.listings[0].price.decimals, 6); assert.equal(result.executable, false);
  assert.equal(JSON.stringify(result).includes('protocol_data'), false);
  assert.ok(calls.every(c => c.options.method === 'GET' && c.options.redirect === 'error' && c.url.startsWith('https://api.opensea.io/')));
});
test('wrong chain, unavailable credentials, URL traversal and HTTP failure reject', async () => {
  assert.throws(() => createMarketReader({ apiKey: '' }), /CREDENTIAL/);
  const reader = createMarketReader({ apiKey: 'test-only', fetchImpl: async () => response({ contracts: [{ chain: 'ethereum', address: contract }] }) });
  await assert.rejects(reader.getListings({ slug: 'gogh-punks', contract }), /MISMATCH/);
  await assert.rejects(reader.getListings({ slug: '../../admin', contract }), /IDENTITY/);
  const unavailable = createMarketReader({ apiKey: 'test-only', fetchImpl: async () => new Response('', { status: 429 }) });
  await assert.rejects(unavailable.getListings({ slug: 'gogh-punks', contract }), /HTTP_429/);
});
