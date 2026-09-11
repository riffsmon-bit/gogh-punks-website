// Read-only collection capture. Secrets stay in memory; outputs contain public data only.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createPublicClient, http, parseAbi } from 'viem';
import { SLOT_POLICY, startingSlotsForRank } from '../../../broker/src/v4/skill-forge/slot-policy.mjs';

const CONTRACT = SLOT_POLICY.collection;
const SLUG = SLOT_POLICY.collectionSlug;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function fingerprint(collection) {
  if (collection.collection !== SLUG || !collection.contracts?.some(c => c.address.toLowerCase() === CONTRACT && c.chain === 'robinhood')) throw new Error('COLLECTION_MISMATCH');
  const r = collection.rarity;
  if (r?.strategy_id !== 'openrarity' || !r.strategy_version || !r.calculated_at || !Number.isSafeInteger(r.total_supply) || r.total_supply < 1 || r.total_supply !== collection.total_supply || r.max_rank !== r.total_supply) throw new Error('INVALID_RARITY_POPULATION');
  return { collection: CONTRACT, chainId: 4663, population: r.total_supply, maxRank: r.max_rank, strategyId: r.strategy_id, strategyVersion: r.strategy_version, calculatedAt: r.calculated_at };
}
export function normalizeNft(nft, baseline, expectedId) {
  if (!nft || nft.collection !== SLUG || nft.contract?.toLowerCase() !== CONTRACT || nft.token_standard !== 'erc721' || !/^[1-9]\d*$/.test(nft.identifier) || nft.identifier !== String(expectedId)) throw new Error('NFT_IDENTITY_MISMATCH');
  const r = nft.rarity;
  if (r?.strategy_id !== baseline.strategyId || r?.strategy_version !== baseline.strategyVersion) throw new Error('NFT_STRATEGY_MISMATCH');
  const startingSlots = startingSlotsForRank(r.rank, baseline.population);
  return { tokenId: nft.identifier, rank: r.rank, startingSlots, metadataHash: hash({ traits: nft.traits ?? [], metadataUrl: nft.metadata_url ?? null, imageUrl: nft.image_url ?? null }), retrievedAt: new Date().toISOString() };
}
export function batchRequest(tokenIds) {
  if (!Array.isArray(tokenIds) || !tokenIds.length || tokenIds.length > 30 || new Set(tokenIds).size !== tokenIds.length || tokenIds.some(id => typeof id !== 'string' || !/^[1-9]\d*$/.test(id) || BigInt(id) > 5016n)) throw new Error('INVALID_BATCH_IDS');
  return { identifiers: tokenIds.map(token_id => ({ chain: 'robinhood', contract_address: CONTRACT, token_id })) };
}
export function normalizeBatch(response, baseline, tokenIds) {
  batchRequest(tokenIds);
  if (!Array.isArray(response.nfts) || response.nfts.length !== tokenIds.length) throw new Error('INCOMPLETE_BATCH');
  const byId = new Map(response.nfts.map(nft => [nft.identifier, nft]));
  if (byId.size !== tokenIds.length || tokenIds.some(id => !byId.has(id))) throw new Error('INCOMPLETE_BATCH');
  return tokenIds.map(id => normalizeNft(byId.get(id), baseline, id));
}
export function verifyComplete(records, liveIds, before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('RARITY_CALCULATION_CHANGED');
  const ids = new Set(records.map(r => r.tokenId));
  if (ids.size !== records.length || ids.size !== before.population || liveIds.length !== before.population || new Set(liveIds).size !== liveIds.length || liveIds.some(id => !ids.has(id))) throw new Error('INCOMPLETE_TOKEN_SET');
  for (const r of records) if (r.startingSlots !== startingSlotsForRank(r.rank, before.population)) throw new Error('ALLOCATION_MISMATCH');
}

export async function boundedJson(response) {
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('INVALID_API_CONTENT_TYPE');
  const chunks = []; let bytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 2_000_000) throw new Error('API_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main() {
  const output = new URL('../../../artifacts/skill-forge/rarity/', import.meta.url);
  await mkdir(output, { recursive: true });
  const checkpointFile = new URL('capture-checkpoint.json', output);
  let key;
  try { key = execFileSync('/usr/bin/security', ['find-generic-password', '-a', 'gogh-punks', '-s', 'Gogh Punks OpenSea API Key', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw new Error('KEYCHAIN_ACCESS_FAILED'); }
  if (!key || /\s/.test(key)) throw new Error('INVALID_KEY_FORMAT');
  let nextRequestAt = 0;
  async function request(path, tokenIds) {
    if (tokenIds && path !== 'nfts/batch') throw new Error('INVALID_BATCH_PATH');
    const body = tokenIds ? JSON.stringify(batchRequest(tokenIds)) : undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, nextRequestAt - Date.now())));
      nextRequestAt = Date.now() + 550; // Below the observed 120/minute token-bucket refill.
      let response;
      try { response = await fetch(`https://api.opensea.io/api/v2/${path}`, { method: body ? 'POST' : 'GET', body, redirect: 'error', headers: { 'x-api-key': key, ...(body ? { 'content-type': 'application/json' } : {}) }, signal: AbortSignal.timeout(20000) }); }
      catch {
        if (attempt === 2) throw new Error('OPENSEA_NETWORK_FAILED');
        console.log(JSON.stringify({ phase: 'transient-network-backoff', attempt: attempt + 1 }));
        nextRequestAt = Date.now() + 5000 * (attempt + 1);
        continue;
      }
      if (response.status >= 500 && attempt < 2) {
        await response.body?.cancel();
        console.log(JSON.stringify({ phase: 'provider-backoff', status: response.status, attempt: attempt + 1 }));
        nextRequestAt = Date.now() + 5000 * (attempt + 1);
        continue;
      }
      if (!response.ok) {
        if (response.status === 429) console.log(JSON.stringify({ phase: 'throttled-stop', retryAfterSeconds: /^\d+$/.test(response.headers.get('retry-after') ?? '') ? Number(response.headers.get('retry-after')) : null }));
        await response.body?.cancel();
        throw new Error(`OPENSEA_HTTP_${response.status}`);
      }
      return boundedJson(response);
    }
    throw new Error('OPENSEA_RETRY_LIMIT');
  }
  const before = fingerprint(await request(`collections/${SLUG}`));
  const client = createPublicClient({ transport: http('https://rpc.mainnet.chain.robinhood.com', { retryCount: 0, timeout: 20000 }) });
  if (await client.getChainId() !== 4663) throw new Error('WRONG_CHAIN');
  const block = await client.getBlock();
  const abi = parseAbi(['function ownerOf(uint256) view returns (address)', 'function totalSupply() view returns (uint256)']);
  const supply = await client.readContract({ address: CONTRACT, abi, functionName: 'totalSupply', blockNumber: block.number });
  if (supply !== BigInt(before.population)) throw new Error('CHAIN_SUPPLY_MISMATCH');
  // Collection has minted IDs 1..5016. Count equality proves this bounded scan is complete.
  const liveIds = [];
  for (let start = 1; start <= 5016; start += 100) {
    const ids = Array.from({ length: Math.min(100, 5017 - start) }, (_, i) => start + i);
    const results = await client.multicall({ multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11', blockNumber: block.number, contracts: ids.map(id => ({ address: CONTRACT, abi, functionName: 'ownerOf', args: [BigInt(id)] })) });
    for (let i = 0; i < results.length; i++) if (results[i].status === 'success' && results[i].result !== '0x0000000000000000000000000000000000000000') liveIds.push(String(ids[i]));
    if (start % 1000 === 1) console.log(JSON.stringify({ phase: 'chain-inventory', through: ids.at(-1), liveFound: liveIds.length }));
  }
  if (liveIds.length !== before.population) throw new Error('INCOMPLETE_CHAIN_INVENTORY');
  const checkpoint = { status: 'COLLECTING_NOT_FROZEN', captureMethod: 'OPENSEA_BATCH_BY_IDENTIFIER_V1', startedAt: new Date().toISOString(), source: 'https://api.opensea.io/api/v2/nfts/batch', baseline: before, block: { number: String(block.number), hash: block.hash, timestamp: String(block.timestamp) }, liveIds, records: [] };
  // Resume only the exact same provider calculation and canonical token set.
  let previous = null;
  try { previous = JSON.parse(await readFile(checkpointFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('CHECKPOINT_READ_FAILED'); }
  if (previous) {
    if (previous.captureMethod === checkpoint.captureMethod && JSON.stringify(previous.baseline) === JSON.stringify(before) && JSON.stringify(previous.liveIds) === JSON.stringify(liveIds)) {
      checkpoint.records = previous.records;
      checkpoint.startedAt = previous.startedAt;
    } else {
      // Preserve prior evidence instead of overwriting a different source calculation.
      const archive = new URL(`partial-${hash(previous)}.json`, output);
      await writeFile(archive, `${JSON.stringify(previous, null, 2)}\n`, { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    }
  }
  const seen = new Set(checkpoint.records.map(r => r.tokenId));
  const save = async () => {
    const temporary = new URL('capture-checkpoint.json.tmp', output);
    await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, checkpointFile);
  };
  await save();
  try {
    const pending = liveIds.filter(id => !seen.has(id));
    for (let start = 0; start < pending.length; start += 30) {
      const ids = pending.slice(start, start + 30);
      checkpoint.records.push(...normalizeBatch(await request('nfts/batch', ids), before, ids));
      await save();
      console.log(JSON.stringify({ phase: 'batch-ranks', retrieved: checkpoint.records.length, total: before.population }));
    }
    const after = fingerprint(await request(`collections/${SLUG}`));
    checkpoint.after = after;
    verifyComplete(checkpoint.records, liveIds, before, after);
    if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error('PINNED_BLOCK_REORG');
    const finalBlock = await client.getBlock();
    if (await client.readContract({ address: CONTRACT, abi, functionName: 'totalSupply', blockNumber: finalBlock.number }) !== supply) throw new Error('SUPPLY_CHANGED_DURING_CAPTURE');
    // Equal supply alone could hide a simultaneous burn/new mint. Every captured ID must survive.
    for (let start = 0; start < liveIds.length; start += 100) {
      const results = await client.multicall({ multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11', blockNumber: finalBlock.number, contracts: liveIds.slice(start, start + 100).map(id => ({ address: CONTRACT, abi, functionName: 'ownerOf', args: [BigInt(id)] })) });
      if (results.some(r => r.status !== 'success' || r.result === '0x0000000000000000000000000000000000000000')) throw new Error('TOKEN_SET_CHANGED_DURING_CAPTURE');
    }
    if ((await client.getBlock({ blockNumber: finalBlock.number })).hash !== finalBlock.hash) throw new Error('FINAL_BLOCK_REORG');
    const payload = { schemaVersion: 1, status: 'VERIFIED_DATA_NOT_ONCHAIN_AUTHORITY', source: checkpoint.source, captureMethod: checkpoint.captureMethod, slotPolicy: SLOT_POLICY, baseline: before, pinnedBlock: checkpoint.block, endBlock: { number: String(finalBlock.number), hash: finalBlock.hash }, startedAt: checkpoint.startedAt, completedAt: new Date().toISOString(), records: checkpoint.records.sort((a, b) => Number(a.tokenId) - Number(b.tokenId)) };
    const digest = hash(payload);
    const filename = `gogh-opensea-rarity-${digest}.json`;
    await writeFile(new URL(filename, output), `${JSON.stringify({ sha256: digest, payload }, null, 2)}\n`, { flag: 'wx' });
    checkpoint.status = 'VERIFIED';
    checkpoint.snapshotFile = filename;
    await save();
    console.log(JSON.stringify({ status: 'VERIFIED', filename, sha256: digest, count: payload.records.length }));
  } catch (error) {
    checkpoint.status = 'BLOCKED_NOT_FROZEN';
    checkpoint.reason = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'CAPTURE_FAILED';
    await save();
    throw new Error(checkpoint.reason);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(JSON.stringify({ status: 'BLOCKED_NOT_FROZEN', reason: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'CAPTURE_FAILED' }));
  process.exitCode = 1;
});
