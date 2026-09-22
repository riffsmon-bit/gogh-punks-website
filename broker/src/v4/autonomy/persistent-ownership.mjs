import { decodeEventLog, encodeEventTopics, parseAbi, parseAbiItem } from 'viem';
import { watchFail } from './persistent-domain.mjs';
const COLLECTION = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6';
const OWNER = parseAbi(['function ownerOf(uint256) view returns(address)']);
const TRANSFER = parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)');
const HASH = /^0x[0-9a-f]{64}$/, ADDRESS = /^0x[0-9a-f]{40}$/;
const unavailable = () => watchFail('WATCH_OWNERSHIP_UNAVAILABLE', 'Ownership history could not be checked. Recheck shortly.', 503);
const changed = () => watchFail('WATCH_OWNER_CHANGED', 'Ownership changed. Review the inherited taste and activate again.');

export async function readPersistentOwnership({ client, tokenId, expectedOwner = null, now = Date.now }) {
  if (!/^[1-9][0-9]{0,3}$/.test(tokenId) || Number(tokenId) > 5016) watchFail('WATCH_INVALID_PUNK', 'Choose a valid Punk.', 400);
  const block = await client.getBlock({ blockTag: 'latest' });
  const time = Number(block?.timestamp) * 1000;
  if (await client.getChainId() !== 4663 || typeof block?.number !== 'bigint' || !HASH.test(block?.hash)
    || !Number.isSafeInteger(time) || time > now() + 5000 || now() - time > 30000) unavailable();
  const owner = String(await client.readContract({ address: COLLECTION, abi: OWNER, functionName: 'ownerOf',
    args: [BigInt(tokenId)], blockNumber: block.number })).toLowerCase();
  if (!ADDRESS.test(owner) || now() - time > 30000) unavailable();
  if (expectedOwner && owner !== expectedOwner.toLowerCase()) watchFail('NOT_CURRENT_OWNER', 'Connect the current owner wallet for this Punk.', 403);
  return { tokenId, owner, blockNumber: String(block.number), blockHash: block.hash, checkedAt: time };
}

// Off-chain continuity evidence for a logical watch. Never an on-chain ownership epoch.
export async function assertPersistentContinuity({ client, before, after, now = Date.now }) {
  if (before.tokenId !== after.tokenId || before.owner !== after.owner) changed();
  if (!/^(0|[1-9][0-9]*)$/.test(before.blockNumber) || !/^(0|[1-9][0-9]*)$/.test(after.blockNumber)
    || !HASH.test(before.blockHash) || !HASH.test(after.blockHash)
    || !Number.isSafeInteger(after.checkedAt) || after.checkedAt > now() + 5000) unavailable();
  const first = BigInt(before.blockNumber), last = BigInt(after.blockNumber), started = now();
  if (last < first || last - first > 40000n) unavailable();
  const anchor = await client.getBlock({ blockNumber: first });
  if (anchor.hash !== before.blockHash || anchor.number !== first) unavailable();
  const topics = encodeEventTopics({ abi: [TRANSFER], eventName: 'Transfer', args: { tokenId: BigInt(before.tokenId) } });
  for (let start = first; start <= last; start += 2000n) {
    if (now() - started > 8000) unavailable();
    const end = start + 1999n > last ? last : start + 1999n;
    const logs = await client.request({ method: 'eth_getLogs', params: [{ address: COLLECTION, topics,
      fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` }] }, { retryCount: 0 });
    if (!Array.isArray(logs) || logs.length > 1000) unavailable();
    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      if (!Object.hasOwn(logs, i) || !log || log.address?.toLowerCase() !== COLLECTION || log.removed !== false
        || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(log.blockNumber) || !HASH.test(log.blockHash)
        || BigInt(log.blockNumber) < start || BigInt(log.blockNumber) > end) unavailable();
      let decoded;
      try { decoded = decodeEventLog({ abi: [TRANSFER], data: log.data, topics: log.topics, strict: true }); }
      catch { unavailable(); }
      if (decoded.args.tokenId !== BigInt(before.tokenId)) unavailable();
      const block = await client.getBlock({ blockNumber: BigInt(log.blockNumber) });
      if (block.hash !== log.blockHash) unavailable();
      changed(); // Includes self-transfers and same-transaction away/back, even if current owner matches.
    }
    if (Reflect.ownKeys(logs).length !== 1) unavailable();
  }
  const [closingFirst, closingLast, chainId] = await Promise.all([
    client.getBlock({ blockNumber: first }), client.getBlock({ blockNumber: last }), client.getChainId(),
  ]);
  if (closingFirst.hash !== before.blockHash || closingLast.hash !== after.blockHash || chainId !== 4663
    || now() - started > 8000 || now() - after.checkedAt > 30000) unavailable();
  return after;
}
