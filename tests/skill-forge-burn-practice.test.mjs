import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeEventTopics, parseAbi, zeroAddress } from 'viem';
import { createBurnPractice } from '../scripts/dev/skill-forge/burn-practice.mjs';

const address = n => `0x${n.repeat(40)}`, hash = n => `0x${n.repeat(64)}`;
const owner = address('1'), collection = address('2'), source = address('3'), progression = address('4');
const timestamp = 1800000000;
const eventAbi = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
  'event TrainingCreditEarned(uint256 indexed tokenId,uint256 indexed sacrificedTokenId)']);
function fixture() {
  let sends = 0, sent, fault = '', receiptMissing = false, unknownSend = false;
  const client = {
    getChainId: async () => 31337, request: async () => 'anvil/v1',
    readContract: async ({ functionName }) => ({ owner: sends ? zeroAddress : owner, ownershipEpoch: 1n,
      totalSupply: sends ? 1118n : 1119n, sacrificeCredited: true, ownerOf: owner })[functionName],
    getBalance: async ({ address: target }) => target === owner ? 10n ** 18n : 0n,
    call: async () => ({}), estimateGas: async () => 100000n, getGasPrice: async () => 10n,
    getTransactionCount: async () => sends,
    getBlock: async () => ({ hash: fault === 'reorg' ? hash('e') : hash('a') }),
    getTransaction: async () => ({ from: owner, to: fault === 'destination' ? owner : source,
      blockHash: hash('a'), input: fault === 'calldata' ? '0x1234' : sent.data, value: fault === 'value' ? 1n : 0n,
      nonce: sent.nonce, gas: sent.gas, gasPrice: fault === 'fee' ? sent.gasPrice + 1n : sent.gasPrice }),
    getTransactionReceipt: async () => {
      if (receiptMissing) throw Error('RECEIPT_MISSING');
      const logs = [
        { address: collection, data: '0x', topics: encodeEventTopics({ abi: eventAbi, eventName: 'Transfer', args: {
          from: owner, to: zeroAddress, tokenId: fault === 'wrong-source' ? 44n : 7n } }) },
        { address: progression, data: '0x', topics: encodeEventTopics({ abi: eventAbi, eventName: 'TrainingCreditEarned', args: {
          tokenId: fault === 'wrong-recipient' ? 7n : 44n, sacrificedTokenId: 7n } }) },
      ];
      if (fault === 'missing-credit') logs.pop();
      if (fault === 'duplicate-burn') logs.push(logs[0]);
      return { transactionHash: hash('b'), blockHash: hash('a'), blockNumber: 10n,
        gasUsed: 100000n, status: fault === 'reverted' ? 'reverted' : 'success', logs };
    },
  };
  const coordinator = createBurnPractice({ client, owner, collection, source, progression,
    now: () => timestamp * 1000, wallets: [{ role: 'mock', address: address('5') }],
    snapshot: async () => ({ blockNumber: 10n, blockHash: hash('a'), owner, credits: sends ? 1n : 0n,
      learned: [], trainingGuard: { stateHash: hash('c'), blockTimestamp: String(timestamp) } }),
    wallet: { sendTransaction: async transaction => { sends++; sent = transaction;
      if (unknownSend) throw Error('HASH_RESPONSE_LOST'); return hash('b'); } } });
  return { coordinator, get sends() { return sends; }, fault: value => { fault = value; },
    hideReceipt: value => { receiptMissing = value; }, loseHash: () => { unknownSend = true; } };
}
const prepare = fixture => fixture.coordinator.prepare({ sourceTokenId: 7, targetTokenId: 44 });
const confirm = (fixture, entry) => fixture.coordinator.confirm({ intentId: entry.review.intentId,
  typedConfirmation: 'BURN 7', acknowledgeAccessLoss: true });

for (const fault of ['reorg', 'destination', 'calldata', 'value', 'fee', 'wrong-source', 'wrong-recipient', 'missing-credit', 'duplicate-burn']) {
  test(`burn receipt stays unresolved for ${fault}; recheck never sends again`, async () => {
    const world = fixture(), entry = await prepare(world); world.fault(fault);
    assert.equal((await confirm(world, entry)).status, 'SUBMITTED');
    assert.equal((await confirm(world, entry)).status, 'SUBMITTED'); assert.equal(world.sends, 1);
    world.fault(''); assert.equal((await world.coordinator.status()).status, 'CONFIRMED'); assert.equal(world.sends, 1);
  });
}
test('missing hash leaves a permanent attempted marker on this disposable deployment', async () => {
  const world = fixture(), entry = await prepare(world); world.loseHash();
  await assert.rejects(confirm(world, entry), /HASH_RESPONSE_LOST/);
  assert.equal((await confirm(world, entry)).status, 'SUBMISSION_UNKNOWN');
  await assert.rejects(prepare(world), /REVIEW_ALREADY_EXISTS/); assert.equal(world.sends, 1);
});
test('confirmed burn becomes unresolved if its canonical receipt disappears', async () => {
  const world = fixture(), entry = await prepare(world);
  assert.equal((await confirm(world, entry)).status, 'CONFIRMED');
  world.hideReceipt(true); assert.equal((await world.coordinator.status()).status, 'SUBMITTED');
  world.hideReceipt(false); assert.equal((await world.coordinator.status()).status, 'CONFIRMED'); assert.equal(world.sends, 1);
});
test('a canonical reverted transaction never confirms a burn or resends on confirmation', async () => {
  const world = fixture(), entry = await prepare(world); world.fault('reverted');
  assert.equal((await confirm(world, entry)).status, 'REVERTED');
  assert.equal((await confirm(world, entry)).status, 'REVERTED'); assert.equal(world.sends, 1);
});
