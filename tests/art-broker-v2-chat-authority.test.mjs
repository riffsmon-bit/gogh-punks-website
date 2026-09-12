import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readV2ChatAuthority, assertV2ChatAuthorityUnchanged } from '../netlify/functions/_shared/v2-ownership.mjs';
const owner = '0x1111111111111111111111111111111111111111', other = '0x2222222222222222222222222222222222222222';
const account = '0x3333333333333333333333333333333333333333';
const hash = `0x${'a'.repeat(64)}`;
test('chat, profile and MCP strategy reads are scoped to the authenticated owner', async () => {
  for (const name of ['chat', 'punk', 'mcp']) {
    const source = await readFile(new URL(`../netlify/functions/broker-v2-${name}.mjs`, import.meta.url), 'utf8');
    assert.match(source, /configured_by = \$4 AND intent->>'expectedOwner' = \$4/);
    assert.match(source, /(?:session|principal).walletAddress/);
  }
});
test('buyer roster retains Punk progression but cannot inherit the seller active strategy pointer', async () => {
  const source = await readFile(new URL('../netlify/functions/broker-v2-punks.mjs', import.meta.url), 'utf8');
  assert.match(source, /strategy.configured_by = \$4 AND strategy.intent->>'expectedOwner' = \$4/);
  assert.match(source, /strategy.version AS active_strategy_version/);
  assert.match(source, /ownership.tokenIds, session.walletAddress/);
  assert.match(source, /profile.broker_level/);
});
function rpc(overrides = {}) { return { getBlockNumber: async () => 101n,
  getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash }),
  readContract: async ({ functionName }) => ({ ownerOf: owner, account, isAccountCreated: true })[functionName],
  getCode: async () => '0x6000', getBalance: async () => 0n, getLogs: async () => [], ...overrides }; }
test('chat anchors original ownership and rechecks it before persistence', async () => {
  const before = await readV2ChatAuthority('93', { expectedOwner: owner, client: rpc() });
  assert.equal(before.blockHash, hash);
  const after = await assertV2ChatAuthorityUnchanged(before, { client: rpc({ getBlockNumber: async () => 103n }) });
  assert.equal(after.owner, owner); assert.equal(after.blockNumber, '103');
});
test('chat rejects transfer away, round trip, reorg, unknown logs and excessive read windows', async () => {
  const before = await readV2ChatAuthority('93', { expectedOwner: owner, client: rpc() });
  for (const changes of [
    { readContract: async ({ functionName }) => ({ ownerOf: other, account, isAccountCreated: true })[functionName] },
    { getLogs: async () => [{}, {}] }, { getLogs: async () => null },
    { getBlockNumber: async () => 2000n }, { getBlockNumber: async () => 99n },
    { getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash: `0x${'b'.repeat(64)}` }) },
  ]) await assert.rejects(assertV2ChatAuthorityUnchanged(before, { client: rpc(changes) }));
});
