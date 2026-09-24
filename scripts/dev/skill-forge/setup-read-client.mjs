import { createPublicClient, custom, http } from 'viem';

const READ_METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber',
  'eth_getBlockByHash', 'eth_getCode', 'eth_call', 'eth_estimateGas', 'eth_gasPrice',
  'eth_getTransactionCount', 'eth_getBalance', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
const TRANSPORT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'ECONNABORTED',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_RES_CONTENT_LENGTH_MISMATCH']);
const TRANSPORT_NAMES = new Set(['TimeoutError', 'SocketError', 'SocketClosedError',
  'ConnectTimeoutError', 'HeadersTimeoutError', 'BodyTimeoutError']);

function transient(error) {
  let retry = false;
  for (let current = error, depth = 0; current && depth < 8; current = current.cause, depth++) {
    // A transport wrapper must never turn an explicit request/revert rejection
    // into a retry. Unknown HttpRequestError causes remain non-retryable.
    if (current.status >= 400 && current.status < 500 && ![408, 429].includes(current.status)
      || [-32600, -32601, -32602, 3].includes(current.code)
      || ['ExecutionRevertedError', 'ContractFunctionRevertedError'].includes(current.name)
      || current.code === -32000 && /execution reverted/i.test(current.details ?? current.message ?? '')) return false;
    if (TRANSPORT_NAMES.has(current.name) || TRANSPORT_CODES.has(current.code)
      || [408, 429, 500, 502, 503, 504].includes(current.status)
      || [429, -32005, -32603].includes(current.code)) retry = true;
    // Robinhood may serve a new header before its state metadata is available.
    if (current.code === -32000 && /metadata is not found|header not found|log query timed out/i.test(current.details ?? current.message ?? '')) retry = true;
  }
  return retry;
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
