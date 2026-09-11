import test from 'node:test';
import assert from 'node:assert/strict';
import deployment from '../deployments/robinhood-epoch-proposal.json' with { type: 'json' };
import { createEpochProfileHandler } from '../netlify/functions/broker-v2-epoch.mjs';
import { PublicError } from '../netlify/functions/_shared/http.mjs';
const alice = '0x1111111111111111111111111111111111111111';
const request = (path, options) => new Request(`https://goghpunks.xyz/api/v2/epoch/${path}`, options);
test('undeployed roster is explicit and requires neither credentials nor RPC', async () => {
  const handler = createEpochProfileHandler({ getPool: () => { throw Error('NO_DATABASE'); } });
  const response = await handler(request(`roster?owner=${alice}`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, enabled: false, complete: true, owner: alice,
    tokenIds: [], wrapper: null, readOnly: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await handler(request('punks/93'))).status, 503);
});
test('endpoint rejects mutations, invalid identifiers and caller configuration', async () => {
  const handler = createEpochProfileHandler();
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await handler(request('punks/93', { method }))).status, 405);
  for (const query of ['', `owner=${alice}&wrapper=${alice}`, `owner=${alice}&owner=${alice}`, 'owner=no']) {
    assert.equal((await handler(request(`roster?${query}`))).status, 400);
  }
  assert.equal((await handler(request('punks/093'))).status, 404);
  assert.equal((await handler(request('punks/93?chain=1'))).status, 400);
});
test('authenticated wallet must still be current receipt owner; errors leak no RPC detail', async () => {
  const deps = { deployment: { ...deployment, status: 'DEPLOYED' }, client: {}, getPool: () => ({}),
    requireSession: async () => ({ walletAddress: alice }) };
  let calls = 0;
  const handler = createEpochProfileHandler({ ...deps, readProfile: async args => {
    ++calls; assert.equal(args.expectedOwner, alice); assert.equal(args.tokenId, '93');
    throw Object.assign(Error('private upstream URL'), { code: 'NOT_CURRENT_OWNER' });
  } });
  assert.equal((await handler(request('punks/93'))).status, 403); assert.equal(calls, 1);
  const denied = createEpochProfileHandler({ ...deps, requireSession: async () => {
    throw new PublicError(401, 'SIGN_IN_REQUIRED', 'Sign in.');
  }, readProfile: async () => { throw Error('MUST_NOT_READ'); } });
  assert.equal((await denied(request('punks/93'))).status, 401);
  const failed = createEpochProfileHandler({ ...deps, readProfile: async () => { throw Error('secret URL'); } });
  const response = await failed(request('punks/93')); assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret URL/);
});
test('even a ready manifest cannot unlock enrollment or create transaction authority', async () => {
  const handler = createEpochProfileHandler({ deployment: { ...deployment, status: 'DEPLOYED' }, client: {}, getPool: () => ({}),
    requireSession: async () => ({ walletAddress: alice }), readProfile: async () => ({ tokenId: '93',
      authorityEpoch: 'fixture:1:0', readiness: { ownerSetupReady: true } }) });
  const result = await (await handler(request('punks/93'))).json();
  assert.equal(result.enrollment.canSubmit, false); assert.equal(result.readOnly, true);
  assert.equal(result.economicPermissionsActivated, false);
  assert.ok(result.enrollment.blockers.includes('LEGACY_INVENTORY_NOT_VERIFIED'));
  assert.equal(result.transaction, undefined);
});
