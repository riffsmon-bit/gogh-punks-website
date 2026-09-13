// Native, read-only OpenSea adapter. v1 and its accepted package hashes are untouched.
// Keep these identities inside the versioned implementation digest. A future
// shared configuration edit cannot silently change the skill's payment asset.
const ROBINHOOD = Object.freeze({ chainId: 4663,
  wrappedNativeToken: '0x0bd7d308f8e1639fab988df18a8011f41eacad73' });

const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/i, HASH = /^0x[0-9a-f]{64}$/i;
const UINT = /^(0|[1-9][0-9]{0,77})$/, MAX_UINT = (1n << 256n) - 1n;
const ZERO = `0x${'0'.repeat(40)}`;
const SEAPORT = new Set(['0x0000000000000068f116a894984e2db1123eb395',
  '0x00000000000000adc04c56bf30ac9d3c0aaf14dc']);
const LIMITATIONS = Object.freeze(['BOUNDED_OPENSEA_SAMPLE', 'ERC721_FIXED_PRICE_SINGLE_ITEM_ONLY',
  'CANCELLATION_AND_OWNERSHIP_NOT_CHECKED', 'APPROVAL_AND_SIGNATURE_NOT_CHECKED',
  'OBSERVATION_TIME_IS_SERVER_UTC_NOT_CHAIN_TIME', 'NOT_AN_EXECUTABLE_QUOTE']);
const fail = code => { throw new Error(code); };
function amount(value) {
  // Never String(number): JSON number precision may already have been lost.
  if (typeof value !== 'string' || !UINT.test(value) || BigInt(value) > MAX_UINT) fail('INVALID_EXACT_AMOUNT');
  return BigInt(value);
}
function address(value) {
  if (typeof value !== 'string' || !ADDRESS.test(value)) fail('INVALID_ADDRESS');
  return value.toLowerCase();
}
function listingObservation(value, contract, observedSeconds) {
  if (value?.chain !== 'robinhood') fail('WRONG_CHAIN');
  if (!HASH.test(value.order_hash ?? '')) fail('INVALID_ORDER_ID');
  if (!SEAPORT.has(String(value.protocol_address).toLowerCase())) fail('UNSUPPORTED_PROTOCOL');
  if (value.status !== 'ACTIVE') fail('INACTIVE_ORDER');
  const p = value.protocol_data?.parameters;
  if (!p || !Array.isArray(p.offer) || p.offer.length !== 1) fail('UNSUPPORTED_BUNDLE');
  const nft = p.offer[0];
  if (nft.itemType !== 2) fail('UNSUPPORTED_NFT_TYPE');
  if (address(nft.token) !== contract || address(value.asset?.contract) !== contract) fail('WRONG_NFT_CONTRACT');
  const id = amount(nft.identifierOrCriteria).toString();
  if (amount(value.asset?.identifier).toString() !== id) fail('WRONG_NFT_ID');
  if (amount(nft.startAmount) !== 1n || amount(nft.endAmount) !== 1n) fail('UNSUPPORTED_QUANTITY');
  // OpenSea documents remaining_quantity as an integer. Safe integer 1 is exact;
  // prices, token IDs and protocol uint256 fields must still be decimal strings.
  if (value.remaining_quantity !== 1 && value.remaining_quantity !== '1') fail('INVALID_REMAINING_QUANTITY');
  const start = amount(p.startTime), end = amount(p.endTime);
  if (start >= end || start > observedSeconds || end <= observedSeconds) fail('NOT_ACTIVE_AT_OBSERVATION');
  if (![0, 2].includes(p.orderType)) fail('UNSUPPORTED_ORDER_TYPE');
  address(p.offerer); const zone = address(p.zone);
  if (!Array.isArray(p.consideration) || p.consideration.length < 1 || p.consideration.length > 16
    || p.totalOriginalConsiderationItems !== p.consideration.length) fail('INVALID_CONSIDERATION');
  let currency = null, total = 0n;
  for (const item of p.consideration) {
    const token = address(item.token);
    const symbol = item.itemType === 0 && token === ZERO ? 'ETH'
      : item.itemType === 1 && token === ROBINHOOD.wrappedNativeToken ? 'WETH' : null;
    if (!symbol || (currency && currency.symbol !== symbol)) fail('UNSUPPORTED_OR_MIXED_CURRENCY');
    if (amount(item.identifierOrCriteria) !== 0n) fail('INVALID_PAYMENT_ID');
    address(item.recipient);
    const startAmount = amount(item.startAmount), endAmount = amount(item.endAmount);
    if (startAmount !== endAmount) fail('UNSUPPORTED_DYNAMIC_PRICE');
    total += startAmount;
    if (total > MAX_UINT) fail('INVALID_EXACT_AMOUNT');
    currency = { chainId: ROBINHOOD.chainId, address: token, symbol, decimals: 18,
      kind: symbol === 'ETH' ? 'NATIVE' : 'ERC20' };
  }
  const price = value.price?.current;
  if (amount(price?.value) !== total) fail('PRICE_TOTAL_MISMATCH');
  if (price.decimals !== 18 || price.currency !== currency.symbol) fail('PRICE_CURRENCY_MISMATCH');
  return { orderHash: value.order_hash.toLowerCase(), chainId: ROBINHOOD.chainId,
    protocolAddress: value.protocol_address.toLowerCase(),
    asset: { chainId: ROBINHOOD.chainId, contract, tokenId: id, standard: 'ERC721' },
    quantity: '1', remainingQuantity: '1', paymentToken: currency,
    price: { totalAmount: total.toString(), unitAmount: total.toString(),
      remainingTotalAmount: total.toString(), decimals: 18, currency: currency.symbol,
      basis: 'FIXED_SINGLE_ITEM_CONSIDERATION_SUM', includesListedFees: true, includesGas: false },
    startsAtUnix: start.toString(), expiresAtUnix: end.toString(),
    orderType: p.orderType === 0 ? 'FULL_OPEN' : 'FULL_RESTRICTED',
    zoneRestricted: p.orderType === 2, zoneAddress: zone,
    providerStatus: 'ACTIVE', validity: 'UNVERIFIED_ON_CHAIN', executable: false };
}

async function readJson(response, signal) {
  if (!response.ok) { void response.body?.cancel().catch(() => {}); fail(`OPENSEA_HTTP_${response.status}`); }
  if (!response.headers.get('content-type')?.includes('application/json') || !response.body?.getReader) {
    void response.body?.cancel().catch(() => {}); fail('INVALID_MARKET_RESPONSE');
  }
  const reader = response.body.getReader(), chunks = []; let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) fail('MARKET_TIMEOUT');
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 2_000_000) fail('MARKET_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_MARKET_RESPONSE');
    return value;
  } finally { signal.removeEventListener('abort', cancel); cancel(); }
}

export function createMarketReaderV2({ apiKey, fetchImpl = fetch, now = Date.now,
  timeoutMs = 8_000, callTimeoutMs = 4_000 } = {}) {
  if (typeof apiKey !== 'string' || !apiKey || /[\r\n]/.test(apiKey)) fail('MARKET_CREDENTIAL_REQUIRED');
  if (![timeoutMs, callTimeoutMs].every(n => Number.isSafeInteger(n) && n > 0)
    || timeoutMs > 8_000 || callTimeoutMs > 4_000 || typeof now !== 'function') fail('INVALID_MARKET_BOUNDS');
  return Object.freeze({
    async getListings({ slug, contract, limit = 5, maxPages = 2 } = {}) {
      if (typeof slug !== 'string' || !SLUG.test(slug) || typeof contract !== 'string' || !ADDRESS.test(contract)) fail('INVALID_COLLECTION_IDENTITY');
      if (!Number.isInteger(limit) || limit < 1 || limit > 20
        || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 3) fail('INVALID_LIMIT');
      const expected = contract.toLowerCase(), started = Date.now(), observedAt = now();
      if (!Number.isSafeInteger(observedAt) || observedAt < 0 || observedAt > 8.64e15) fail('INVALID_OBSERVATION_TIME');
      const controller = new AbortController(), seen = new Set(), cursors = new Set();
      const listings = [], excluded = {}; let read = 0, pages = 0, exhausted = false;
      let identityVerified = false, name = null, unavailable = null;
      async function get(path) {
        const remaining = timeoutMs - (Date.now() - started);
        if (remaining <= 0 || controller.signal.aborted) fail('MARKET_TIMEOUT');
        const attempt = new AbortController();
        const signal = AbortSignal.any([controller.signal, attempt.signal]);
        let timer;
        try {
          return await Promise.race([Promise.resolve().then(async () => readJson(await fetchImpl(`https://api.opensea.io${path}`, {
            method: 'GET', redirect: 'error', headers: { accept: 'application/json', 'x-api-key': apiKey }, signal,
          }), signal)), new Promise((_, reject) => { timer = setTimeout(() => {
            attempt.abort(); reject(new Error('MARKET_TIMEOUT'));
          }, Math.min(callTimeoutMs, remaining)); })]);
        } finally { clearTimeout(timer); attempt.abort(); }
      }
      try {
        const collection = await get(`/api/v2/collections/${slug}`);
        if (!Array.isArray(collection.contracts) || !collection.contracts.some(c => c.chain === 'robinhood'
          && typeof c.address === 'string' && c.address.toLowerCase() === expected)) fail('COLLECTION_CHAIN_OR_CONTRACT_MISMATCH');
        identityVerified = true;
        name = typeof collection.name === 'string' ? collection.name.slice(0, 256) : null;
        let cursor = null;
        while (pages < maxPages && listings.length < limit) {
          const page = await get(`/api/v2/listings/collection/${slug}/all?limit=${limit}${cursor ? `&next=${encodeURIComponent(cursor)}` : ''}`);
          if (!Array.isArray(page.listings) || page.listings.length > limit) fail('INVALID_LISTINGS_PAGE');
          if (page.next !== null && page.next !== undefined && (typeof page.next !== 'string'
            || page.next.length > 1_024 || !/^[A-Za-z0-9_+=/.-]+$/.test(page.next))) fail('INVALID_PAGINATION');
          pages++;
          for (const value of page.listings) {
            read++;
            try {
              const normalized = listingObservation(value, expected, BigInt(Math.floor(observedAt / 1000)));
              if (seen.has(normalized.orderHash)) { excluded.DUPLICATE_ORDER = (excluded.DUPLICATE_ORDER ?? 0) + 1; continue; }
              seen.add(normalized.orderHash);
              if (listings.length < limit) listings.push(normalized);
              else excluded.RESULT_LIMIT = (excluded.RESULT_LIMIT ?? 0) + 1;
            } catch (error) {
              // All parsing errors are fixed local codes, never provider bodies or instructions.
              const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'INVALID_LISTING';
              excluded[code] = (excluded[code] ?? 0) + 1;
            }
          }
          if (page.next === null || page.next === undefined) { exhausted = true; break; }
          if (cursors.has(page.next)) fail('PAGINATION_REPEATED');
          cursors.add(page.next); cursor = page.next;
        }
      } catch (error) {
        const message = typeof error?.message === 'string' ? error.message : '';
        unavailable = /^(OPENSEA_HTTP_\d{3}|MARKET_TIMEOUT|MARKET_RESPONSE_TOO_LARGE|INVALID_MARKET_RESPONSE|COLLECTION_CHAIN_OR_CONTRACT_MISMATCH|INVALID_LISTINGS_PAGE|INVALID_PAGINATION|PAGINATION_REPEATED)$/.test(message)
          ? message : 'MARKET_SOURCE_UNAVAILABLE';
      } finally { controller.abort(); }
      const finishedAt = now();
      if (!Number.isSafeInteger(finishedAt) || finishedAt < observedAt || finishedAt > 8.64e15) {
        listings.length = 0; unavailable = 'MARKET_CLOCK_UNAVAILABLE';
      } else {
        // A listing can expire while later pages load. Check again at delivery.
        for (let i = listings.length - 1; i >= 0; i--) {
          if (BigInt(listings[i].expiresAtUnix) <= BigInt(Math.floor(finishedAt / 1000))) {
            listings.splice(i, 1);
            excluded.EXPIRED_DURING_READ = (excluded.EXPIRED_DURING_READ ?? 0) + 1;
          }
        }
      }
      return { schema: 'GOGH_MARKET_LISTING_OBSERVATIONS_V2', slug, chainId: ROBINHOOD.chainId,
        contract: expected, name, identityVerified, observationStartedAt: new Date(observedAt).toISOString(),
        observedAt: new Date(unavailable === 'MARKET_CLOCK_UNAVAILABLE' ? observedAt : finishedAt).toISOString(),
        listings, source: 'OPENSEA_REST', walletAuthority: 'NONE', executable: false,
        coverage: { status: unavailable ? (pages ? 'PARTIAL' : 'UNAVAILABLE') : 'BOUNDED_SAMPLE',
          requestedLimit: limit, maxPages, pagesRead: pages, listingsRead: read,
          supportedCount: listings.length, excluded, providerPaginationExhausted: exhausted,
          collectionFloorVerified: false, collectionFloor: null, unavailable },
        limitations: LIMITATIONS,
        warning: 'Observed listings only. They may be cancelled or unfillable. This sample does not establish a collection floor or authorize a purchase.' };
    },
  });
}
