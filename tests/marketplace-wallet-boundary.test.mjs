import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionData, hashStruct, keccak256 } from 'viem';
import { verifyMarketplaceTransaction as verifySource } from '../client/marketplace-wallet-codec.js';
import { verifyMarketplaceTransaction as verifyBrowser } from '../site/marketplace-wallet-codec.js';
import { validateMarketplaceEnvelope, submitMarketplacePurchase } from '../site/marketplace-wallet.js';
import { ACCOUNT_ABI, SEAPORT_ABI, MARKETPLACE_GUARD_ABI, MARKETPLACE_PINS } from '../broker/src/v4/marketplace/contracts.mjs';

// Entirely controlled data: no RPC, provider account, deployed guard or signature
// is used. The claim fixture models one atomic winner; it does not prove SQL CAS.
const address = digit => `0x${digit.repeat(40)}`, hash = digit => `0x${digit.repeat(64)}`;
const OWNER = address('1'), WALLET = address('2'), COLLECTION = address('3'), GUARD = address('4');
const SELLER = address('5'), OTHER = address('6'), ZERO = address('0'), ZERO_HASH = hash('0');
const NOW = 1_789_344_000_000, TX_HASH = hash('d'), PRICE = 900719925474099300001n;
const CHECK_ERROR = /could not be verified|does not match the purchase review/;
// Independent fixture declaration: importing the implementation's type object
// here would allow an erroneous shared type change to rewrite the expected hash.
const ORDER_TYPES = {
  OfferItem: [{ name: 'itemType', type: 'uint8' }, { name: 'token', type: 'address' },
    { name: 'identifierOrCriteria', type: 'uint256' }, { name: 'startAmount', type: 'uint256' }, { name: 'endAmount', type: 'uint256' }],
  ConsiderationItem: [{ name: 'itemType', type: 'uint8' }, { name: 'token', type: 'address' },
    { name: 'identifierOrCriteria', type: 'uint256' }, { name: 'startAmount', type: 'uint256' },
    { name: 'endAmount', type: 'uint256' }, { name: 'recipient', type: 'address' }],
  OrderComponents: [{ name: 'offerer', type: 'address' }, { name: 'zone', type: 'address' }, { name: 'offer', type: 'OfferItem[]' },
    { name: 'consideration', type: 'ConsiderationItem[]' }, { name: 'orderType', type: 'uint8' }, { name: 'startTime', type: 'uint256' },
    { name: 'endTime', type: 'uint256' }, { name: 'zoneHash', type: 'bytes32' }, { name: 'salt', type: 'uint256' },
    { name: 'conduitKey', type: 'bytes32' }, { name: 'counter', type: 'uint256' }],
};
const orderHash = (parameters, counter = 2n) => hashStruct({ primaryType: 'OrderComponents', types: ORDER_TYPES,
  data: { ...parameters, counter } });

function purchaseFixture({ count = 2 } = {}) {
  const timestamp = BigInt(NOW / 1000), items = [], calls = [];
  for (let index = 0; index < count; index++) {
    const tokenId = BigInt(100 + index), price = PRICE + BigInt(index);
    const parameters = { offerer: SELLER, zone: ZERO,
      offer: [{ itemType: 2, token: COLLECTION, identifierOrCriteria: tokenId, startAmount: 1n, endAmount: 1n }],
      consideration: [{ itemType: 0, token: ZERO, identifierOrCriteria: 0n, startAmount: price - 1n, endAmount: price - 1n, recipient: SELLER },
        { itemType: 0, token: ZERO, identifierOrCriteria: 0n, startAmount: 1n, endAmount: 1n, recipient: OTHER }],
      orderType: 0, startTime: timestamp - 100n, endTime: timestamp + 3600n,
      zoneHash: ZERO_HASH, salt: BigInt(index + 9), conduitKey: ZERO_HASH, totalOriginalConsiderationItems: 2n };
    items.push({ tokenId: String(tokenId), totalWei: String(price), counter: '2', orderHash: orderHash(parameters) });
    calls.push({ to: MARKETPLACE_PINS.seaport, value: price,
      data: encodeFunctionData({ abi: SEAPORT_ABI, functionName: 'fulfillAdvancedOrder', args: [
        { parameters, numerator: 1n, denominator: 1n, signature: `0x${'a'.repeat(130)}`, extraData: '0x' }, [], ZERO_HASH, WALLET] }) });
  }
  const review = { schema: 'GOGH_MARKETPLACE_REVIEW_V1', action: 'BUY_LISTINGS', chainId: 4663,
    owner: OWNER, wallet: WALLET, punkId: '93', accountState: '7', walletRole: 'AGENT', recipient: WALLET,
    transaction: null, anchor: { number: '100', timestamp: String(timestamp), hash: hash('a') }, expiresAt: NOW + 60_000,
    selection: { collection: COLLECTION, items }, purchaseGuard: { address: GUARD, codeHash: hash('b') },
    safety: { status: 'PASS', collectionCodeHash: hash('c') }, simulation: { status: 'PASS' },
    policy: { decision: 'ALLOW', mode: 'ASSIST', requiredSkillsEquipped: true, adapterApproved: true, budgetAllowed: true },
    collectionFloorVerified: false, cost: { totalPriceWei: String(items.reduce((sum, item) => sum + BigInt(item.totalWei), 0n)),
      maximumNetworkFeeWei: '3000000', minimumReserveWei: '23' } };
  calls.push({ to: GUARD, value: 0n, data: encodeFunctionData({ abi: MARKETPLACE_GUARD_ABI, functionName: 'assertPurchase',
    args: [93n, OWNER, 8n, COLLECTION, review.safety.collectionCodeHash, items.map(item => BigInt(item.tokenId)), 23n, timestamp + 60n] }) });
  const transaction = { from: OWNER, to: WALLET, chainId: '0x1237', type: '0x0', nonce: '0x9', value: '0x0',
    gas: '0x186a0', gasPrice: '0x1e', data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'executeBatch', args: [calls] }) };
  const { data, ...fields } = transaction;
  review.transactionCommitment = { ...fields, dataHash: keccak256(data) };
  const envelope = { ok: true, schema: 'GOGH_DURABLE_MARKETPLACE_V1', chainId: 4663, owner: OWNER, punkId: '93',
    automaticSubmission: false, publicTransactions: 0, broadcastAuthority: 'OWNER_WALLET_ONLY',
    availability: 'OWNER_REVIEW_READY', blockers: [], walletClaimed: false, transaction: null,
    entry: { intentId: 'e'.repeat(64), reviewHash: 'f'.repeat(64), revision: 3, status: 'PREPARED', reportedHash: null, review } };
  const claimed = { ...structuredClone(envelope), availability: 'RECOVERY_REQUIRED', walletClaimed: true, transaction,
    entry: { ...structuredClone(envelope.entry), revision: 4, status: 'WALLET_REQUESTED' } };
  return { review, calls, transaction, envelope, claimed,
    selected: { owner: OWNER, tokenId: '93', chainId: 4663, preview: false },
    purchaseRelease: { status: 'OWNER_ASSIST', chainId: 4663, purchaseGuardDeployment: { ...review.purchaseGuard } } };
}

function rewriteCalls(fixture, mutate) {
  const [calls] = decodeFunctionData({ abi: ACCOUNT_ABI, data: fixture.transaction.data }).args;
  mutate(calls);
  fixture.transaction.data = encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'executeBatch', args: [calls] });
  // Recommit the tampered bytes so rejection must come from economic semantics,
  // not merely detecting a stale outer calldata hash.
  fixture.review.transactionCommitment.dataHash = keccak256(fixture.transaction.data);
}
function rewriteOrder(fixture, mutate) {
  rewriteCalls(fixture, calls => {
    const decoded = decodeFunctionData({ abi: SEAPORT_ABI, data: calls[0].data });
    mutate(decoded.args);
    calls[0].data = encodeFunctionData({ abi: SEAPORT_ABI, ...decoded });
  });
}
function rewriteGuard(fixture, mutate) {
  rewriteCalls(fixture, calls => {
    const decoded = decodeFunctionData({ abi: MARKETPLACE_GUARD_ABI, data: calls.at(-1).data });
    mutate(decoded.args);
    calls.at(-1).data = encodeFunctionData({ abi: MARKETPLACE_GUARD_ABI, ...decoded });
  });
}
function assertCodecRejects(fixture) {
  for (const verify of [verifySource, verifyBrowser]) assert.throws(() => verify(fixture.review, fixture.transaction), CHECK_ERROR);
}

function senderFixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const fixture = purchaseFixture(), events = [], attempts = new Set(), hashes = new Map();
  let claimed = false, sends = 0, claimRequests = 0;
  const options = { ...fixture, isCurrent: () => true,
    provider: { request: async ({ method, params }) => {
      if (method === 'eth_chainId') return '0x1237';
      if (method === 'eth_accounts') return [OWNER];
      assert.equal(method, 'eth_sendTransaction', 'Unexpected wallet method');
      assert.deepEqual(params, [fixture.transaction]);
      sends++; events.push('send'); return TX_HASH;
    } },
    persistAttempt: async intentId => { attempts.add(intentId); events.push('attempt'); },
    claim: async original => {
      claimRequests++; events.push('claim');
      assert.equal(original.intentId, fixture.envelope.entry.intentId);
      if (claimed) throw Error('CLAIM_ALREADY_RESERVED');
      claimed = true;
      return structuredClone(fixture.claimed);
    },
    persistHash: async (intentId, value) => { hashes.set(intentId, value); events.push('hash'); } };
  return { ...fixture, options, events, attempts, hashes,
    sends: () => sends, claimRequests: () => claimRequests, reserved: () => claimed };
}

test('source and generated browser codec accept exact large-integer prices, listed fees and a final guard', () => {
  for (const count of [1, 2, 5]) {
    const f = purchaseFixture({ count });
    assert.equal(f.review.selection.items[0].totalWei, '900719925474099300001');
    assert.equal(verifySource(f.review, f.transaction), true);
    assert.equal(verifyBrowser(f.review, f.transaction), true);
    assert.equal(validateMarketplaceEnvelope(f.claimed, f.selected), f.claimed);
  }
});

for (const [name, mutate] of [
  ['displayed order hash', f => { f.review.selection.items[0].orderHash = hash('9'); }],
  ['order counter', f => { f.review.selection.items[0].counter = '3'; }],
  ['seller', f => rewriteOrder(f, args => { args[0].parameters.offerer = OTHER; })],
  ['payment recipient', f => rewriteOrder(f, args => { args[0].parameters.consideration[0].recipient = OTHER; })],
  ['NFT recipient', f => rewriteOrder(f, args => { args[3] = OTHER; })],
  ['extra data', f => rewriteOrder(f, args => { args[0].extraData = '0x1234'; })],
  ['fulfiller conduit', f => rewriteOrder(f, args => { args[2] = hash('9'); })],
  ['guard destination', f => rewriteCalls(f, calls => { calls.at(-1).to = OTHER; })],
  ['guard payment', f => rewriteCalls(f, calls => { calls.at(-1).value = 1n; })],
  ['missing guard', f => rewriteCalls(f, calls => { calls.pop(); })],
  ['guard owner', f => rewriteGuard(f, args => { args[1] = OTHER; })],
  ['guard account state', f => rewriteGuard(f, args => { args[2] = 7n; })],
  ['guard collection code hash', f => rewriteGuard(f, args => { args[4] = hash('9'); })],
  ['guard NFT delivery IDs', f => rewriteGuard(f, args => { args[5][0] = 999n; })],
  ['guard minimum reserve', f => rewriteGuard(f, args => { args[6] = 0n; })],
  ['guard extended deadline', f => rewriteGuard(f, args => { args[7] += 1n; })],
]) test(`both codecs reject changed ${name} even with a matching calldata commitment`, () => {
  const f = purchaseFixture(); mutate(f); assertCodecRejects(f);
});

test('canonical transaction checks reject injected authority, changed value, excessive fee and appended calldata', () => {
  for (const mutate of [
    f => { f.transaction.authorizationList = []; },
    f => { f.transaction.value = f.review.transactionCommitment.value = '0x1'; },
    f => { f.transaction.gasPrice = f.review.transactionCommitment.gasPrice = '0x1f'; },
    f => { f.transaction.data += '00'; f.review.transactionCommitment.dataHash = keccak256(f.transaction.data); },
  ]) { const f = purchaseFixture(); mutate(f); assertCodecRejects(f); }
});

test('zero addresses, controlling collection, preview, duplicate NFT selection and a false floor assertion are rejected', () => {
  for (const mutate of [
    f => { f.review.purchaseGuard.address = ZERO; }, f => { f.review.wallet = ZERO; },
    f => { f.review.selection.collection = MARKETPLACE_PINS.collection; }, f => { f.selected.preview = true; },
    f => { f.review.selection.items[1].tokenId = f.review.selection.items[0].tokenId; },
    f => { f.review.collectionFloorVerified = true; },
  ]) { const f = purchaseFixture(); mutate(f); assert.throws(() => validateMarketplaceEnvelope(f.envelope, f.selected), CHECK_ERROR); }
});

test('successful submission persists the attempt before claim and the hash after exactly one wallet request', async t => {
  const f = senderFixture(t);
  assert.equal(await submitMarketplacePurchase(f.options), TX_HASH);
  assert.deepEqual(f.events, ['attempt', 'claim', 'send', 'hash']);
  assert.equal(f.hashes.get(f.envelope.entry.intentId), TX_HASH); assert.equal(f.sends(), 1); assert.equal(f.reserved(), true);
});

test('absent or inconsistent trusted release never requests a claim or wallet transaction', async t => {
  const f = senderFixture(t);
  for (const purchaseRelease of [undefined, { ...f.purchaseRelease, status: 'BLOCKED' }, { ...f.purchaseRelease, chainId: 1 },
    { ...f.purchaseRelease, purchaseGuardDeployment: { ...f.purchaseRelease.purchaseGuardDeployment, address: OTHER } },
    { ...f.purchaseRelease, purchaseGuardDeployment: { ...f.purchaseRelease.purchaseGuardDeployment, codeHash: hash('9') } }]) {
    await assert.rejects(submitMarketplacePurchase({ ...f.options, purchaseRelease }), CHECK_ERROR);
  }
  assert.deepEqual(f.events, []); assert.equal(f.sends(), 0); assert.equal(f.claimRequests(), 0);
});

for (const [name, mutate] of [
  ['release blocker', claim => { claim.availability = 'RELEASE_BLOCKED'; }],
  ['nonempty blockers', claim => { claim.blockers = ['PAUSED']; }],
  ['unclaimed ready response', claim => { claim.availability = 'OWNER_REVIEW_READY'; }],
  ['intent ID', claim => { claim.entry.intentId = 'a'.repeat(64); }],
  ['review hash', claim => { claim.entry.reviewHash = 'a'.repeat(64); }],
  ['revision replay', claim => { claim.entry.revision = 3; }],
  ['review contents behind unchanged hash', claim => { claim.entry.review.accountState = '8'; }],
  ['order identity', claim => { claim.entry.review.selection.items[0].orderHash = hash('9'); }],
  ['order counter', claim => { claim.entry.review.selection.items[0].counter = '3'; }],
  ['transaction commitment', claim => { claim.entry.review.transactionCommitment.dataHash = hash('9'); }],
]) test(`corrupted claim ${name} leaves the attempt reserved and sends nothing`, async t => {
  const f = senderFixture(t), claim = f.options.claim;
  f.options.claim = async original => { const response = await claim(original); mutate(response); return response; };
  await assert.rejects(submitMarketplacePurchase(f.options), CHECK_ERROR);
  assert.equal(f.reserved(), true); assert.ok(f.attempts.has(f.envelope.entry.intentId));
  assert.equal(f.sends(), 0); assert.equal(f.hashes.size, 0);
  await assert.rejects(submitMarketplacePurchase(f.options), /CLAIM_ALREADY_RESERVED/);
  assert.equal(f.sends(), 0);
});

test('failed attempt persistence prevents claim and a wallet transaction', async t => {
  const f = senderFixture(t);
  f.options.persistAttempt = async () => { throw Error('ATTEMPT_STORAGE_UNAVAILABLE'); };
  await assert.rejects(submitMarketplacePurchase(f.options), /ATTEMPT_STORAGE_UNAVAILABLE/);
  assert.equal(f.claimRequests(), 0); assert.equal(f.reserved(), false); assert.equal(f.sends(), 0);
});

test('claim response lost after reservation cannot be retried into a wallet send', async t => {
  const f = senderFixture(t), claim = f.options.claim;
  f.options.claim = async original => { await claim(original); throw Error('CLAIM_RESPONSE_LOST'); };
  await assert.rejects(submitMarketplacePurchase(f.options), /CLAIM_RESPONSE_LOST/);
  await assert.rejects(submitMarketplacePurchase(f.options), /CLAIM_ALREADY_RESERVED/);
  assert.equal(f.reserved(), true); assert.equal(f.sends(), 0); assert.ok(f.attempts.has(f.envelope.entry.intentId));
});

test('wallet rejection preserves the reservation and prevents a second send', async t => {
  const f = senderFixture(t), provider = f.options.provider;
  let requests = 0;
  f.options.provider = { request: async args => {
    if (args.method === 'eth_sendTransaction') { requests++; throw Object.assign(Error('OWNER_REJECTED'), { code: 4001 }); }
    return provider.request(args);
  } };
  await assert.rejects(submitMarketplacePurchase(f.options), /OWNER_REJECTED/);
  await assert.rejects(submitMarketplacePurchase(f.options), /CLAIM_ALREADY_RESERVED/);
  assert.equal(requests, 1); assert.equal(f.reserved(), true); assert.equal(f.hashes.size, 0);
});

test('unknown outcome from an interrupted wallet request never automatically resubmits', async t => {
  const f = senderFixture(t), provider = f.options.provider;
  let sends = 0;
  f.options.provider = { request: async args => {
    if (args.method === 'eth_sendTransaction') { sends++; throw Error('WALLET_CONNECTION_LOST_AFTER_REQUEST'); }
    return provider.request(args);
  } };
  await assert.rejects(submitMarketplacePurchase(f.options), /WALLET_CONNECTION_LOST_AFTER_REQUEST/);
  await assert.rejects(submitMarketplacePurchase(f.options), /CLAIM_ALREADY_RESERVED/);
  assert.equal(sends, 1); assert.ok(f.attempts.has(f.envelope.entry.intentId)); assert.equal(f.hashes.size, 0);
});

test('invalid wallet hash is not recorded and the consumed claim cannot send twice', async t => {
  const f = senderFixture(t), provider = f.options.provider;
  let sends = 0;
  f.options.provider = { request: async args => {
    if (args.method === 'eth_sendTransaction') { sends++; return 'not-a-transaction-hash'; }
    return provider.request(args);
  } };
  await assert.rejects(submitMarketplacePurchase(f.options), CHECK_ERROR);
  await assert.rejects(submitMarketplacePurchase(f.options), /CLAIM_ALREADY_RESERVED/);
  assert.equal(sends, 1); assert.equal(f.hashes.size, 0); assert.ok(f.attempts.has(f.envelope.entry.intentId));
});

test('hash persistence failure after send keeps the attempted intent and cannot duplicate the transaction', async t => {
  const f = senderFixture(t);
  let receivedHash;
  f.options.persistHash = async (intentId, value) => {
    assert.equal(intentId, f.envelope.entry.intentId); receivedHash = value;
    throw Error('HASH_STORAGE_UNAVAILABLE');
  };
  await assert.rejects(submitMarketplacePurchase(f.options), /HASH_STORAGE_UNAVAILABLE/);
  assert.equal(receivedHash, TX_HASH); assert.equal(f.sends(), 1); assert.ok(f.attempts.has(f.envelope.entry.intentId));
  await assert.rejects(submitMarketplacePurchase(f.options), /CLAIM_ALREADY_RESERVED/);
  assert.equal(f.sends(), 1);
});

for (const phase of ['before claim', 'after claim']) {
  for (const change of ['chain', 'account']) test(`changed wallet ${change} ${phase} prevents submission`, async t => {
    const f = senderFixture(t), provider = f.options.provider;
    f.options.provider = { request: async args => {
      if (phase === 'before claim' || f.reserved()) {
        if (change === 'chain' && args.method === 'eth_chainId') return '0x1';
        if (change === 'account' && args.method === 'eth_accounts') return [OTHER];
      }
      return provider.request(args);
    } };
    await assert.rejects(submitMarketplacePurchase(f.options), CHECK_ERROR);
    assert.equal(f.sends(), 0); assert.equal(f.claimRequests(), phase === 'before claim' ? 0 : 1);
  });
}

test('wallet network read failure after claim preserves recovery without sending', async t => {
  const f = senderFixture(t), provider = f.options.provider;
  f.options.provider = { request: async args => {
    if (f.reserved() && args.method === 'eth_chainId') throw Error('WALLET_NETWORK_UNAVAILABLE');
    return provider.request(args);
  } };
  await assert.rejects(submitMarketplacePurchase(f.options), /WALLET_NETWORK_UNAVAILABLE/);
  assert.equal(f.reserved(), true); assert.ok(f.attempts.has(f.envelope.entry.intentId)); assert.equal(f.sends(), 0);
});

test('selection changed while parallel wallet reads resolve prevents even the durable attempt', async t => {
  const f = senderFixture(t), provider = f.options.provider;
  let current = true;
  f.options.isCurrent = () => current;
  f.options.provider = { request: async args => {
    const response = await provider.request(args);
    if (args.method === 'eth_accounts') current = false;
    return response;
  } };
  await assert.rejects(submitMarketplacePurchase(f.options), CHECK_ERROR);
  assert.equal(f.attempts.size, 0); assert.equal(f.claimRequests(), 0); assert.equal(f.sends(), 0);
});

test('expiry while awaiting the claimed response prevents a send and retains recovery state', async t => {
  const f = senderFixture(t), claim = f.options.claim;
  f.options.claim = async original => {
    const response = await claim(original); t.mock.timers.setTime(f.review.expiresAt - 1_000); return response;
  };
  await assert.rejects(submitMarketplacePurchase(f.options), CHECK_ERROR);
  assert.equal(f.reserved(), true); assert.equal(f.sends(), 0); assert.ok(f.attempts.has(f.envelope.entry.intentId));
});

test('simultaneous submissions sharing an atomic claim produce exactly one mocked wallet request', { timeout: 2_000 }, async t => {
  const f = senderFixture(t), claim = f.options.claim;
  let arrived = 0, release;
  const bothClaiming = new Promise(resolve => { release = resolve; });
  f.options.claim = async original => {
    // Call the atomic fixture before yielding; hold its response until both
    // contenders have entered the claim boundary, including the losing request.
    const result = await Promise.allSettled([claim(original)]);
    if (++arrived === 2) release();
    await bothClaiming;
    if (result[0].status === 'rejected') throw result[0].reason;
    return result[0].value;
  };
  const outcomes = await Promise.allSettled([submitMarketplacePurchase(f.options), submitMarketplacePurchase(f.options)]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled' && item.value === TX_HASH).length, 1);
  assert.equal(outcomes.filter(item => item.status === 'rejected' && /CLAIM_ALREADY_RESERVED/.test(item.reason.message)).length, 1);
  assert.equal(f.claimRequests(), 2); assert.equal(f.sends(), 1); assert.equal(f.hashes.size, 1); assert.equal(f.attempts.size, 1);
});
