import { createPublicClient, decodeFunctionResult, encodeFunctionData, http, keccak256, parseAbi } from 'viem';
import { ROBINHOOD } from '../../../broker/src/config.mjs';
import { verifyOwnedPunkIds } from '../../../site/broker-v2-ownership.js';
import manifest from '../../../deployments/robinhood-automation-v3.json' with { type: 'json' };
import { getRpcUrl } from './config.mjs';
import { PublicError } from './http.mjs';

const REGISTRY = manifest.contracts.GoghPunkAccountRegistryV3;
const MULTICALL = '0xca11bde05977b3631167028862be2a173976ca11';
const AGGREGATE = parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)']);
const ACCOUNT = parseAbi(['function account(uint256 tokenId) view returns (address)']);
const ADDRESS = /^0x[0-9a-f]{40}$/i, HASH = /^0x[0-9a-f]{64}$/i;
const ZERO = `0x${'0'.repeat(40)}`;
const unavailable = () => new PublicError(503, 'PUNK_ROSTER_UNAVAILABLE',
  'Your Punk list could not be fully verified. Try again shortly.');

export function getV2RosterRpcUrl(environment = process.env) {
  const archive = environment.ROBINHOOD_ARCHIVE_RPC_URL;
  if (archive === undefined || archive === '') return getRpcUrl();
  try {
    const url = new URL(archive);
    if (url.protocol !== 'https:') throw unavailable();
    return url.toString();
  } catch { throw unavailable(); }
}
function defaultClient(signal) {
  return createPublicClient({ cacheTime: 0, transport: http(getV2RosterRpcUrl(), {
    retryCount: 0, timeout: 1_800, fetchOptions: { signal },
  }) });
}
async function bounded(read, timeoutMs) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(read), new Promise((_, reject) => {
    timer = setTimeout(() => reject(unavailable()), timeoutMs);
  })]); } finally { clearTimeout(timer); }
}

// A list is an observation, never action authority. Reuse the browser's existing
// one-block balanceOf/ownerOf reconciliation; metadata/index entries are hints.
// Resolution reads only the fixed registry's account addresses in bounded batches.
export async function readV2McpRoster(owner, { pool, client, timeoutMs = 12_000,
  callTimeoutMs = 1_800, hintsTimeoutMs = 500 } = {}) {
  if (!ADDRESS.test(owner ?? '') || owner.toLowerCase() === ZERO) throw unavailable();
  if (![timeoutMs, callTimeoutMs, hintsTimeoutMs].every(n => Number.isSafeInteger(n) && n > 0)
    || timeoutMs > 12_000 || callTimeoutMs > 1_800 || hintsTimeoutMs > 500) throw unavailable();
  const expectedOwner = owner.toLowerCase(), controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const source = client ?? defaultClient(controller.signal);
  const call = async args => {
    if (controller.signal.aborted || Date.now() >= deadline) throw unavailable();
    if (!['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_call', 'eth_getCode'].includes(args.method)) throw unavailable();
    return bounded(() => source.request(args), Math.min(callTimeoutMs, deadline - Date.now()));
  };
  try {
    return await bounded(async () => {
      if (BigInt(await call({ method: 'eth_chainId' })) !== BigInt(ROBINHOOD.chainId)) throw unavailable();
      let candidates = [];
      try {
        const result = await bounded(() => pool.query(`SELECT token_id::text FROM broker_punks
          WHERE chain_id = $1 AND collection_address = $2 AND owner_snapshot = $3
          ORDER BY token_id LIMIT 5017`, [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, expectedOwner]), hintsTimeoutMs);
        candidates = [...new Set(result.rows.filter(row => typeof row.token_id === 'string'
          && /^(0|[1-9]\d{0,3})$/.test(row.token_id) && Number(row.token_id) <= 5016).map(row => row.token_id))];
      } catch { /* An index outage must not prevent live discovery. */ }
      // Capture the block before any collection read, then confirm it after all reads.
      const blockTag = await call({ method: 'eth_blockNumber' });
      if (typeof blockTag !== 'string' || !/^0x[0-9a-f]+$/i.test(blockTag)) throw unavailable();
      const before = await call({ method: 'eth_getBlockByNumber', params: [blockTag, false] });
      if (!HASH.test(before?.hash ?? '') || BigInt(before.number) !== BigInt(blockTag)) throw unavailable();
      const provider = { request: args => args.method === 'eth_blockNumber' ? Promise.resolve(blockTag) : call(args) };
      const owned = await verifyOwnedPunkIds(provider, ROBINHOOD.canonicalCollection, expectedOwner, candidates);
      const punks = [];
      if (owned.tokenIds.length) {
        const code = await call({ method: 'eth_getCode', params: [REGISTRY.address, blockTag] });
        if (typeof code !== 'string' || keccak256(code) !== REGISTRY.runtimeBytecodeHash) throw unavailable();
        const chunks = [];
        for (let i = 0; i < owned.tokenIds.length; i += 200) chunks.push(owned.tokenIds.slice(i, i + 200));
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, async () => {
          while (cursor < chunks.length) {
            const ids = chunks[cursor++];
            const data = encodeFunctionData({ abi: AGGREGATE, functionName: 'aggregate3', args: [ids.map(id => ({
              target: REGISTRY.address, allowFailure: false,
              callData: encodeFunctionData({ abi: ACCOUNT, functionName: 'account', args: [BigInt(id)] }),
            }))] });
            const result = await call({ method: 'eth_call', params: [{ to: MULTICALL, data }, blockTag] });
            if (typeof result !== 'string' || result.length > 200_002) throw unavailable();
            const decoded = decodeFunctionResult({ abi: AGGREGATE, functionName: 'aggregate3', data: result });
            if (decoded.length !== ids.length) throw unavailable();
            for (let i = 0; i < ids.length; i++) {
              if (!decoded[i].success || !/^0x0{24}[0-9a-f]{40}$/i.test(decoded[i].returnData)) throw unavailable();
              const punkWallet = decodeFunctionResult({ abi: ACCOUNT, functionName: 'account', data: decoded[i].returnData }).toLowerCase();
              if (!ADDRESS.test(punkWallet) || punkWallet === ZERO) throw unavailable();
              punks.push({ tokenId: ids[i], punkWallet, ownershipBlock: BigInt(blockTag).toString() });
            }
          }
        }));
      }
      const after = await call({ method: 'eth_getBlockByNumber', params: [blockTag, false] });
      const chain = await call({ method: 'eth_chainId' });
      if (BigInt(chain) !== BigInt(ROBINHOOD.chainId) || after?.hash !== before.hash
        || BigInt(after.number) !== BigInt(blockTag) || punks.length !== owned.balance) throw unavailable();
      punks.sort((a, b) => Number(a.tokenId) - Number(b.tokenId));
      return { punks, indexIsAuthority: false, coverage: { status: 'COMPLETE_AT_BLOCK',
        blockNumber: BigInt(blockTag).toString(), blockHash: before.hash,
        verifiedCount: punks.length, scope: 'ORIGINAL_GOGH_COLLECTION' } };
    }, timeoutMs);
  } catch { throw unavailable(); }
  finally { controller.abort(); }
}
