// Contract reads do not need wallet permission. Keep them on the pinned public
// chain endpoint instead of depending on an extension's cache or RPC filters.
// This transport cannot connect accounts, sign, or submit a transaction.
const ENDPOINT = 'https://rpc.mainnet.chain.robinhood.com';
const METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call',
  'eth_getBalance', 'eth_gasPrice', 'eth_estimateGas', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
const failure = timeout => Object.assign(Error('The public chain check is unavailable.'), {
  code: timeout ? 'SWARM_WALLET_READ_TIMEOUT' : 'SWARM_WALLET_READ_UNAVAILABLE',
});

export function createSwarmWalletReadProvider({ fetcher = globalThis.fetch, timeoutMs = 6000 } = {}) {
  let requestId = 0;
  return Object.freeze({ async request({ method, params = [] }) {
    if (!METHODS.has(method) || !Array.isArray(params) || typeof fetcher !== 'function') throw failure(false);
    const controller = new AbortController(), id = ++requestId;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), credentials: 'omit', cache: 'no-store',
        redirect: 'error', signal: controller.signal });
      if (!response.ok) throw failure(false);
      const text = await response.text(); if (text.length > 2_000_000) throw failure(false);
      const payload = JSON.parse(text);
      if (payload?.jsonrpc !== '2.0' || payload.id !== id || payload.error || !Object.hasOwn(payload, 'result')) throw failure(false);
      return payload.result;
    } catch { throw failure(controller.signal.aborted); }
    finally { clearTimeout(timer); }
  } });
}
