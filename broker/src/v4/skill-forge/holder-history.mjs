import { createHash } from 'node:crypto';
import { HOLDER_ASSET_EVENTS, mergeHolderAssets, observedHolderAssets } from './holder-source.mjs';

const valid = (v, code) => { if (!v) throw Error(code); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const hex = n => `0x${n.toString(16)}`;
export function holderHistoryIdentity(source) {
  const identity = { chainId: 4663, collection: source.selection.collection, sourceTokenId: source.selection.sourceTokenId,
    wallets: source.wallets.map(w => w.address.toLowerCase()) };
  valid(identity.wallets.length === 4 && new Set(identity.wallets).size === 4, 'HOLDER_HISTORY_WALLETS_INVALID');
  return { ...identity, key: createHash('sha256').update(JSON.stringify(identity)).digest('hex') };
}

// One request performs bounded work and commits only complete canonical ranges.
// A retry resumes the durable cursor; a missing/failed range can never be skipped.
// The provider is server-owned; no URL, cursor, asset list or proof is accepted
// from the browser. Historical results are shared for a source across owners.
export function createHolderHistoryScanner({ clients, store, positiveControl, rangeBlocks = 2000, maxRanges = 4 }) {
  valid(clients?.length === 2 && clients[0] !== clients[1] && Number.isInteger(rangeBlocks) && rangeBlocks > 0 && rangeBlocks <= 2000
    && Number.isInteger(maxRanges) && maxRanges >= 1 && maxRanges <= 8, 'HOLDER_HISTORY_CONFIGURATION_INVALID');
  valid(positiveControl?.filter && /^0x[0-9a-f]{64}$/i.test(positiveControl.transactionHash)
    && /^0x[0-9a-f]{64}$/i.test(positiveControl.blockHash), 'HOLDER_HISTORY_CONTROL_REQUIRED');
  const canonical = async anchor => {
    for (const client of clients) valid(await client.getChainId() === 4663
      && same((await client.getBlock({ blockNumber: BigInt(anchor.number) })).hash, anchor.hash), 'HOLDER_HISTORY_REORG');
  };
  async function advance(source) {
    const identity = holderHistoryIdentity(source), target = BigInt(source.anchor.number);
    await canonical(source.anchor);
    const control = await clients[1].request({ method: 'eth_getLogs', params: [positiveControl.filter] });
    valid(Array.isArray(control) && control.some(l => l.removed !== true && same(l.transactionHash, positiveControl.transactionHash)
      && same(l.blockHash, positiveControl.blockHash)), 'HOLDER_HISTORY_CONTROL_FAILED');
    let record = await store.load(identity.key);
    if (!record) record = await store.create({ identity, cursor: '-1', anchorHash: null, assets: [], revision: 0 });
    valid(record.identity?.key === identity.key && record.identity.chainId === identity.chainId
      && record.identity.collection === identity.collection && record.identity.sourceTokenId === identity.sourceTokenId
      && Array.isArray(record.identity.wallets) && record.identity.wallets.length === identity.wallets.length
      && record.identity.wallets.every((w, i) => w === identity.wallets[i]), 'HOLDER_HISTORY_BINDING_CHANGED');
    let cursor = BigInt(record.cursor);
    valid(cursor <= target, 'HOLDER_HISTORY_AHEAD');
    if (cursor >= 0n) {
      const blocks = await Promise.all(clients.map(c => c.getBlock({ blockNumber: cursor })));
      valid(blocks.every(b => /^0x[0-9a-f]{64}$/i.test(b.hash)) && same(blocks[0].hash, blocks[1].hash), 'HOLDER_HISTORY_REORG');
      if (!same(blocks[0].hash, record.anchorHash)) {
        // Two providers agree the saved anchor was replaced. Preserve its old
        // evidence in the reset audit, then restart from genesis; never skip to
        // the new head or accept an unverified browser-supplied checkpoint.
        valid(typeof store.reset === 'function', 'HOLDER_HISTORY_RESET_REQUIRED');
        record = await store.reset(identity.key, record.revision, { oldCursor: record.cursor, oldHash: record.anchorHash,
          replacementHash: blocks[0].hash, reason: 'CANONICAL_REORG' });
        cursor = -1n;
      }
    }
    for (let pass = 0; pass < maxRanges && cursor < target; pass++) {
      const from = cursor + 1n, to = from + BigInt(rangeBlocks) - 1n < target ? from + BigInt(rangeBlocks) - 1n : target;
      const block = await clients[1].getBlock({ blockNumber: to });
      await canonical({ number: String(to), hash: block.hash });
      const parts = await Promise.all(HOLDER_ASSET_EVENTS.map(async ({ topic, recipientIndex }) => {
        const topics = [topic, ...Array(recipientIndex - 1).fill(null), identity.wallets.map(w => `0x${w.slice(2).padStart(64, '0')}`)];
        const logs = await clients[1].request({ method: 'eth_getLogs', params: [{ fromBlock: hex(from), toBlock: hex(to), topics }] });
        valid(Array.isArray(logs) && logs.length <= 4096, 'HOLDER_HISTORY_LIMIT');
        // Even a misbehaving provider cannot inject a different range/recipient.
        valid(logs.every(l => /^0x[0-9a-f]+$/i.test(l.blockNumber) && BigInt(l.blockNumber) >= from
          && BigInt(l.blockNumber) <= to && same(l.topics?.[0], topic) && /^0x[0-9a-f]{64}$/i.test(l.blockHash)
          && /^0x[0-9a-f]{64}$/i.test(l.transactionHash)), 'HOLDER_HISTORY_MALFORMED');
        const anchors = new Map(logs.map(l => [l.blockNumber, l.blockHash]));
        valid(anchors.size <= 64 && logs.every(l => anchors.get(l.blockNumber) === l.blockHash), 'HOLDER_HISTORY_LIMIT');
        for (const [number, hash] of anchors) await canonical({ number: String(BigInt(number)), hash });
        return observedHolderAssets(logs, identity.wallets);
      }));
      const assets = mergeHolderAssets(record.assets, parts.flat());
      await canonical({ number: String(to), hash: block.hash });
      record = await store.advance(identity.key, record.revision, { cursor: String(to), anchorHash: block.hash, assets });
      cursor = BigInt(record.cursor);
    }
    await canonical(source.anchor);
    return { schema: 'GOGH_HOLDER_STANDARD_HISTORY_V1', identity, cursor: record.cursor, anchorHash: record.anchorHash,
      targetBlock: String(target), complete: cursor === target, assets: record.assets, positiveControlVerified: true,
      indexedProviders: 1, anchorVerifiedProviders: 2, coverage: 'STANDARD_INCOMING_EVENTS_FROM_GENESIS',
      restartedHistory: record.generation ?? 0,
      progressPercent: target < 0n ? 0 : Number((cursor + 1n) * 10000n / (target + 1n)) / 100 };
  }
  return { advance };
}
