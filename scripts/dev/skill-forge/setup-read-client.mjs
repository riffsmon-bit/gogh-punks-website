import { createPublicClient, custom, http } from 'viem';

const READ_METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber',
  'eth_getBlockByHash', 'eth_getCode', 'eth_call', 'eth_estimateGas', 'eth_gasPrice',
  'eth_getTransactionCount', 'eth_getBalance', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);

function transient(error) {
  for (let current = error, depth = 0; current && depth < 8; current = current.cause, depth++) {
    if (['TimeoutError', 'SocketError'].includes(current.name)
      || [408, 429, 500, 502, 503, 504].includes(current.status)
      || [429, -32005, -32603].includes(current.code)) return true;
    // Robinhood may serve a new header before its state metadata is available.
    if (current.code === -32000 && /metadata is not found|header not found|log query timed out/i.test(current.details ?? current.message ?? '')) return true;
  }
  return false;
}

// Retries repeat only the same provider's read. Never retry a wallet request or
// relax the independent provider, runtime, nonce, balance and simulation checks.
export async function requestSetupRead(request, args, { sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!READ_METHODS.has(args.method)) throw Error('SETUP_RPC_READ_ONLY');
  for (let attempt = 0; ; attempt++) {
    try { return await request(args); }
    catch (error) {
      if (attempt >= 2 || !transient(error)) throw error;
      await sleep(300 * (attempt + 1));
    }
  }
}

export function createSetupReadClient(url) {
  const upstream = http(url, { timeout: 6000, retryCount: 0 })({});
  return createPublicClient({ transport: custom({ request: args => requestSetupRead(upstream.request, args) },
    { retryCount: 0 }), cacheTime: 0 });
}

export async function readSetupAnchor(clients, now = Date.now) {
  const heads = await Promise.all(clients.map(client => client.getBlock()));
  if (heads.length < 2 || heads.some(block => typeof block?.number !== 'bigint'
    || typeof block.timestamp !== 'bigint' || !/^0x[0-9a-f]{64}$/i.test(block.hash ?? ''))) throw Error('LIVE_SETUP_STATE_UNAVAILABLE');
  // A provider may be several blocks ahead of its peer. Use a block both have
  // reached; the caller still verifies its canonical hash and state on each node.
  const anchor = heads.reduce((lower, block) => block.number < lower.number ? block : lower);
  if (Math.abs(now()/1000 - Number(anchor.timestamp)) >= 30) throw Error('LIVE_SETUP_STATE_STALE');
  return anchor;
}
