import { createHash } from 'node:crypto';
import { getAddress, keccak256, parseAbi } from 'viem';

const ABI = parseAbi([
  'function supportsInterface(bytes4) view returns (bool)',
  'function tokenURI(uint256) view returns (string)',
]);
const IMPLEMENTATION = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const BEACON = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
const HASH = /^0x[0-9a-f]{64}$/i;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function optional(operation) {
  try { return { status: 'OBSERVED', value: await operation() }; }
  catch { return { status: 'UNKNOWN', value: null }; }
}
async function snapshot(client) {
  if (await client.getChainId() !== 4663) throw new Error('WRONG_CHAIN');
  const block = await client.getBlock({ blockTag: 'latest' });
  if (typeof block.number !== 'bigint' || !HASH.test(block.hash)) throw new Error('INVALID_BLOCK');
  return block;
}

// No signer dependency and no eth_sendTransaction, approvals, shell or external URL fetch.
export async function inspectContract({ client, contract }) {
  const address = getAddress(contract);
  const block = await snapshot(client);
  const request = { address, blockNumber: block.number };
  const code = await client.getCode(request);
  if (!/^0x(?:[0-9a-f]{2})+$/i.test(code ?? '')) throw new Error('NO_CONTRACT_CODE');
  const [erc721, erc1155, implementation, beacon] = await Promise.all([
    optional(() => client.readContract({ ...request, abi: ABI, functionName: 'supportsInterface', args: ['0x80ac58cd'] })),
    optional(() => client.readContract({ ...request, abi: ABI, functionName: 'supportsInterface', args: ['0xd9b67a26'] })),
    optional(() => client.getStorageAt({ ...request, slot: IMPLEMENTATION })),
    optional(() => client.getStorageAt({ ...request, slot: BEACON })),
  ]);
  const storage = (result) => result.status === 'OBSERVED' && HASH.test(result.value ?? '')
    ? { ...result, nonzero: BigInt(result.value) !== 0n } : { status: 'UNKNOWN', value: null, nonzero: null };
  const report = { chainId: 4663, contract: address, blockNumber: String(block.number), blockHash: block.hash,
    codeHash: keccak256(code), codeBytes: (code.length - 2) / 2, erc721, erc1155,
    eip1967Implementation: storage(implementation), eip1967Beacon: storage(beacon),
    minimalProxy: /^0x363d3d373d3d3d363d73[0-9a-f]{40}5af43d82803e903d91602b57fd5bf3$/i.test(code),
    securityVerdict: 'NOT_A_SECURITY_CLEARANCE', walletAuthority: 'NONE',
    limitations: ['Interface responses can lie.', 'Nonstandard proxies may not use these slots.',
      'No verified source, approval enumeration, or comprehensive vulnerability analysis is claimed.'] };
  return { ...report, evidenceHash: digest(report) };
}

export function parseInlineMetadata(uri) {
  if (typeof uri !== 'string' || uri.length > 2_000_000) throw new Error('METADATA_SIZE_LIMIT');
  const prefix = 'data:application/json;base64,';
  if (!uri.startsWith(prefix)) throw new Error('EXTERNAL_METADATA_REQUIRES_REVIEWED_FETCHER');
  const encoded = uri.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error('INVALID_BASE64');
  const value = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.attributes)
    || value.attributes.length > 128) throw new Error('INVALID_METADATA');
  return value;
}

export async function retrieveInlineMetadata({ client, contract, tokenIds }) {
  if (!Array.isArray(tokenIds) || tokenIds.length < 1 || tokenIds.length > 50
    || tokenIds.some(id => !/^(0|[1-9][0-9]{0,77})$/.test(String(id)))
    || new Set(tokenIds.map(String)).size !== tokenIds.length) throw new Error('INVALID_TOKEN_IDS');
  const address = getAddress(contract);
  const block = await snapshot(client);
  const tokens = [];
  // Bounded sequential reads protect the public RPC; failures never become empty traits.
  for (const tokenId of tokenIds) {
    const uri = await client.readContract({ address, abi: ABI, functionName: 'tokenURI',
      args: [BigInt(tokenId)], blockNumber: block.number });
    tokens.push({ tokenId: String(tokenId), attributes: parseInlineMetadata(uri).attributes });
  }
  return { chainId: 4663, contract: address, blockNumber: String(block.number), blockHash: block.hash,
    coverage: 'SAMPLE_ONLY', tokens, metadataHash: digest(tokens) };
}

// Gogh's simple inverse-frequency model, NOT OpenRarity's entropy-normalized model.
// Missing categorical traits are counted explicitly; numeric/date semantics unsupported.
export function rankTraitSample(tokens, { numericMode = 'reject' } = {}) {
  if (!['reject', 'categorical'].includes(numericMode)) throw new Error('INVALID_NUMERIC_MODE');
  if (!Array.isArray(tokens) || tokens.length < 2 || tokens.length > 10_000) throw new Error('INVALID_SAMPLE');
  const ids = new Set(); const types = new Set();
  const rows = tokens.map(token => {
    if (!/^(0|[1-9][0-9]{0,77})$/.test(String(token.tokenId)) || ids.has(String(token.tokenId))
      || !Array.isArray(token.attributes) || token.attributes.length > 128) throw new Error('INVALID_TOKEN');
    ids.add(String(token.tokenId)); const traits = new Map();
    for (const attribute of token.attributes) {
      if (!attribute || typeof attribute.trait_type !== 'string' || !attribute.trait_type
        || attribute.trait_type.length > 256
        || !(typeof attribute.value === 'string' && attribute.value.length <= 1024
          || numericMode === 'categorical' && Number.isSafeInteger(attribute.value))
        || attribute.display_type || traits.has(attribute.trait_type)) {
        throw new Error('UNSUPPORTED_OR_DUPLICATE_TRAIT');
      }
      traits.set(attribute.trait_type, attribute.value); types.add(attribute.trait_type);
    }
    return { tokenId: String(token.tokenId), traits };
  });
  if (types.size === 0) throw new Error('NO_REVEALED_TRAITS');
  const frequencies = new Map();
  const key = (type, value) => JSON.stringify([type, value]);
  for (const row of rows) for (const type of types) {
    const k = key(type, row.traits.get(type) ?? null); frequencies.set(k, (frequencies.get(k) ?? 0) + 1);
  }
  const ranked = rows.map(row => ({ tokenId: row.tokenId, score: [...types].reduce((score, type) =>
    score + rows.length / frequencies.get(key(type, row.traits.get(type) ?? null)), 0) }));
  ranked.sort((a, b) => b.score - a.score || (BigInt(a.tokenId) < BigInt(b.tokenId) ? -1 : 1));
  ranked.forEach((row, i) => { row.rank = i && row.score === ranked[i - 1].score ? ranked[i - 1].rank : i + 1; });
  return { model: 'GOGH_INVERSE_TRAIT_FREQUENCY_V1', numericMode, coverage: 'SAMPLE_ONLY', sampleSize: rows.length,
    frequencies: [...frequencies].map(([k, count]) => ({ trait: JSON.parse(k), count })), ranked,
    walletAuthority: 'NONE', warning: 'Sample ranks are not collection-wide rarity or a price estimate.', evidenceHash: digest(tokens) };
}
