import { randomBytes } from 'node:crypto';
import { decodeEventLog, keccak256, parseAbi, parseAbiItem, zeroAddress } from 'viem';
import { encodeReviewedBurnCall, encodePunkBurnApproval } from '../../../../site/forge-burn-calldata.js';

const ABI = parseAbi([
  'function ownerOf(uint256) view returns(address)', 'function getApproved(uint256) view returns(address)',
  'function isApprovedForAll(address,address) view returns(bool)', 'function totalSupply() view returns(uint256)',
  'function collection() view returns(address)', 'function progression() view returns(address)',
  'function registry() view returns(address)', 'function trainingSource() view returns(address)',
  'function globallyDisabled() view returns(bool)', 'function trainingCredits(uint256) view returns(uint256)',
  'function sacrificeCredited(uint256) view returns(bool)', 'function burnReviewNonce(uint256) view returns(uint256)',
  'function burnReviewStateHash(uint256,uint256) view returns(bytes32)',
  'event Approval(address indexed owner,address indexed approved,uint256 indexed tokenId)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
  'event TrainingCreditEarned(uint256 indexed tokenId,uint256 indexed sacrificedTokenId)',
  'event PunkBurnReviewed(uint256 indexed sourceTokenId,uint256 indexed targetTokenId,address indexed owner,uint256 nonce,bytes32 stateHash)',
]);
const TRANSFER = parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)');
const HASH = /^0x[0-9a-f]{64}$/i, ADDRESS = /^0x[0-9a-f]{40}$/i;
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const serial = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
const token = value => { if (typeof value !== 'string' || !/^(0|[1-9]\d{0,3})$/.test(value)) throw Error('INVALID_BURN_TOKEN'); return BigInt(value); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

// Preparation and verification only. This module never sends, signs, claims a live
// inventory is complete, or promotes an undeployed release to production authority.
export function createReviewedBurnPreparation({ client, deployment, now = Date.now }) {
  const pins = structuredClone(deployment);
  const roles = ['collection', 'registry', 'progression', 'burnSource'];
  if (![31337, 4663].includes(pins?.chainId) || roles.some(role => !ADDRESS.test(pins[role]) || same(pins[role], zeroAddress)
    || !HASH.test(pins[`${role}CodeHash`]) || /^0x0{64}$/i.test(pins[`${role}CodeHash`]))
    || new Set(roles.map(role => pins[role].toLowerCase())).size !== 4
    || !/^[1-9]\d{0,15}$/.test(pins.feeCeilingWei) || BigInt(pins.feeCeilingWei) > 10n ** 15n) throw Error('PINNED_BURN_DEPLOYMENT_REQUIRED');
  const reviews = new Map();
  const read = (address, functionName, args, blockNumber) => client.readContract({ address, abi: ABI, functionName, args, blockNumber });
  async function stateFor(owner, sourceTokenId, targetTokenId) {
    const source = token(sourceTokenId), target = token(targetTokenId);
    if (source === target || !ADDRESS.test(owner) || same(owner, zeroAddress)) throw Error('BOTH_OWNED_PUNKS_REQUIRED');
    if (await client.getChainId() !== pins.chainId) throw Error('BURN_CHAIN_CHANGED');
    const block = await client.getBlock({ blockTag: 'latest' });
    if (!HASH.test(block.hash) || Math.abs(now() - Number(block.timestamp) * 1000) > 30_000) throw Error('STALE_BURN_SNAPSHOT');
    const code = await Promise.all(roles.map(role => client.getCode({ address: pins[role], blockNumber: block.number })));
    if (code.some((value, index) => !value || !same(keccak256(value), pins[`${roles[index]}CodeHash`]))) throw Error('BURN_RUNTIME_CHANGED');
    const at = (role, name, args = []) => read(pins[role], name, args, block.number);
    const [sourceCollection, boundProgression, trainingSource, progressCollection, registry,
      sourceOwner, targetOwner, approved, operatorApproved, supply, credits, nonce, stateHash, paused] = await Promise.all([
      at('burnSource', 'collection'), at('burnSource', 'progression'), at('progression', 'trainingSource'),
      at('progression', 'collection'), at('progression', 'registry'),
      at('collection', 'ownerOf', [source]), at('collection', 'ownerOf', [target]),
      at('collection', 'getApproved', [source]), at('collection', 'isApprovedForAll', [owner, pins.burnSource]),
      at('collection', 'totalSupply'), at('progression', 'trainingCredits', [target]),
      at('burnSource', 'burnReviewNonce', [source]), at('burnSource', 'burnReviewStateHash', [source, target]),
      at('registry', 'globallyDisabled'),
    ]);
    if (!same(sourceCollection, pins.collection) || !same(progressCollection, pins.collection)
      || !same(boundProgression, pins.progression) || !same(trainingSource, pins.burnSource) || !same(registry, pins.registry)) throw Error('BURN_DEPLOYMENT_MISMATCH');
    if (!same(sourceOwner, owner) || !same(targetOwner, owner)) throw Error('BURN_OWNER_CHANGED');
    if (paused) throw Error('TRAINING_PAUSED');
    if (operatorApproved) throw Error('REVOKE_OPERATOR_WIDE_APPROVAL_FIRST');
    if (supply <= 1111n) throw Error('BURN_SUPPLY_FLOOR');
    if (!HASH.test(stateHash) || /^0x0{64}$/i.test(stateHash)) throw Error('INVALID_BURN_STATE');
    if (!same((await client.getBlock({ blockNumber: block.number })).hash, block.hash)) throw Error('BURN_SNAPSHOT_REORG');
    return { owner, sourceTokenId, targetTokenId, blockNumber: String(block.number), blockHash: block.hash,
      blockTimestamp: String(block.timestamp), stateHash, nonce: String(nonce), approved, supply: String(supply), credits: String(credits) };
  }
  const binding = state => serial([state.owner.toLowerCase(), state.sourceTokenId, state.targetTokenId,
    state.stateHash.toLowerCase(), state.nonce, state.approved.toLowerCase(), state.supply, state.credits]);
  async function unchanged(before, after) {
    if (binding(before) !== binding(after)) throw Error('BURN_REVIEW_STATE_CHANGED');
    const first = BigInt(before.blockNumber), last = BigInt(after.blockNumber);
    if (last < first || last - first > 256n || !same((await client.getBlock({ blockNumber: first })).hash, before.blockHash)) throw Error('BURN_REVIEW_BLOCK_CHANGED');
    if (last === first) return;
    const transfers = await Promise.all([before.sourceTokenId, before.targetTokenId].map(id => client.getLogs({
      address: pins.collection, event: TRANSFER, args: { tokenId: BigInt(id) }, fromBlock: first + 1n, toBlock: last,
    })));
    if (transfers.some(logs => logs.length)) throw Error('PUNK_TRANSFERRED_SINCE_REVIEW');
    if (!same((await client.getBlock({ blockNumber: last })).hash, after.blockHash)) throw Error('BURN_REVIEW_BLOCK_CHANGED');
  }
  async function prepare({ owner, sourceTokenId, targetTokenId, action }) {
    if (!['APPROVE', 'BURN'].includes(action)) throw Error('INVALID_BURN_ACTION');
    if (reviews.size >= 128) throw Error('BURN_REVIEW_LIMIT');
    const state = await stateFor(owner, sourceTokenId, targetTokenId);
    if (action === 'BURN' && !same(state.approved, pins.burnSource)) throw Error('TOKEN_SPECIFIC_APPROVAL_REQUIRED');
    if (action === 'APPROVE' && same(state.approved, pins.burnSource)) throw Error('TOKEN_ALREADY_APPROVED');
    const expiresAt = Math.min(Math.floor(now() / 1000) + 60, Number(state.blockTimestamp) + 60) * 1000;
    if (expiresAt <= now()) throw Error('BURN_REVIEW_EXPIRED');
    const burn = { sourceTokenId, targetTokenId, nonce: state.nonce, stateHash: state.stateHash, deadline: String(expiresAt / 1000) };
    const data = action === 'APPROVE' ? encodePunkBurnApproval(pins.burnSource, sourceTokenId) : encodeReviewedBurnCall(burn);
    const to = action === 'APPROVE' ? pins.collection : pins.burnSource;
    const call = { account: owner, to, data, value: 0n };
    await client.call(call);
    const [estimate, gasPrice, nonce, latestNonce] = await Promise.all([client.estimateGas(call), client.getGasPrice(),
      client.getTransactionCount({ address: owner, blockTag: 'pending' }), client.getTransactionCount({ address: owner, blockTag: 'latest' })]);
    const gas = (estimate * 120n + 99n) / 100n;
    if (gas > 500_000n || gasPrice <= 0n || gas * gasPrice > BigInt(pins.feeCeilingWei)
      || !Number.isSafeInteger(nonce) || nonce < 0 || nonce !== latestNonce) throw Error('BURN_FEE_OR_NONCE_BOUND');
    if (await client.getBalance({ address: owner }) < gas * gasPrice) throw Error('BURN_GAS_UNFUNDED');
    await unchanged(state, await stateFor(owner, sourceTokenId, targetTokenId));
    const review = freeze({ schema: 'GOGH_ORIGINAL_PUNK_BURN_PREPARATION_V1', intentId: randomBytes(32).toString('hex'),
      action, chainId: pins.chainId, state, burn, expiresAt, maximumNetworkFeeWei: String(gas * gasPrice),
      transaction: { from: owner, to, data, value: '0x0', chainId: `0x${pins.chainId.toString(16)}`,
        nonce: `0x${nonce.toString(16)}`, gas: `0x${gas.toString(16)}`, gasPrice: `0x${gasPrice.toString(16)}` },
      productionAuthority: false, walletInventoryReviewed: false,
      warning: 'Burning destroys the source NFT and can remove access to assets in its wallets, including later deposits. Assets do not move to the recipient.',
      approvalWarning: action === 'APPROVE' ? 'Approval has no on-chain expiry. Revoke it if you abandon the burn. Approval does not burn or create a credit.' : null });
    reviews.set(review.intentId, review); return review;
  }
  const stored = review => {
    const saved = reviews.get(review?.intentId);
    if (!saved || serial(saved) !== serial(review)) throw Error('BURN_REVIEW_TAMPERED'); return saved;
  };
  async function recheck(review) {
    const saved = stored(review);
    if (now() >= saved.expiresAt) throw Error('BURN_REVIEW_EXPIRED');
    await unchanged(saved.state, await stateFor(saved.state.owner, saved.state.sourceTokenId, saved.state.targetTokenId));
    const [nonce, latestNonce] = await Promise.all([client.getTransactionCount({ address: saved.state.owner, blockTag: 'pending' }),
      client.getTransactionCount({ address: saved.state.owner, blockTag: 'latest' })]);
    if (nonce !== Number(BigInt(saved.transaction.nonce)) || latestNonce !== nonce) throw Error('BURN_WALLET_NONCE_CHANGED');
    if (await client.getBalance({ address: saved.state.owner }) < BigInt(saved.maximumNetworkFeeWei)) throw Error('BURN_GAS_UNFUNDED');
    await client.call({ account: saved.state.owner, to: saved.transaction.to, data: saved.transaction.data, value: 0n,
      gas: BigInt(saved.transaction.gas), gasPrice: BigInt(saved.transaction.gasPrice) });
    await unchanged(saved.state, await stateFor(saved.state.owner, saved.state.sourceTokenId, saved.state.targetTokenId));
    if (now() >= saved.expiresAt) throw Error('BURN_REVIEW_EXPIRED');
    return { status: 'REVIEW_RECHECKED', transaction: saved.transaction, productionAuthority: false, walletInventoryReviewed: false };
  }
  async function verifyReceipt(review, transactionHash) {
    const saved = stored(review);
    if (!HASH.test(transactionHash)) throw Error('INVALID_BURN_TRANSACTION_HASH');
    if (await client.getChainId() !== pins.chainId) throw Error('BURN_CHAIN_CHANGED');
    let receipt;
    try { receipt = await client.getTransactionReceipt({ hash: transactionHash }); }
    catch { return { status: 'PENDING', transactionHash }; }
    const transaction = await client.getTransaction({ hash: transactionHash });
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const expected = saved.transaction;
    if (!same(receipt.transactionHash, transactionHash) || !same(transaction.hash, transactionHash)
      || !same(block.hash, receipt.blockHash) || !same(block.hash, transaction.blockHash)
      || !same(transaction.from, expected.from) || !same(transaction.to, expected.to) || transaction.input !== expected.data
      || transaction.value !== 0n || transaction.chainId !== pins.chainId || transaction.nonce !== Number(BigInt(expected.nonce))
      || transaction.gas !== BigInt(expected.gas) || transaction.gasPrice !== BigInt(expected.gasPrice)
      || receipt.gasUsed > BigInt(expected.gas) || receipt.effectiveGasPrice > BigInt(expected.gasPrice)) throw Error('BURN_RECEIPT_MISMATCH');
    if (receipt.status === 'reverted') return { status: 'REVERTED', transactionHash };
    if (receipt.status !== 'success') throw Error('BURN_RECEIPT_MISMATCH');
    const runtimes = await Promise.all(roles.map(role => client.getCode({ address: pins[role], blockNumber: receipt.blockNumber })));
    if (runtimes.some((value, index) => !value || !same(keccak256(value), pins[`${roles[index]}CodeHash`]))) throw Error('BURN_RECEIPT_RUNTIME_CHANGED');
    const events = (address, name) => receipt.logs.filter(log => same(log.address, address)).flatMap(log => {
      try { const event = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics }); return event.eventName === name ? [event.args] : []; } catch { return []; }
    });
    const sourceId = BigInt(saved.state.sourceTokenId), targetId = BigInt(saved.state.targetTokenId);
    const at = (role, name, args) => read(pins[role], name, args, receipt.blockNumber);
    if (saved.action === 'APPROVE') {
      const approvals = events(pins.collection, 'Approval');
      if (approvals.length !== 1 || approvals[0].tokenId !== sourceId || !same(approvals[0].owner, saved.state.owner)
        || !same(approvals[0].approved, pins.burnSource) || !same(await at('collection', 'getApproved', [sourceId]), pins.burnSource)
        || !same(await at('collection', 'ownerOf', [sourceId]), saved.state.owner)) throw Error('BURN_APPROVAL_EVENT_MISMATCH');
    } else {
      const burns = events(pins.collection, 'Transfer'), credits = events(pins.progression, 'TrainingCreditEarned');
      const reviewsApplied = events(pins.burnSource, 'PunkBurnReviewed');
      if (burns.length !== 1 || credits.length !== 1 || reviewsApplied.length !== 1
        || burns[0].tokenId !== sourceId || !same(burns[0].from, saved.state.owner) || !same(burns[0].to, zeroAddress)
        || credits[0].tokenId !== targetId || credits[0].sacrificedTokenId !== sourceId
        || reviewsApplied[0].sourceTokenId !== sourceId || reviewsApplied[0].targetTokenId !== targetId
        || !same(reviewsApplied[0].owner, saved.state.owner) || reviewsApplied[0].nonce !== BigInt(saved.burn.nonce)
        || !same(reviewsApplied[0].stateHash, saved.burn.stateHash)
        || !same(await at('collection', 'ownerOf', [targetId]), saved.state.owner)
        || await at('collection', 'totalSupply', []) !== BigInt(saved.state.supply) - 1n
        || await at('progression', 'trainingCredits', [targetId]) !== BigInt(saved.state.credits) + 1n
        || !await at('progression', 'sacrificeCredited', [sourceId])) throw Error('BURN_CREDIT_EVENT_MISMATCH');
    }
    if (!same((await client.getBlock({ blockNumber: receipt.blockNumber })).hash, block.hash)) throw Error('BURN_RECEIPT_REORG');
    return { status: 'CONFIRMED', action: saved.action, transactionHash, blockNumber: String(receipt.blockNumber),
      blockHash: block.hash, sourceTokenId: saved.state.sourceTokenId, targetTokenId: saved.state.targetTokenId,
      creditGain: saved.action === 'BURN' ? 1 : 0, productionAuthority: false };
  }
  return Object.freeze({ prepare, recheck, verifyReceipt });
}
