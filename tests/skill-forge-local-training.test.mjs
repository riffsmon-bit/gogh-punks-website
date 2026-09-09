import test from 'node:test';
import assert from 'node:assert/strict';
import { startPreview } from '../scripts/dev/skill-forge/preview-server.mjs';

test('local training permits only nonce-bound fixed actions on owned disposable fixtures', { timeout: 60000 }, async t => {
  const preview = await startPreview(); t.after(() => preview.close());
  const read = async () => (await fetch(`${preview.url}/api/forge?tokenId=1`)).json();
  let data = await read();
  const post = (body, headers = {}) => fetch(`${preview.url}/api/local-training`, { method: 'POST', headers: { origin: preview.url, 'content-type': 'application/json', 'x-forge-nonce': data.localTrainingNonce, ...headers }, body: JSON.stringify({ tokenId: 1, expectedBlock: data.blockNumber, ...body }) });
  assert.equal((await post({ operation: 'unlock' }, { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post({ operation: 'unlock' }, { 'x-forge-nonce': 'invalid' })).status, 403);
  assert.equal((await post({ operation: 'unlock', tokenId: 93 })).status, 409);
  assert.equal((await post({ operation: 'sacrifice' })).status, 409);
  assert.equal((await post({ operation: 'unlock', to: '0x1234' })).status, 409);
  assert.equal((await post({ operation: 'learn', key: data.skills.find(s => s.id === 8).key })).status, 409);
  assert.equal((await read()).credits, '1');
  const previousBlock = data.blockNumber;
  const unlocked = await (await post({ operation: 'unlock' })).json();
  assert.equal(unlocked.localOnly, true); assert.equal(unlocked.productionAuthority, false);
  assert.match(unlocked.transactionHash, /^0x[0-9a-f]{64}$/);
  assert.equal(unlocked.snapshot.slots, 3); assert.equal(unlocked.snapshot.credits, '0');
  assert.equal((await post({ operation: 'unlock', expectedBlock: previousBlock })).status, 409);
  data = await read();
  assert.equal((await post({ operation: 'unlock' })).status, 409);
  const rarity = data.skills.find(s => s.id === 4);
  const equipped = await (await post({ operation: 'equip', slot: 2, key: rarity.key })).json();
  assert.equal(equipped.snapshot.equipped[2], rarity.key);
  data = equipped.snapshot;
  assert.equal((await post({ operation: 'equip', slot: 3, key: rarity.key })).status, 409);
  const removed = await (await post({ operation: 'unequip', slot: 2 })).json();
  assert.match(removed.snapshot.equipped[2], /^0x0+$/);
  assert.equal(removed.snapshot.canBurn, false);
});

test('learning a supported local fixture spends exactly one credit; roadmap skills cannot be learned', { timeout: 60000 }, async t => {
  const preview = await startPreview(); t.after(() => preview.close());
  const data = await (await fetch(`${preview.url}/api/forge?tokenId=1`)).json();
  const key = data.skills.find(s => s.id === 2).key;
  const response = await fetch(`${preview.url}/api/local-training`, { method: 'POST', headers: { origin: preview.url, 'content-type': 'application/json', 'x-forge-nonce': data.localTrainingNonce }, body: JSON.stringify({ tokenId: 1, expectedBlock: data.blockNumber, operation: 'learn', key }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.snapshot.credits, '0');
  assert.equal(result.snapshot.learned.length, 3);
  assert.equal(result.snapshot.equipped.includes(key), false);
  assert.equal(result.snapshot.history.filter(e => e.name === 'SkillLearned' && e.args.key === key).length, 1);
});
