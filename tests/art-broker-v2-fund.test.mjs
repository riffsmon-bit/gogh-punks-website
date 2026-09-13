import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { handleV2Fund } from '../netlify/functions/broker-v2-fund.mjs';
import { defaultAskIntent } from '../broker/src/v4/collecting-intent.mjs';
import { ROBINHOOD } from '../broker/src/config.mjs';
import { PublicError } from '../netlify/functions/_shared/http.mjs';

const OWNER = `0x${'1'.repeat(40)}`, SELLER = `0x${'2'.repeat(40)}`;
const WALLET = `0x${'3'.repeat(40)}`, AGENT = `0x${'4'.repeat(40)}`;
let database, pool, reads, authority;
const request = (method = 'GET') => new Request('https://goghpunks.xyz/api/v2/punks/93/fund', { method });
before(async () => {
  database = new PGlite();
  for (const migration of ['20260817224000_create_art_broker_foundation.sql', '20260906010000_create_art_broker_v2.sql']) {
    await database.exec(await readFile(new URL(`../netlify/database/migrations/${migration}`, import.meta.url), 'utf8'));
  }
  pool = { query: (...args) => { reads++; return database.query(...args); } };
});
after(async () => { await database?.close(); });
beforeEach(async () => {
  await database.exec('TRUNCATE broker_punks CASCADE');
  await database.query(`INSERT INTO broker_punks (chain_id,collection_address,token_id,account_address,account_version,owner_snapshot)
    VALUES (4663,$1,93,$2,3,$3)`, [ROBINHOOD.canonicalCollection, WALLET, OWNER]);
  authority = { chainId: 4663, collection: ROBINHOOD.canonicalCollection, tokenId: '93',
    owner: OWNER, punkWallet: WALLET, activated: true, nativeBalanceWei: '9007199254740993123' };
  reads = 0;
});
async function insert({ version = 1, configuredBy = OWNER, state = 'ACTIVE', intentChanges = {},
  expiresAt = new Date(Date.now() + 86_400_000).toISOString() } = {}) {
  const intent = { ...defaultAskIntent({ punkTokenId: '93', expectedOwner: OWNER, punkWallet: WALLET }),
    minimumReserveWei: '9007199254740993', ...intentChanges };
  await database.query(`INSERT INTO broker_v2_strategies
    (chain_id,collection_address,token_id,version,schema_name,intent_hash,intent,state,configured_by,
      ownership_block,owner_confirmation_hash,expires_at,activated_at)
    VALUES (4663,$1,93,$2,'PUNK_COLLECTING_INTENT_V1',$3,$4,$5,$6,100,$7,$8,NOW())`,
  [ROBINHOOD.canonicalCollection, version, `0x${BigInt(version).toString(16).padStart(64, '0')}`, JSON.stringify(intent),
    state, configuredBy, `0x${'a'.repeat(64)}`, expiresAt]);
}
async function response(options = {}) {
  return handleV2Fund(request(), { pool, requireSession: async () => ({ walletAddress: OWNER }),
    readAuthority: async (tokenId, { expectedOwner }) => {
      assert.equal(tokenId, '93');
      if (authority.owner !== expectedOwner) throw new PublicError(403, 'NOT_CURRENT_OWNER', 'Ownership changed.');
      return authority;
    }, ...options });
}
async function payload(options) {
  const result = await response(options);
  const body = await result.json(); assert.equal(result.status, 200, JSON.stringify(body)); return body;
}

test('fund endpoint uses exact integer reserve and available balance from this owner and V3 wallet', async () => {
  await insert();
  const result = await response(), body = await result.json();
  assert.equal(body.minimumReserveWei, '9007199254740993');
  assert.equal(body.availableBudgetWei, '8998192055486252130');
  assert.equal(body.destination, WALLET);
  assert.equal(body.transactionPrepared, false);
  assert.equal(body.projectCustody, false);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(reads, 1);
});
for (const [name, row] of [
  ['seller configured strategy', { configuredBy: SELLER }],
  ['seller intent owner', { intentChanges: { expectedOwner: SELLER } }],
  ['separate Agent wallet', { intentChanges: { punkWallet: AGENT } }],
  ['other Punk', { intentChanges: { punkTokenId: '94' } }],
  ['other chain', { intentChanges: { chainId: 1 } }],
  ['string chain identifier', { intentChanges: { chainId: '4663' } }],
  ['expired row', { expiresAt: new Date(0).toISOString() }],
  ['paused strategy', { state: 'PAUSED' }],
  ['draft strategy', { state: 'DRAFT' }],
]) test(`actual PostgreSQL excludes ${name} from the current reserve`, async () => {
  await insert(row);
  const body = await payload();
  assert.equal(body.minimumReserveWei, '0');
  assert.equal(body.availableBudgetWei, authority.nativeBalanceWei);
});
test('latest eligible strategy wins without newer seller, wallet or expired residue', async () => {
  await insert({ version: 1, intentChanges: { minimumReserveWei: '100' } });
  await insert({ version: 2, intentChanges: { minimumReserveWei: '200' } });
  await insert({ version: 3, configuredBy: SELLER });
  await insert({ version: 4, intentChanges: { punkWallet: AGENT } });
  await insert({ version: 5, expiresAt: new Date(0).toISOString() });
  assert.equal((await payload()).minimumReserveWei, '200');
});
test('new owner does not inherit seller reserve; wallet and asset balance remain stable', async () => {
  await insert({ configuredBy: SELLER, intentChanges: { expectedOwner: SELLER } });
  const body = await payload();
  assert.equal(body.nativeBalanceWei, authority.nativeBalanceWei);
  assert.equal(body.destination, WALLET);
  assert.equal(body.minimumReserveWei, '0');
});
test('fresh inactive V3 still exposes its known destination and zero budget without requiring activation', async () => {
  authority.activated = false; authority.nativeBalanceWei = '0';
  const body = await payload();
  assert.equal(body.destination, WALLET);
  assert.equal(body.minimumReserveWei, '0');
  assert.equal(body.availableBudgetWei, '0');
});
test('available budget floors at zero when reserve equals or exceeds current balance', async () => {
  await insert();
  for (const balance of ['9007199254740993', '5', '0']) {
    authority.nativeBalanceWei = balance;
    assert.equal((await payload()).availableBudgetWei, '0');
  }
});
test('malformed or expired intent cannot produce an apparently spendable balance', async () => {
  for (const intentChanges of [{ minimumReserveWei: '-1' }, { minimumReserveWei: '1e8' },
    { expiration: new Date(0).toISOString() }, { minimumReserveWei: null },
    { minimumReserveWei: 9007199254740992 }, { minimumReserveWei: (2n ** 256n).toString() }]) {
    await database.exec('TRUNCATE broker_v2_strategies');
    await insert({ intentChanges });
    const result = await response(), body = await result.json();
    assert.equal(result.status, 503);
    assert.equal(body.code, 'FUND_RULES_UNAVAILABLE');
    assert.equal(Object.hasOwn(body, 'availableBudgetWei'), false);
  }
});
test('unauthenticated or former owner cannot read reserve/balance from this endpoint', async () => {
  await insert();
  const denied = await response({ requireSession: async () => { throw new PublicError(401, 'AUTH_REQUIRED', 'Sign in.'); } });
  assert.equal(denied.status, 401); assert.equal(reads, 0);
  authority.owner = SELLER;
  assert.equal((await response()).status, 403); assert.equal(reads, 0);
});
test('non-GET request does not initialize database or inspect a wallet', async () => {
  const result = await handleV2Fund(request('POST'), {
    requireSession: async () => { throw Error('must not run'); },
    readAuthority: async () => { throw Error('must not run'); },
  });
  assert.equal(result.status, 405); assert.equal(reads, 0);
});
