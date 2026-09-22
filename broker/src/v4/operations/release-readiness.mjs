import { keccak256, parseAbi } from 'viem';

const OWNER_ABI = parseAbi(['function ownerOf(uint256) view returns(address)']);
const HASH = /^0x[0-9a-f]{64}$/i;
const fail = () => { throw Error('RELEASE_CHAIN_CHECK_FAILED'); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

// Fixed operator diagnostics only. Inputs come from reviewed server artifacts,
// never a holder request. No provider URL, SQL identity or secret is returned.
export async function checkReleaseChain({ clients, history, release, now = Date.now }) {
  if (!Array.isArray(clients) || clients.length !== 2 || release.chainId !== 4663
    || !HASH.test(history.anchor.hash) || history.positiveControl.logs.length !== 1) fail();
  const observed = history.positiveControl.logs[0];
  const started = now();
  const heads = await Promise.all(clients.map(async client => {
    const [chain, head] = await Promise.all([client.getChainId(), client.getBlock({ blockTag: 'latest' })]);
    if (chain !== 4663 || typeof head.number !== 'bigint' || head.number < 12n || !HASH.test(head.hash)
      || typeof head.timestamp !== 'bigint' || Math.abs(now() - Number(head.timestamp) * 1000) > 30_000) fail();
    return head;
  }));
  const anchor = (heads[0].number < heads[1].number ? heads[0].number : heads[1].number) - 12n;
  const results = await Promise.all(clients.map(async (client, index) => {
    const [current, historical, owner, logs, registry, progression] = await Promise.all([
      client.getBlock({ blockNumber: anchor }),
      client.getBlock({ blockNumber: BigInt(history.anchor.number) }),
      client.readContract({ address: release.collection, abi: OWNER_ABI, functionName: 'ownerOf',
        args: [BigInt(history.sourceTokenId)], blockNumber: BigInt(history.anchor.number) }),
      client.request({ method: 'eth_getLogs', params: [{ address: observed.address,
        fromBlock: `0x${BigInt(history.positiveControl.from).toString(16)}`,
        toBlock: `0x${BigInt(history.positiveControl.to).toString(16)}`,
        topics: [observed.topics[0], null, observed.topics[2]] }] }),
      client.getCode({ address: release.registry, blockNumber: anchor }),
      client.getCode({ address: release.progression, blockNumber: anchor }),
    ]);
    if (!same(historical.hash, history.anchor.hash) || !HASH.test(current.hash)
      || !/^0x[0-9a-f]{40}$/i.test(owner) || /^0x0{40}$/i.test(owner)
      || keccak256(registry ?? '0x') !== release.registryCodeHash
      || keccak256(progression ?? '0x') !== release.progressionCodeHash
      || !Array.isArray(logs) || logs.length > 128 || !logs.some(log => log.removed === false
        && same(log.address, observed.address) && same(log.blockHash, observed.blockHash)
        && same(log.transactionHash, observed.transactionHash) && same(log.data, observed.data)
        && Array.isArray(log.topics) && log.topics.length === observed.topics.length
        && log.topics.every((topic, i) => same(topic, observed.topics[i])))) fail();
    return { provider: index === 0 ? 'SECONDARY' : 'PRIMARY', head: String(heads[index].number),
      anchorHash: current.hash, historicalOwner: owner, historicalStateVerified: true,
      positiveTransferControlVerified: true, deployedRuntimeVerified: true };
  }));
  if (!same(results[0].anchorHash, results[1].anchorHash)
    || !same(results[0].historicalOwner, results[1].historicalOwner)) fail();
  await Promise.all(clients.map(async client => {
    const [closing, chain] = await Promise.all([client.getBlock({ blockNumber: anchor }), client.getChainId()]);
    if (chain !== 4663 || !same(closing.hash, results[0].anchorHash)) fail();
  }));
  return { verified: true, chainId: 4663, anchor: { number: String(anchor), hash: results[0].anchorHash },
    historicalBlock: history.anchor.number, latencyMs: Math.round(now() - started),
    providers: results.map(({ historicalOwner, ...publicResult }) => publicResult) };
}
