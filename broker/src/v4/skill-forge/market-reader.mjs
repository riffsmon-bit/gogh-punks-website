// Fresh implementation against documented OpenSea REST endpoints. No imported signer.
// The approved source is fixed; neither prompts nor callers can select a URL or HTTP method.
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
async function json(response) {
  if (!response.ok) throw new Error(`OPENSEA_HTTP_${response.status}`);
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('INVALID_MARKET_RESPONSE');
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length; if (length > 2_000_000) throw new Error('MARKET_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createMarketReader({ apiKey, fetchImpl = fetch }) {
  if (typeof apiKey !== 'string' || !apiKey || /[\r\n]/.test(apiKey)) throw new Error('MARKET_CREDENTIAL_REQUIRED');
  async function get(path) {
    return json(await fetchImpl(`https://api.opensea.io${path}`, { method: 'GET', redirect: 'error',
      headers: { accept: 'application/json', 'x-api-key': apiKey }, signal: AbortSignal.timeout(10_000) }));
  }
  async function collection(slug, expectedContract) {
    if (!SLUG.test(slug) || !ADDRESS.test(expectedContract)) throw new Error('INVALID_COLLECTION_IDENTITY');
    const result = await get(`/api/v2/collections/${slug}`);
    if (!Array.isArray(result.contracts) || !result.contracts.some(c => c.chain === 'robinhood'
      && String(c.address).toLowerCase() === expectedContract.toLowerCase())) throw new Error('COLLECTION_CHAIN_OR_CONTRACT_MISMATCH');
    return { slug, chainId: 4663, contract: expectedContract.toLowerCase(), name: String(result.name ?? '').slice(0, 256) };
  }
  return Object.freeze({
    async getListings({ slug, contract, limit = 5 }) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('INVALID_LIMIT');
      const identity = await collection(slug, contract);
      const result = await get(`/api/v2/listings/collection/${slug}/all?limit=${limit}`);
      if (!Array.isArray(result.listings)) throw new Error('INVALID_LISTINGS');
      const listings = result.listings.filter(l => l.chain === 'robinhood').slice(0, limit).map(l => {
        // Deliberately discard protocol_data/calldata/signing actions from the provider.
        const price = l.price?.current;
        if (!price || !/^(0|[1-9][0-9]{0,77})$/.test(String(price.value))
          || !Number.isInteger(price.decimals) || price.decimals < 0 || price.decimals > 36
          || !/^0x[0-9a-f]{64}$/i.test(l.order_hash ?? '')) throw new Error('INVALID_LISTING_PRICE_OR_ID');
        return { orderHash: l.order_hash, price: { value: String(price.value), decimals: price.decimals,
          currency: String(price.currency ?? '').slice(0, 32) }, chainId: 4663 };
      });
      return { ...identity, observedAt: new Date().toISOString(), listings, source: 'OPENSEA_REST',
        walletAuthority: 'NONE', executable: false, warning: 'Listing data is not executable authorization or a guaranteed floor.' };
    },
  });
}
