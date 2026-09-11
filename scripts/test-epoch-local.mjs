import assert from 'node:assert/strict';
import { startEpochWorld } from './dev/epoch/local-world.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--local-only') throw Error('Requires --local-only');
const world = await startEpochWorld();
try {
  await assert.rejects(world.action('inspect'), /SKILL_TOOL_DENIED/);
  await world.action('wrap'); await world.action('create'); await world.action('learn');
  await assert.rejects(world.action('authorize'));
  await assert.rejects(world.action('inspect'), /SKILL_TOOL_DENIED/);
  await world.action('equip');
  assert.equal((await world.action('inspect')).result.walletAuthority, 'NONE');
  await world.action('authorize'); await world.action('save');
  assert.equal((await world.state()).active, true);
  await world.action('transfer');
  await assert.rejects(world.gate.resolve({ tokenId: '93', owner: world.alice }), /OWNER_CHANGED/);
  assert.equal((await world.gate.resolve({ tokenId: '93', owner: world.bob })).owner, world.bob);
  await world.action('transfer');
  assert.equal((await world.state()).owner, world.alice);
  assert.equal((await world.state()).epoch, '3');
  assert.equal((await world.state()).active, false);
  await assert.rejects(world.action('replay'));
  await world.action('authorize'); await assert.rejects(world.action('replay'));
  await world.action('mint'); assert.equal((await world.state()).mints, '1');
  await world.action('unequip'); await assert.rejects(world.action('mint'));
  await assert.rejects(world.action('inspect'), /SKILL_TOOL_DENIED/);
  await world.action('equip'); await world.action('pause'); await assert.rejects(world.action('mint'));
  await world.action('resume'); assert.equal((await world.state()).active, false);
  await world.action('authorize'); await world.action('unwrap');
  assert.equal((await world.state()).active, false);
  assert.equal((await world.state()).credits, '1');
  assert.equal((await world.state()).learned[0], 1);
  await world.action('wrap'); assert.equal((await world.state()).active, false);
  await world.action('authorize'); await world.action('mint');
  assert.equal((await world.state()).mints, '2');
  console.log(JSON.stringify({ result: 'PASS', environment: 'DISPOSABLE_ANVIL_ONLY',
    checks: ['wrap/create', 'credit/learn/equip', 'pinned Forge+MCP owner resolution', 'old owner denied',
      'signed operation round-trip rejected', 'old generation replay rejected', 'fresh-session fixture mints confirmed',
      'unequipped mint/research denied', 'emergency resume needs approval', 'unwrap/rewrap persistence'],
    confirmedLocalTransactions: world.history.length, productionTransactions: 0 }, null, 2));
} finally { await world.close(); }
