import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSupplyFloor } from '../broker/src/v4/skill-forge/supply-floor.mjs';
const evidence = { chainId: 4663, collection: '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6', totalSupply: '1112', checkedAt: 1000, blockHash: `0x${'11'.repeat(32)}` };
test('1112 permits one sacrifice by supply rule; 1111 or less permits none', () => {
  assert.equal(assessSupplyFloor(evidence, { now: 1000 }).headroom, '1');
  assert.equal(assessSupplyFloor(evidence, { now: 1000 }).allowedBySupplyRule, true);
  for (const totalSupply of ['1111', '1110', '0']) {
    const result = assessSupplyFloor({ ...evidence, totalSupply }, { now: 1000 });
    assert.equal(result.allowedBySupplyRule, false); assert.equal(result.headroom, '0');
  }
});
test('unknown, stale, wrong-chain, wrong-collection and malformed supply fail closed', () => {
  for (const override of [{ totalSupply: null }, { totalSupply: 1112 }, { totalSupply: '-1' }, { totalSupply: '1e6' },
    { totalSupply: String(2n ** 256n) }, { checkedAt: -30000 }, { checkedAt: 1001 }, { chainId: 1 }, { collection: '0x123' }, { collection: 123 }, { blockHash: null }]) {
    assert.equal(assessSupplyFloor({ ...evidence, ...override }, { now: 1000 }).allowedBySupplyRule, false);
  }
  assert.equal(assessSupplyFloor(undefined).allowedBySupplyRule, false);
});
