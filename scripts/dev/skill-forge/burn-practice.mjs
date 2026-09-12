import { randomBytes } from 'node:crypto';
import { decodeEventLog, encodeFunctionData, parseAbi, zeroAddress } from 'viem';

const burnAbi = parseAbi(['function sacrifice(uint256 source,uint256 target,bytes32 targetState,uint256 sourceEpoch,uint256 targetEpoch,uint64 deadline)']);
const collectionAbi = parseAbi(['function ownerOf(uint256) view returns(address)', 'function ownershipEpoch(uint256) view returns(uint256)',
  'function totalSupply() view returns(uint256)', 'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
const walletAbi = parseAbi(['function owner() view returns(address)']);
const progressionAbi = parseAbi(['function sacrificeCredited(uint256) view returns(bool)',
  'event TrainingCreditEarned(uint256 indexed tokenId,uint256 indexed sacrificedTokenId)']);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const serial = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
const exact = (input, keys) => input && !Array.isArray(input) && Object.keys(input).sort().join(',') === keys.sort().join(',');

// Instantiated only by a new loopback Anvil harness. No RPC, signer or recipient HTTP overrides.
export function createBurnPractice({ client, wallet, owner, collection, source, progression, wallets, snapshot, now = Date.now }) {
  let record = null;
  let preparing = false;
  const read = (functionName, args = [], blockNumber) => client.readContract({ address: collection, abi: collectionAbi, functionName, args, blockNumber });
  const guard = async () => {
    if (await client.getChainId() !== 31337 || !/anvil/i.test(await client.request({ method: 'web3_clientVersion' }))) throw Error('LOCAL_CHAIN_REQUIRED');
  };
  async function state() {
    await guard();
    const target = await snapshot(44);
    const blockNumber = BigInt(target.blockNumber);
    const walletStates = await Promise.all(wallets.map(async entry => ({ ...entry,
      nativeWei: String(await client.getBalance({ address: entry.address, blockNumber })),
      owner: await client.readContract({ address: entry.address, abi: walletAbi, functionName: 'owner', blockNumber }),
      inventory: 'TEST_NATIVE_ONLY', tokenInventory: 'Not indexed; these are fresh fixture contracts, not production wallets.' })));
    return { localOnly: true, productionAuthority: false, chainId: 31337, sourceTokenId: 7, targetTokenId: 44,
      owner, collection, source, progression, blockNumber: String(blockNumber), blockHash: target.blockHash,
      sourceEpoch: String(await read('ownershipEpoch', [7n], blockNumber)),
      targetEpoch: String(await read('ownershipEpoch', [44n], blockNumber)),
      sourceOwner: walletStates[0].owner, targetOwner: target.owner,
      targetState: target.trainingGuard.stateHash, blockTimestamp: target.trainingGuard.blockTimestamp,
      supply: String(await read('totalSupply', [], blockNumber)), credits: String(target.credits),
      targetLearned: target.learned, wallets: walletStates };
  }
  const fingerprint = value => serial([value.sourceEpoch, value.targetEpoch, value.sourceOwner, value.targetOwner,
    value.targetState, value.supply, value.wallets]);
  function eligible(value) {
    if (!same(value.sourceOwner, owner) || !same(value.targetOwner, owner)) throw Error('OWNERSHIP_CHANGED');
    if (BigInt(value.supply) <= 1111n) throw Error('SUPPLY_FLOOR_REACHED');
    if (value.wallets.some(entry => BigInt(entry.nativeWei) !== 0n || !same(entry.owner, owner))) throw Error('FIXTURE_WALLET_NOT_EMPTY');
    if (value.targetLearned.length) throw Error('FRESH_TRAINING_PUNK_REQUIRED');
  }
  async function prepare(input) {
    if (!exact(input, ['sourceTokenId', 'targetTokenId']) || input.sourceTokenId !== 7 || input.targetTokenId !== 44) throw Error('FIXED_PRACTICE_PUNKS_REQUIRED');
    if (preparing || record && !['CANCELED', 'EXPIRED', 'REVERTED'].includes(record.status)) throw Error('REVIEW_ALREADY_EXISTS');
    preparing = true;
    try {
      const before = await state(); eligible(before);
      const deadline = Math.min(Math.floor(now() / 1000) + 60, Number(before.blockTimestamp) + 60);
      if (deadline * 1000 <= now()) throw Error('REVIEW_EXPIRED');
      const data = encodeFunctionData({ abi: burnAbi, functionName: 'sacrifice', args: [7n, 44n, before.targetState,
        BigInt(before.sourceEpoch), BigInt(before.targetEpoch), BigInt(deadline)] });
      const call = { account: owner, to: source, data, value: 0n };
      await client.call(call);
      const [estimate, gasPrice, nonce, latestNonce] = await Promise.all([client.estimateGas(call), client.getGasPrice(),
        client.getTransactionCount({ address: owner, blockTag: 'pending' }), client.getTransactionCount({ address: owner, blockTag: 'latest' })]);
      const gas = (estimate * 120n + 99n) / 100n;
      if (gas > 500_000n || gasPrice <= 0n || nonce !== latestNonce) throw Error('GAS_OR_PENDING_TRANSACTION');
      if (fingerprint(await state()) !== fingerprint(before)) throw Error('REVIEW_STATE_CHANGED');
      const review = { intentId: randomBytes(32).toString('hex'), ...before, deadline,
        creditGain: 1, nextSkill: 'Contract Detective', nextSkillCost: 1,
        currentSkillLevel: 0, resultingSkillLevel: 1,
        maximumNetworkFeeWei: String(gas * gasPrice),
        transaction: { from: owner, to: source, data, value: '0x0', chainId: '0x7a69',
          nonce: `0x${nonce.toString(16)}`, gas: `0x${gas.toString(16)}`, gasPrice: `0x${gasPrice.toString(16)}` } };
      record = { status: 'PREPARED', review, transactionHash: null };
      return record;
    } finally { preparing = false; }
  }
  async function reconcile() {
    const entry = record;
    if (!entry) return null;
    if (entry.status === 'PREPARED' && now() > entry.review.deadline * 1000) entry.status = 'EXPIRED';
    if (!entry.transactionHash) return entry;
    await guard();
    // Never retry a send. A missing/reorganized receipt keeps the review unresolved.
    entry.status = 'SUBMITTED';
    try {
      const receipt = await client.getTransactionReceipt({ hash: entry.transactionHash });
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      const transaction = await client.getTransaction({ hash: entry.transactionHash });
      const expected = entry.review.transaction;
      if (!same(receipt.blockHash, block.hash) || !same(transaction.blockHash, block.hash)
        || !same(receipt.transactionHash, entry.transactionHash) || !same(transaction.from, owner)
        || !same(transaction.to, source) || transaction.input !== expected.data || transaction.value !== 0n
        || transaction.nonce !== Number(BigInt(expected.nonce)) || transaction.gas !== BigInt(expected.gas)
        || transaction.gasPrice !== BigInt(expected.gasPrice) || receipt.gasUsed > BigInt(expected.gas)) throw Error('RECEIPT_MISMATCH');
      if (receipt.status === 'reverted') { entry.status = 'REVERTED'; return entry; }
      const events = (address, abi) => receipt.logs.filter(log => same(log.address, address)).flatMap(log => {
        try { return [decodeEventLog({ abi, data: log.data, topics: log.topics })]; } catch { return []; }
      });
      const burns = events(collection, collectionAbi).filter(event => event.eventName === 'Transfer'
        && event.args.tokenId === 7n && same(event.args.from, owner) && same(event.args.to, zeroAddress));
      const credits = events(progression, progressionAbi).filter(event => event.eventName === 'TrainingCreditEarned'
        && event.args.tokenId === 44n && event.args.sacrificedTokenId === 7n);
      if (receipt.status !== 'success' || burns.length !== 1 || credits.length !== 1) throw Error('BURN_OR_CREDIT_EVENT_MISSING');
      const credited = await client.readContract({ address: progression, abi: progressionAbi,
        functionName: 'sacrificeCredited', args: [7n], blockNumber: receipt.blockNumber });
      if (!credited || !same(await read('ownerOf', [44n], receipt.blockNumber), owner)
        || await read('totalSupply', [], receipt.blockNumber) !== BigInt(entry.review.supply) - 1n) throw Error('CREDIT_OR_SUPPLY_MISMATCH');
      entry.status = 'CONFIRMED'; entry.blockNumber = String(receipt.blockNumber); entry.blockHash = receipt.blockHash;
    } catch { entry.status = 'SUBMITTED'; }
    return entry;
  }
  async function confirm(input) {
    if (!exact(input, ['intentId', 'typedConfirmation', 'acknowledgeAccessLoss']) || input.typedConfirmation !== 'BURN 7'
      || input.acknowledgeAccessLoss !== true || input.intentId !== record?.review.intentId) throw Error('EXPLICIT_BURN_CONFIRMATION_REQUIRED');
    if (record.status !== 'PREPARED') return reconcile();
    record.status = 'CHECKING';
    try {
      if (now() > record.review.deadline * 1000) throw Error('REVIEW_EXPIRED');
      const latest = await state(); eligible(latest);
      if (fingerprint(latest) !== fingerprint(record.review)) throw Error('REVIEW_STATE_CHANGED');
      const transaction = record.review.transaction;
      const [nonce, latestNonce, balance] = await Promise.all([client.getTransactionCount({ address: owner, blockTag: 'pending' }),
        client.getTransactionCount({ address: owner, blockTag: 'latest' }), client.getBalance({ address: owner })]);
      if (nonce !== Number(BigInt(transaction.nonce)) || nonce !== latestNonce || balance < BigInt(record.review.maximumNetworkFeeWei)) throw Error('NONCE_OR_BALANCE_CHANGED');
      await client.call({ account: owner, to: source, data: transaction.data, value: 0n,
        gas: BigInt(transaction.gas), gasPrice: BigInt(transaction.gasPrice) });
      record.status = 'SUBMISSION_UNKNOWN';
      record.transactionHash = await wallet.sendTransaction({ account: owner, to: source, data: transaction.data, value: 0n,
        gas: BigInt(transaction.gas), gasPrice: BigInt(transaction.gasPrice), nonce, chain: null });
      return reconcile();
    } catch (error) {
      if (record.status === 'CHECKING') record.status = 'EXPIRED';
      throw error;
    }
  }
  function cancel(input) {
    if (!exact(input, ['intentId']) || input.intentId !== record?.review.intentId || record.status !== 'PREPARED') throw Error('CANNOT_CANCEL_SUBMITTED_BURN');
    record.status = 'CANCELED'; return record;
  }
  return { prepare, confirm, cancel, status: reconcile, snapshot: async () => ({ ...await state(), record: await reconcile() }) };
}
