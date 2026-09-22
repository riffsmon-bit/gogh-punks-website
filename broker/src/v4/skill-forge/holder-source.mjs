import { decodeEventLog, keccak256, parseAbi, stringToHex } from 'viem';
import core from '../../../../deployments/robinhood.json' with { type: 'json' };
import v2 from '../../../../deployments/robinhood-automation-v2.json' with { type: 'json' };
import v3 from '../../../../deployments/robinhood-automation-v3.json' with { type: 'json' };
import agent from '../../../../deployments/robinhood-punk-agent-account.json' with { type: 'json' };
import forge from '../../../../deployments/robinhood-forge-training.json' with { type: 'json' };

const ABI = parseAbi(['function account(uint256) view returns(address)', 'function ownerOf(uint256) view returns(address)',
  'function owner() view returns(address)', 'function balanceOf(address) view returns(uint256)',
  'function balanceOf(address,uint256) view returns(uint256)', 'function isAutonomousSessionActive() view returns(bool)',
  'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)',
  'event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)',
  'event ConsecutiveTransfer(uint256 indexed fromTokenId,uint256 toTokenId,address indexed fromAddress,address indexed toAddress)']);
const ADDRESS = /^0x[0-9a-f]{40}$/i, HASH = /^0x[0-9a-f]{64}$/i;
export const HOLDER_BURN_COLLECTION = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6';
export const HOLDER_WALLET_PINS = Object.freeze([
  ['V1', core.contracts.GoghPunkAccountRegistry, core.contracts.GoghPunkAccountV1],
  ['V2', v2.contracts.GoghPunkAccountRegistryV2, v2.contracts.GoghPunkAccountV2],
  ['V3', v3.contracts.GoghPunkAccountRegistryV3, v3.contracts.GoghPunkAccountV3],
  ['AGENT', agent.contracts.GoghPunkAgentAccountRegistry, agent.contracts.GoghPunkAgentAccount],
]);
export const HOLDER_ASSET_EVENTS = Object.freeze([
  ['Transfer(address,address,uint256)', 2], ['TransferSingle(address,address,address,uint256,uint256)', 3],
  ['TransferBatch(address,address,address,uint256[],uint256[])', 3], ['ConsecutiveTransfer(uint256,uint256,address,address)', 3],
].map(([signature, recipientIndex]) => Object.freeze({ signature, recipientIndex, topic: keccak256(stringToHex(signature)) })));
const valid = (v, code) => { if (!v) throw Error(code); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const serial = v => JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? String(x) : x);
export function holderBurnSelection(owner, sourceTokenId, targetTokenId) {
  valid(ADDRESS.test(owner) && !/^0x0{40}$/i.test(owner), 'HOLDER_BURN_OWNER_REQUIRED');
  for (const id of [sourceTokenId, targetTokenId]) valid(typeof id === 'string' && /^(0|[1-9][0-9]{0,3})$/.test(id)
    && BigInt(id) <= 5016n, 'HOLDER_BURN_TOKEN_INVALID');
  valid(sourceTokenId !== targetTokenId, 'HOLDER_BURN_DIFFERENT_PUNKS_REQUIRED');
  return Object.freeze({ owner: owner.toLowerCase(), sourceTokenId, targetTokenId, chainId: 4663, collection: HOLDER_BURN_COLLECTION });
}

// Receipts discover the standard asset universe, never prove current possession.
// Withdrawn ERC20/721/1155 assets are subsequently checked at the current anchor.
export function observedHolderAssets(logs, wallets) {
  valid(Array.isArray(logs) && logs.length <= 4096, 'HOLDER_HISTORY_LIMIT');
  const allowed = new Set(wallets.map(w => (typeof w === 'string' ? w : w.address).toLowerCase()));
  const found = new Map();
  const add = (wallet, contract, standard, tokenId = null) => {
    const value = { wallet, contract: contract.toLowerCase(), standard, tokenId };
    found.set(serial(value), value); valid(found.size <= 2048, 'HOLDER_INVENTORY_LIMIT');
  };
  for (const log of logs) {
    valid(log && ADDRESS.test(log.address) && Array.isArray(log.topics) && log.removed !== true, 'HOLDER_HISTORY_MALFORMED');
    const event = HOLDER_ASSET_EVENTS.find(e => same(e.topic, log.topics[0]));
    valid(event && HASH.test(log.topics[event.recipientIndex]), 'HOLDER_HISTORY_MALFORMED');
    const wallet = `0x${log.topics[event.recipientIndex].slice(-40)}`.toLowerCase();
    valid(allowed.has(wallet), 'HOLDER_HISTORY_WRONG_RECIPIENT');
    if (event.recipientIndex === 2) {
      if (log.topics.length === 3 && HASH.test(log.data)) add(wallet, log.address, 'ERC20');
      else if (log.topics.length === 4 && HASH.test(log.topics[3]) && log.data === '0x')
        add(wallet, log.address, 'ERC721', String(BigInt(log.topics[3])));
      else throw Error('HOLDER_NONSTANDARD_TRANSFER');
    } else {
      let decoded; try { decoded = decodeEventLog({ abi: ABI, ...log, strict: true }); } catch { throw Error('HOLDER_HISTORY_MALFORMED'); }
      if (decoded.eventName === 'ConsecutiveTransfer') {
        const from = decoded.args.fromTokenId, to = decoded.args.toTokenId;
        valid(to >= from && to - from < 512n, 'HOLDER_INVENTORY_LIMIT');
        for (let id = from; id <= to; id++) add(wallet, log.address, 'ERC721', String(id));
      } else {
        const ids = decoded.eventName === 'TransferSingle' ? [decoded.args.id] : decoded.args.ids;
        valid(Array.isArray(ids) && ids.length <= 512, 'HOLDER_INVENTORY_LIMIT');
        for (const id of ids) add(wallet, log.address, 'ERC1155', String(id));
      }
    }
  }
  return [...found.values()];
}

export function mergeHolderAssets(before, after) {
  const values = new Map([...before, ...after].map(a => {
    const normalized = { wallet: a.wallet, contract: a.contract, standard: a.standard, tokenId: a.tokenId };
    return [serial(normalized), normalized];
  }));
  valid(values.size <= 2048, 'HOLDER_INVENTORY_LIMIT');
  return [...values.values()].sort((a, b) => serial(a).localeCompare(serial(b)));
}

export async function readHolderSource({ clients, selection, pins = HOLDER_WALLET_PINS, collectionCodeHash = forge.collectionCodeHash, now = Date.now }) {
  holderBurnSelection(selection.owner, selection.sourceTokenId, selection.targetTokenId);
  valid(selection.collection === HOLDER_BURN_COLLECTION && selection.chainId === 4663, 'HOLDER_BURN_CHAIN_INVALID');
  valid(clients?.length === 2 && clients[0] !== clients[1], 'HOLDER_TWO_PROVIDERS_REQUIRED');
  const heads = await Promise.all(clients.map(c => c.getBlock({ blockTag: 'latest' })));
  const head = heads.reduce((a, b) => a.number < b.number ? a : b);
  valid(typeof head.number === 'bigint' && HASH.test(head.hash) && Math.abs(now() / 1000 - Number(head.timestamp)) < 30
    && heads.every(h => h.number - head.number <= 120n), 'HOLDER_SOURCE_STALE');
  const at = head.number;
  const observations = await Promise.all(clients.map(async c => {
    valid(await c.getChainId() === 4663 && same((await c.getBlock({ blockNumber: at })).hash, head.hash), 'HOLDER_SOURCE_REORG');
    valid(keccak256(await c.getCode({ address: selection.collection, blockNumber: at }) ?? '0x') === collectionCodeHash, 'HOLDER_COLLECTION_RUNTIME_CHANGED');
    const read = (address, functionName, args = []) => c.readContract({ address, abi: ABI, functionName, args, blockNumber: at });
    const owners = await Promise.all([selection.sourceTokenId, selection.targetTokenId].map(id => read(selection.collection, 'ownerOf', [BigInt(id)])));
    valid(owners.every(o => same(o, selection.owner)), 'HOLDER_BURN_OWNER_CHANGED');
    const wallets = await Promise.all(pins.map(async ([role, registry, implementation]) => {
      for (const record of [registry, implementation]) valid(keccak256(await c.getCode({ address: record.address, blockNumber: at }) ?? '0x')
        === record.runtimeBytecodeHash, 'HOLDER_WALLET_RUNTIME_CHANGED');
      const derived = await read(registry.address, 'account', [BigInt(selection.sourceTokenId)]);
      valid(ADDRESS.test(derived) && !/^0x0{40}$/i.test(derived), 'HOLDER_WALLET_INVALID');
      const address = derived.toLowerCase();
      const [code, native, weth, deposit, latest, pending] = await Promise.all([
        c.getCode({ address, blockNumber: at }), c.getBalance({ address, blockNumber: at }),
        read('0x0bd7d308f8e1639fab988df18a8011f41eacad73', 'balanceOf', [address]), read(agent.entryPoint, 'balanceOf', [address]),
        c.getTransactionCount({ address, blockTag: 'latest' }), c.getTransactionCount({ address, blockTag: 'pending' }),
      ]);
      const deployed = Boolean(code && code !== '0x');
      if (deployed) valid(same(await read(address, 'owner'), selection.owner), 'HOLDER_WALLET_OWNER_CHANGED');
      const sessionActive = role === 'AGENT' && deployed ? await read(address, 'isAutonomousSessionActive') : false;
      return { role, address, deployed, nativeWei: String(native), wethWei: String(weth), entryPointDepositWei: String(deposit),
        sessionActive, pendingTransaction: pending !== latest };
    }));
    valid(same((await c.getBlock({ blockNumber: at })).hash, head.hash), 'HOLDER_SOURCE_REORG');
    return wallets;
  }));
  valid(serial(observations[0]) === serial(observations[1]), 'HOLDER_SOURCE_PROVIDERS_DISAGREE');
  return { selection, anchor: { number: String(at), hash: head.hash, timestamp: String(head.timestamp) }, wallets: observations[0] };
}

export async function readHolderStandardInventory({ clients, source, assets }) {
  valid(Array.isArray(assets) && assets.length <= 2048, 'HOLDER_INVENTORY_LIMIT');
  const allowed = new Set(source.wallets.map(w => w.address));
  const readOne = async (c, asset) => {
    valid(allowed.has(asset.wallet) && ADDRESS.test(asset.contract), 'HOLDER_INVENTORY_INVALID');
    const request = { address: asset.contract, abi: ABI, blockNumber: BigInt(source.anchor.number) };
    if (asset.standard === 'ERC721') {
      // A revert is UNKNOWN (including a burned NFT), never an empty wallet.
      const owner = await c.readContract({ ...request, functionName: 'ownerOf', args: [BigInt(asset.tokenId)] });
      valid(ADDRESS.test(owner) && !/^0x0{40}$/i.test(owner), 'HOLDER_INVENTORY_INVALID');
      return same(owner, asset.wallet) ? '1' : '0';
    }
    valid(['ERC20', 'ERC1155'].includes(asset.standard), 'HOLDER_INVENTORY_INVALID');
    const args = asset.standard === 'ERC20' ? [asset.wallet] : [asset.wallet, BigInt(asset.tokenId)];
    const balance = await c.readContract({ ...request, functionName: 'balanceOf', args });
    valid(typeof balance === 'bigint' && balance >= 0n, 'HOLDER_INVENTORY_INVALID');
    return String(balance);
  };
  const results = []; let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, assets.length) }, async () => {
    while (cursor < assets.length) {
      const index = cursor++, asset = assets[index];
      try {
        const balances = await Promise.all(clients.map(c => readOne(c, asset)));
        valid(balances[0] === balances[1], 'HOLDER_INVENTORY_PROVIDERS_DISAGREE');
        results[index] = { ...asset, balance: balances[0], status: 'VERIFIED' };
      } catch { results[index] = { ...asset, balance: null, status: 'UNKNOWN' }; }
    }
  }));
  for (const c of clients) valid(same((await c.getBlock({ blockNumber: BigInt(source.anchor.number) })).hash, source.anchor.hash), 'HOLDER_SOURCE_REORG');
  return { scope: 'OBSERVED_STANDARD_ERC20_ERC721_ERC1155', assets: results,
    complete: results.every(r => r.status === 'VERIFIED'), empty: results.every(r => r.status === 'VERIFIED' && r.balance === '0'),
    nonstandardAssets: 'OWNER_REVIEW_REQUIRED' };
}
