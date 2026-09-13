import test from 'node:test';
import assert from 'node:assert/strict';
import extension from '../docs/v2-hardening/forge-source-history-extension.json' with { type: 'json' };
import { validateSourceHistoryExtension, scanSelectedSourceStandardTransfers } from '../broker/src/v4/skill-forge/selected-burn-source.mjs';
test('pinned source-history extension retains original coverage and rejects tampered empty claims', () => {
  assert.equal(validateSourceHistoryExtension().number, extension.anchor.number);
  for (const alter of [x => x.ranges.pop(), x => x.ranges[0].count = 1, x => x.wallets.pop(), x => x.anchor.hash = `0x${'0'.repeat(64)}`]) {
    const changed = structuredClone(extension); alter(changed);
    assert.throws(() => validateSourceHistoryExtension(changed), /BURN_HISTORY_EXTENSION_INVALID/);
  }
});
test('incremental history uses bounded 2000-block windows with complete coverage for all standards', async () => {
  const calls = []; let active = 0, maximum = 0;
  await scanSelectedSourceStandardTransfers({ request: async value => {
    calls.push(value); active++; maximum = Math.max(active, maximum);
    await new Promise(r => setTimeout(r, 1)); active--; return [];
  } }, 10n, 4010n);
  assert.equal(calls.length, 12); assert.ok(maximum <= 6);
  const standards = new Map();
  for (const call of calls) {
    assert.equal(call.method, 'eth_getLogs'); const filter = call.params[0];
    assert.equal(filter.topics.at(-1).length, 4);
    const range = [BigInt(filter.fromBlock), BigInt(filter.toBlock)];
    assert.ok(range[1] - range[0] < 2000n);
    const list = standards.get(filter.topics[0]) ?? []; list.push(range); standards.set(filter.topics[0], list);
  }
  assert.equal(standards.size, 4);
  for (const ranges of standards.values()) assert.deepEqual(ranges, [[10n,2009n],[2010n,4009n],[4010n,4010n]]);
});
test('any asset result, malformed response or rejected historical read prevents clearance', async () => {
  for (const result of [[{}], null]) await assert.rejects(scanSelectedSourceStandardTransfers({ request: async () => result }, 1n, 1n), /BURN_SOURCE_TOKEN_RECEIPT_FOUND/);
  await assert.rejects(scanSelectedSourceStandardTransfers({ request: async () => { throw Error('READ_UNAVAILABLE'); } }, 1n, 1n), /READ_UNAVAILABLE/);
  let calls = 0;
  await assert.rejects(scanSelectedSourceStandardTransfers({ request: async () => { calls++; return []; } }, 1n, 4_000_000n), /BURN_HISTORY_REFRESH_REQUIRED/);
  assert.equal(calls, 0);
});
