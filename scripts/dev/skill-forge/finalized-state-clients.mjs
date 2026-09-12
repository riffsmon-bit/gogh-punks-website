import { createPublicClient, http } from 'viem';

export const finalizedStateEndpoints = Object.freeze([
  'https://robinhood-mainnet-rpc.blockreq.com/v1/rpc/public',
  'https://robinhood.drpc.org',
]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const rateLimited = error => {
  for (let e = error; e; e = e.cause) if (e.code === 15 || e.status === 429) return true;
  return false;
};

// Low-volume local deployment verification only. Public state services impose
// rate limits: serialize reads and back off on explicit throttling responses.
// There is no latest-state fallback and this transport cannot submit transactions.
export function pacedStateTransport(url, { transportFactory = http, wait = pause } = {}) {
  return options => {
    const base = transportFactory(url, { timeout: 15000, retryCount: 0 })(options);
    let tail = Promise.resolve();
    return { ...base, request(request, requestOptions) {
      if (!['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'].includes(request.method))
        return Promise.reject(Error('FORGE_STATE_READ_ONLY'));
      const result = tail.then(async () => {
        for (let attempt = 0; ; attempt++) {
          try { return await base.request(request, requestOptions); }
          catch (error) {
            if (attempt >= 2 || !rateLimited(error)) throw error;
            await wait(2000 * (attempt + 1));
          }
        }
      });
      tail = result.then(() => wait(350), () => wait(350));
      return result;
    } };
  };
}

export const createFinalizedStateClients = () => finalizedStateEndpoints.map(url =>
  createPublicClient({ transport: pacedStateTransport(url), cacheTime: 0 }));
