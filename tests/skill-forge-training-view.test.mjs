import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTrainingSnapshot, validateTrainingRecovery } from '../site/forge-training.js';
const address = `0x${'1'.repeat(40)}`, hash = `0x${'2'.repeat(64)}`, key = `0x${'3'.repeat(64)}`;
const makeState = () => ({ localOnly: true, chainId: 31337, canBurn: false, productionReadyCount: 0,
  tokenId: 1, owner: address, progression: address, collection: address, registry: address,
  localTrainingNonce: '4'.repeat(64), ownershipEpoch: `${hash}:${hash}:0`, blockHash: hash, blockNumber: '20',
  credits: '1', slots: 1, cap: 7, learned: [{ key, level: 1 }], equipped: [key],
  skills: [{ id: 3, key, name: 'Contract Detective' }],
  history: [{ name: 'SkillLearned', transactionHash: hash, blockNumber: '19', args: { tokenId: '1' } }],
  capabilityContext: { tokenId: '1', owner: address, walletAuthority: 'NONE', blockHash: hash,
    effectiveMcpTools: ['inspect_contract'], instructionPackages: [{ key }], requiresSeparateEconomicAuthorization: true } });
const makeRecovery = () => ({ localOnly: true, chainId: 31337, productionAuthority: false,
  tokenId: 1, owner: address, progression: address, records: [{ intentId: '5'.repeat(64), tokenId: 1,
    owner: address, progression: address, chainId: 31337, status: 'SUBMITTED', transactionHash: hash, recoveryOnly: true }] });
test('training view accepts internally consistent disposable progression and recovery', () => {
  const state = makeState(); assert.equal(validateTrainingSnapshot(state, 1), state);
  const recovery = makeRecovery(); assert.equal(validateTrainingRecovery(recovery, state), recovery);
});
for (const [name, alter] of Object.entries({
  'missing collection': s => delete s.collection,
  'missing epoch': s => delete s.ownershipEpoch,
  'invalid nonce': s => s.localTrainingNonce = 'bad',
  'negative credit': s => s.credits = '-1',
  'overflow credit': s => s.credits = (2n ** 256n).toString(),
  'duplicate skill key': s => s.skills.push({ ...s.skills[0] }),
  'duplicate learned key': s => s.learned.push({ ...s.learned[0] }),
  'unknown learned key': s => s.learned[0].key = hash,
  'zero skill level': s => s.learned[0].level = 0,
  'unlearned equipment': s => s.learned = [],
  'duplicate equipment': s => { s.slots = 2; s.equipped.push(key); },
  'different capability block': s => s.capabilityContext.blockHash = key,
  'spend authority': s => s.capabilityContext.walletAuthority = 'SPEND',
  'unknown tool': s => s.capabilityContext.effectiveMcpTools.push('eth_sendTransaction'),
  'unequipped instructions': s => s.capabilityContext.instructionPackages[0].key = hash,
  'wrong token history': s => s.history[0].args.tokenId = '44',
  'future history': s => s.history[0].blockNumber = '21',
})) test(`training view rejects ${name}`, () => {
  const state = makeState(); alter(state); assert.throws(() => validateTrainingSnapshot(state, 1));
});
for (const [name, alter] of Object.entries({
  'wrong owner': r => r.owner = `0x${'6'.repeat(40)}`,
  'wrong record chain': r => r.records[0].chainId = 4663,
  'unknown status': r => r.records[0].status = 'READY_TO_SEND',
  'missing submitted hash': r => r.records[0].transactionHash = null,
  'malformed hash': r => r.records[0].transactionHash = '0x123',
  'duplicate intent': r => r.records.push({ ...r.records[0] }),
  'multiple unresolved intents': r => r.records.push({ ...r.records[0], intentId: '7'.repeat(64) }),
  'arbitrary recovered token': r => r.records[0].tokenId = 93,
  'missing recovery-only boundary': r => r.records[0].recoveryOnly = false,
})) test(`training view rejects recovery with ${name}`, () => {
  const recovery = makeRecovery(); alter(recovery); assert.throws(() => validateTrainingRecovery(recovery, makeState()));
});
