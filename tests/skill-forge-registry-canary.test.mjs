import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, keccak256 } from 'viem';
import { readFile } from 'node:fs/promises';
import { loadRegistryCanaryInputs, buildRegistryCanaryProposal, validateRegistryCanaryProposal,
  prepareRegistryCanaryLive, verifyRegistryCanary, EMPTY_GUARDIAN_CONTEXT } from '../broker/src/v4/skill-forge/registry-canary.mjs';
const inputs = await loadRegistryCanaryInputs();
const guardian = `0x${'1'.repeat(40)}`, hash = `0x${'2'.repeat(64)}`;
const anchor = { number: '12345', hash, timestamp: 1789000000 };
const make = () => buildRegistryCanaryProposal({ inputs, guardian, guardianContext: EMPTY_GUARDIAN_CONTEXT, nonce: '10', anchor });
test('registry-only packet pins actual source/build and three nonexecutable research definitions', () => {
  const p = make(); validateRegistryCanaryProposal(p, inputs);
  assert.equal(p.transactions.length, 8); assert.equal(p.trainingSource, null); assert.equal(p.progression, null);
  assert.equal(p.canBroadcast, false); assert.equal(p.productionBurnAuthorized, false); assert.equal(p.readySkills, 0);
  assert.deepEqual(p.pins.definitions.map(d => d.capabilities), ['1', '8', '4']);
  assert.ok(p.transactions.every(t => t.chainId === 4663 && t.value === '0'));
  assert.equal(p.transactions[0].to, null);
  assert.deepEqual(p.transactions.map(t => t.nonce), ['10', '11', '12', '13', '14', '15', '16', '17']);
  const decoded = p.transactions.slice(1).map(t => { assert.equal(t.to, p.registryPredicted); return decodeFunctionData({ abi: inputs.artifact.abi, data: t.data }); });
  assert.equal(decoded[0].functionName, 'setEmergencyControls');
  assert.deepEqual(decoded[0].args, [true, 2n ** 256n - 1n]);
  for (const call of decoded.filter(t => t.functionName === 'setStatus')) assert.equal(call.args[1], 3);
  assert.equal(decoded.filter(t => t.functionName === 'register').length, 3);
});
for (const [name, change] of Object.entries({
  'credit source': p => p.trainingSource = guardian,
  'progression': p => p.progression = guardian,
  'burn permission': p => p.productionBurnAuthorized = true,
  'training permission': p => p.productionTrainingAuthorized = true,
  'broadcast permission': p => p.canBroadcast = true,
  'guardian': p => p.guardianProposal = `0x${'3'.repeat(40)}`,
  'delegation pin': p => p.guardianContext.codeHash = hash,
  'wallet delegation change': p => p.transactions[0].authorizationList = [{ address: guardian }],
  'extra step': p => p.transactions.push(p.transactions[1]),
  'missing emergency disable': p => p.transactions[1].data = p.transactions[2].data,
  'NFT target': p => p.transactions[2].to = p.collection,
  'ETH value': p => p.transactions[0].value = '1',
  'chain': p => p.transactions[1].chainId = 1,
  'nonce': p => p.transactions[2].nonce = '99',
  'READY label': p => p.pins.definitions[0].status = 'READY',
  'mint permission': p => p.pins.definitions[0].capabilities = '2',
  'code hash': p => p.pins.runtimeCodeHash = hash,
  'weaker receipt threshold': p => p.requiredConfirmations = 0,
  'extra authority': p => p.allowBurn = true,
})) test(`registry proposal rejects ${name}`, () => {
  const p = structuredClone(make()); change(p); assert.throws(() => validateRegistryCanaryProposal(p, inputs));
});
test('proposal caller must supply a nonzero guardian, exact nonce and valid observation anchor', () => {
  for (const nonce of ['-1', '01', '1.5', String(Number.MAX_SAFE_INTEGER), '0x1']) assert.throws(() => buildRegistryCanaryProposal({ inputs, guardian, guardianContext: EMPTY_GUARDIAN_CONTEXT, nonce, anchor }));
  assert.throws(() => buildRegistryCanaryProposal({ inputs, guardian: `0x${'0'.repeat(40)}`, guardianContext: EMPTY_GUARDIAN_CONTEXT, nonce: '0', anchor }));
  assert.throws(() => buildRegistryCanaryProposal({ inputs, guardian, guardianContext: EMPTY_GUARDIAN_CONTEXT, nonce: '0', anchor: { ...anchor, timestamp: NaN } }));
});
test('read-only preparation rejects wrong chain, stale head and mismatching original collection code', async () => {
  await assert.rejects(prepareRegistryCanaryLive({ client: { getChainId: async () => 1 }, inputs, guardian }), /WRONG_CANARY_CHAIN/);
  const block = { number: 12345n, hash, timestamp: BigInt(anchor.timestamp) };
  const client = { getChainId: async () => 4663, getBlock: async () => block, getCode: async ({ address }) => address.toLowerCase() === guardian ? '0x' : '0x6000', getTransactionCount: async () => 10 };
  await assert.rejects(prepareRegistryCanaryLive({ client, inputs, guardian, now: anchor.timestamp * 1000 + 60001 }), /STALE_CANARY_HEAD/);
  await assert.rejects(prepareRegistryCanaryLive({ client, inputs, guardian, now: anchor.timestamp * 1000 }), /COLLECTION_CODE_CHANGED/);
});
test('receipt verifier rejects missing/duplicate receipts and a reorged anchor', async () => {
  const p = make();
  const client = { getChainId: async () => 4663, getBlock: async () => ({ number: 99999n, hash: `0x${'3'.repeat(64)}` }) };
  await assert.rejects(verifyRegistryCanary({ client, inputs, proposal: p, transactionHashes: [] }), /RECEIPT_SET/);
  await assert.rejects(verifyRegistryCanary({ client, inputs, proposal: p, transactionHashes: Array(8).fill(hash) }), /RECEIPT_SET/);
  await assert.rejects(verifyRegistryCanary({ client, inputs, proposal: p, transactionHashes: Array.from({ length: 8 }, (_, i) => `0x${String(i + 1).repeat(64)}`) }), /ANCHOR_REORG/);
});
test('production canary tool contains no wallet, signer, key loading or broadcast path', async () => {
  const script = await readFile(new URL('../scripts/prepare-forge-registry-canary.mjs', import.meta.url), 'utf8');
  const verifier = await readFile(new URL('../scripts/verify-forge-registry-canary.mjs', import.meta.url), 'utf8');
  const module = await readFile(new URL('../broker/src/v4/skill-forge/registry-canary.mjs', import.meta.url), 'utf8');
  for (const source of [script, verifier, module]) assert.doesNotMatch(source, /eth_send|sendTransaction|writeContract|createWalletClient|privateKeyToAccount|process\.env|dotenv|child_process/);
});
test('receipt verifier binds the review timestamp to its real canonical anchor', async () => {
  const p = make();
  const client = { getChainId: async () => 4663,
    getBlock: async () => ({ number: BigInt(anchor.number), hash: anchor.hash, timestamp: BigInt(anchor.timestamp) + 1n }) };
  const hashes = Array.from({ length: 8 }, (_, i) => `0x${String(i + 1).repeat(64)}`);
  await assert.rejects(verifyRegistryCanary({ client, inputs, proposal: p, transactionHashes: hashes }), /CANARY_ANCHOR_MISMATCH/);
});
test('existing EIP-7702 code is pinned without adding authorization transactions or claiming its security', () => {
  const delegation = `0x${'4'.repeat(40)}`;
  const context = { kind: 'EIP7702_DELEGATED_EOA', delegation, codeHash: keccak256(`0xef0100${delegation.slice(2)}`), delegationCodeHash: hash };
  const p = buildRegistryCanaryProposal({ inputs, guardian, guardianContext: context, nonce: '10', anchor });
  validateRegistryCanaryProposal(p, inputs);
  assert.ok(p.blockers.includes('EXISTING_GUARDIAN_DELEGATION_REVIEW_REQUIRED'));
  assert.equal(p.canBroadcast, false); assert.ok(p.transactions.every(t => !Object.hasOwn(t, 'authorizationList')));
  for (const altered of [{ ...context, delegation: guardian }, { ...context, kind: 'CONTRACT' }, { ...context, codeHash: hash }]) {
    assert.throws(() => buildRegistryCanaryProposal({ inputs, guardian, guardianContext: altered, nonce: '10', anchor }));
  }
});
