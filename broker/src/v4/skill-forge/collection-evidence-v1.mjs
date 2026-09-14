import { createHash } from 'node:crypto';
import { parseAbi } from 'viem';
import { readContract } from 'viem/actions';
import { inspectContract, parseInlineMetadata } from './research-tools.mjs';

const ABI = parseAbi(['function tokenURI(uint256) view returns(string)']);
const UINT = /^(0|[1-9][0-9]{0,77})$/, MAX_UINT = (1n << 256n) - 1n;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function text(value, maximum) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}
function normalize(value) {
  const traits = [], seen = new Set(); let excludedTraits = 0;
  for (const item of value.attributes) {
    const traitType = text(item?.trait_type, 128), displayType = item?.display_type ?? null;
    const attribute = typeof item?.value === 'string' ? text(item.value, 256)
      : Number.isSafeInteger(item?.value) ? item.value : null;
    if (traitType === null || attribute === null || displayType !== null && text(displayType, 64) === null) {
      excludedTraits++; continue;
    }
    // Duplicate names are kept as declared evidence but cannot support a unique classification.
    traits.push({ traitType, value: attribute, displayType });
    seen.add(traitType);
  }
  return { name: text(value.name, 160), declaredTraits: traits,
    excludedTraits, duplicateTraitNames: traits.length - seen.size,
    metadataAuthority: 'UNTRUSTED_CONTRACT_DECLARATIONS' };
}

// Fixed configured read-only client only. Images and external metadata URLs are never fetched.
export function createCollectionEvidenceV1({ client, timeoutMs = 12_000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12_000) throw Error('INVALID_RESEARCH_BOUNDS');
  // viem checks this on the client, not readContract arguments. Do not reuse
  // the original client's bound call action: it could follow OffchainLookup URLs.
  const actionClient = typeof client?.request === 'function' ? { ...client, ccipRead: false, call: undefined } : null;
  if (!actionClient && client?.ccipRead !== false) throw Error('RESEARCH_CCIP_DISABLED_CLIENT_REQUIRED');
  const fixedClient = actionClient ? { ...client, readContract: args => readContract(actionClient, args) } : client;
  return Object.freeze({
    async readCollectionSample({ contract, tokenIds }) {
      if (!Array.isArray(tokenIds) || tokenIds.length < 1 || tokenIds.length > 20
        || tokenIds.some(id => typeof id !== 'string' || !UINT.test(id) || BigInt(id) > MAX_UINT)
        || new Set(tokenIds).size !== tokenIds.length) throw Error('INVALID_TOKEN_IDS');
      tokenIds = [...tokenIds];
      let expired = false, timer;
      const work = async () => {
        const contractEvidence = await inspectContract({ client: fixedClient, contract });
        const blockNumber = BigInt(contractEvidence.blockNumber), tokens = [];
        const readToken = async tokenId => {
          if (expired) throw Error('COLLECTION_RESEARCH_TIMEOUT');
          try {
            const uri = await fixedClient.readContract({ address: contractEvidence.contract, abi: ABI,
              functionName: 'tokenURI', args: [BigInt(tokenId)], blockNumber });
            const metadata = normalize(parseInlineMetadata(uri));
            return { tokenId, status: 'OBSERVED', ...metadata };
          } catch (error) {
            const known = ['EXTERNAL_METADATA_REQUIRES_REVIEWED_FETCHER', 'METADATA_SIZE_LIMIT', 'INVALID_BASE64', 'INVALID_METADATA'];
            return { tokenId, status: 'UNAVAILABLE', reason: known.includes(error?.message) ? error.message : 'TOKEN_METADATA_UNAVAILABLE' };
          }
        };
        // At most three RPC metadata reads run together; preserve caller order.
        for (let offset = 0; offset < tokenIds.length; offset += 3) {
          if (expired) throw Error('COLLECTION_RESEARCH_TIMEOUT');
          tokens.push(...await Promise.all(tokenIds.slice(offset, offset + 3).map(readToken)));
        }
        if (expired) throw Error('COLLECTION_RESEARCH_TIMEOUT');
        if (await client.getChainId() !== 4663) throw Error('WRONG_CHAIN');
        if ((await client.getBlock({ blockNumber })).hash !== contractEvidence.blockHash) throw Error('REORG_DURING_COLLECTION_READ');
        const observed = tokens.filter(token => token.status === 'OBSERVED');
        return { chainId: 4663, contract: contractEvidence.contract, contractEvidence,
          blockNumber: contractEvidence.blockNumber, blockHash: contractEvidence.blockHash,
          tokens, metadataHash: digest(tokens), coverage: { status: observed.length === tokens.length ? 'BOUNDED_SAMPLE'
            : observed.length ? 'PARTIAL' : 'UNAVAILABLE', requestedCount: tokens.length, observedCount: observed.length,
          unavailableCount: tokens.length - observed.length, collectionComplete: false,
          sampleSelection: 'CALLER_SELECTED_TOKEN_IDS', tokenExistenceVerified: false },
          source: 'FIXED_CHAIN_RPC_INLINE_METADATA', walletAuthority: 'NONE', executable: false };
      };
      try {
        return await Promise.race([work(), new Promise((_, reject) => {
          timer = setTimeout(() => { expired = true; reject(Error('COLLECTION_RESEARCH_TIMEOUT')); }, timeoutMs);
        })]);
      } finally { expired = true; clearTimeout(timer); }
    },
  });
}
