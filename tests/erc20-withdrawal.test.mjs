import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionData, keccak256 } from 'viem';
import { erc20Fixture, OWNER, TOKEN, ACCOUNT, OTHER, TX } from './fixtures/erc20-withdrawal.mjs';
import { ERC20_WITHDRAW_PINS, exactErc20Amount, formatErc20Amount, validateErc20Review, verifyErc20Wallet, submitErc20Withdrawal,
  erc20SimulationData, erc20ExecuteData } from '../site/erc20-withdraw-wallet.js';
import { ERC20_WITHDRAW_ABI, encodeErc20Withdrawal, Erc20WithdrawalCoordinator } from '../broker/src/control-center/erc20-withdrawal.mjs';
import agentManifest from '../deployments/robinhood-punk-agent-account.json' with { type: 'json' };
import v3Manifest from '../deployments/robinhood-automation-v3.json' with { type: 'json' };
import { handleErc20Withdrawal } from '../netlify/functions/broker-v2-erc20-withdraw.mjs';

test('public account pins match verified deployment manifests', () => {
  for (const [role, manifest, suffix] of [['AGENT', agentManifest, 'AgentAccount'], ['V3', v3Manifest, 'AccountV3']]) {
    const pin = ERC20_WITHDRAW_PINS[role], implementation = manifest.contracts[`GoghPunk${suffix}`], registry = manifest.contracts[role === 'V3' ? 'GoghPunkAccountRegistryV3' : 'GoghPunkAgentAccountRegistry'];
    assert.equal(pin.implementation, implementation.address.toLowerCase()); assert.equal(pin.implementationHash, implementation.runtimeBytecodeHash);
    assert.equal(pin.registry, registry.address.toLowerCase()); assert.equal(pin.registryHash, registry.runtimeBytecodeHash);
  }
});
test('decimal arithmetic is exact, including values above JS integer precision', () => {
  assert.equal(exactErc20Amount('9007199254740993.000001', 6), 9007199254740993000001n);
  assert.equal(formatErc20Amount('9007199254740993000001', 6), '9007199254740993.000001');
  assert.equal(formatErc20Amount('1000000', 6), '1'); assert.equal(formatErc20Amount('0', 6), '0');
});
for (const amount of ['0', '-1', '1e3', '+2', '01', '1,000', '.5', '1.0000001', '1 ', 'NaN', '9'.repeat(90)]) test(`reject unsafe amount ${amount}`, () => assert.throws(() => exactErc20Amount(amount, 6)));
test('inspection is current owner bound and token symbols cannot render markup', async () => {
  const f = erc20Fixture(); f.symbol = '<script>pay()</script>'; const asset = await f.coordinator.inspect(f.selection);
  assert.equal(asset.symbol, 'TOKEN'); assert.equal(asset.account, ACCOUNT); assert.equal(asset.decimals, 6); assert.equal(f.sends, 0);
});
test('server and browser independently encode transfer-only execute and balance-delta simulation', async () => {
  const f = erc20Fixture(), r = await f.prepare();
  assert.equal(r.transaction.data, erc20ExecuteData(TOKEN, OWNER, r.units)); assert.equal(r.transaction.data, encodeErc20Withdrawal(r));
  const decoded = decodeFunctionData({ abi: ERC20_WITHDRAW_ABI, data: r.transaction.data });
  assert.equal(decoded.functionName, 'execute'); assert.equal(decoded.args[0].toLowerCase(), TOKEN); assert.equal(decoded.args[1], 0n); assert.equal(decoded.args[3], 0);
  const transfer = decodeFunctionData({ abi: ERC20_WITHDRAW_ABI, data: decoded.args[2] }); assert.equal(transfer.functionName, 'transfer'); assert.equal(transfer.args[0].toLowerCase(), OWNER);
  const batch = decodeFunctionData({ abi: ERC20_WITHDRAW_ABI, data: erc20SimulationData(TOKEN, ACCOUNT, OWNER, r.units) });
  assert.equal(batch.args[0].length, 5); assert.equal(batch.args[0][2].data, decoded.args[2]);
  assert.equal((await f.coordinator.verify(r)).verified, true); await verifyErc20Wallet(f.provider, r, { now: () => f.now });
});
for (const [name, mutate] of [['wrong owner', f => f.owner = OTHER], ['wrong chain', f => f.chain = 1], ['false return', f => f.falseReturn = true],
  ['transfer fee', f => f.fee = 1n], ['no gas', f => f.ownerEth = 0n], ['missing token', f => f.tokenCode = '0x'],
  ['implementation changed', f => f.code.implementation = '0x00'], ['pending wallet', f => f.pending++], ['balance too low', f => f.source = 1n],
  ['unsupported decimals', f => f.decimals = 37], ['too much gas', f => f.gas = 500001n], ['stale head', f => f.now += 40000]]) {
  test(`preparation blocks ${name}`, async () => { const f = erc20Fixture(); mutate(f); await assert.rejects(f.prepare()); assert.equal(f.sends, 0); });
}
for (const [name, mutate] of [['owner', f => f.owner = OTHER], ['balance', f => f.source++], ['recipient balance', f => f.destination++], ['account state', f => f.state++],
  ['decimals', f => f.decimals++], ['token code', f => f.tokenCode = '0x6001'], ['nonce', f => { f.nonce++; f.pending++; }], ['expiry', f => f.now += 61000]]) {
  test(`fresh verification blocks ${name} drift`, async () => { const f = erc20Fixture(), r = await f.prepare(); mutate(f); await assert.rejects(f.coordinator.verify(r)); await assert.rejects(verifyErc20Wallet(f.provider, r, { now: () => f.now })); assert.equal(f.sends, 0); });
}
test('recipient tampering, approval/delegatecall selectors and excess ETH fail browser reconstruction', async () => {
  const f = erc20Fixture(), original = await f.prepare();
  for (const mutate of [r => r.transaction.to = OTHER, r => r.transaction.data = '0x095ea7b3', r => r.transaction.value = '0x1', r => r.transaction.from = OTHER,
    r => r.transaction.data = encodeFunctionData({ abi: ERC20_WITHDRAW_ABI, functionName: 'execute', args: [TOKEN, 0n, '0x', 1] })]) {
    const r = structuredClone(original); mutate(r); assert.throws(() => validateErc20Review(r));
  }
});
test('wallet request saved before send and exact delivery recovered without resend', async () => {
  const f = erc20Fixture(), r = await f.prepare(), saved = [];
  const hash = await submitErc20Withdrawal(f.provider, r, { persistAttempt: async a => { saved.push(a); if (a.status === 'WALLET_REQUESTED') assert.equal(f.sends, 0); }, verifyReview: x => f.coordinator.verify(x), now: () => f.now, locks: f.locks });
  assert.equal(hash, TX); assert.equal(f.sends, 1); assert.equal(saved[1].status, 'SUBMITTED');
  f.confirm(r); const result = await f.coordinator.recover({ review: r, transactionHash: TX }); assert.equal(result.status, 'CONFIRMED'); assert.equal(f.sends, 1);
  assert.deepEqual(await f.coordinator.recover({ review: r, transactionHash: TX }), result);
});
test('unknown wallet results persist, cannot be mistaken for rejection', async () => {
  const f = erc20Fixture(), r = await f.prepare(), saved = []; f.sendError = new Error('offline');
  await assert.rejects(submitErc20Withdrawal(f.provider, r, { persistAttempt: async a => saved.push(a), verifyReview: x => f.coordinator.verify(x), now: () => f.now, locks: f.locks }), { code: 'ERC20_WITHDRAW_WALLET_RESULT_UNKNOWN' });
  assert.equal(saved.length, 1); assert.equal(saved[0].status, 'WALLET_REQUESTED'); assert.equal(f.sends, 1);
});
test('storage and cross-tab lock are required before sending', async () => {
  for (const lock of [null, erc20Fixture().locks]) { const f = erc20Fixture(), r = await f.prepare(); await assert.rejects(submitErc20Withdrawal(f.provider, r, {
    persistAttempt: async () => { throw new Error('storage'); }, verifyReview: x => f.coordinator.verify(x), now: () => f.now, locks: lock })); assert.equal(f.sends, 0); }
});
test('definite wallet rejection is recorded separately', async () => {
  const f = erc20Fixture(), r = await f.prepare(), saved = []; f.sendError = Object.assign(new Error('rejected'), { code: 4001 });
  await assert.rejects(submitErc20Withdrawal(f.provider, r, { persistAttempt: async a => saved.push(a), verifyReview: x => f.coordinator.verify(x), now: () => f.now, locks: f.locks }), { code: 'ERC20_WITHDRAW_WALLET_REJECTED' });
  assert.equal(saved.at(-1).status, 'REJECTED');
});
for (const [name, mutate, status] of [['not finalized', f => f.finalized = false, 'CONFIRMING'], ['reverted', f => f.receipt.status = 'reverted', 'REVERTED'],
  ['wrong delivery', f => f.fee = 1n, 'REQUIRES_ATTENTION'], ['no Transfer', f => f.receipt.logs = [], 'REQUIRES_ATTENTION'],
  ['wrong token', f => f.receipt.logs[0].address = OTHER, 'REQUIRES_ATTENTION']]) {
  test(`recovery distinguishes ${name}`, async () => { const f = erc20Fixture(), r = await f.prepare(); f.confirm(r); mutate(f); assert.equal((await f.coordinator.recover({ review: r, transactionHash: TX })).status, status); });
}
for (const [name, mutate] of [['recipient', f => f.transaction.to = OTHER], ['sender', f => f.transaction.from = OTHER], ['calldata', f => f.transaction.input = '0x'],
  ['chain', f => f.transaction.chainId = 1], ['fee', f => f.receipt.effectiveGasPrice = 100000000000000n]]) {
  test(`recovery rejects mismatched ${name}`, async () => { const f = erc20Fixture(), r = await f.prepare(); f.confirm(r); mutate(f); await assert.rejects(f.coordinator.recover({ review: r, transactionHash: TX })); });
}
test('recovery remains available to original sender after Punk transfer; no new old-owner withdrawal', async () => {
  const f = erc20Fixture(), r = await f.prepare(); f.confirm(r); f.owner = OTHER;
  assert.equal((await f.coordinator.recover({ review: r, transactionHash: TX })).status, 'CONFIRMED'); await assert.rejects(f.prepare());
  const newOwner = await f.coordinator.prepare({ ...f.selection, owner: OTHER, amount: '1' }); assert.equal(newOwner.owner, OTHER); assert.equal(newOwner.account, ACCOUNT);
});
test('two distinct provider objects and agreement are required', async () => {
  const f = erc20Fixture(); assert.throws(() => new Erc20WithdrawalCoordinator({ clients: [f.client, f.client] }));
  const other = { ...f.client, getChainId: async () => 1 }; const c = new Erc20WithdrawalCoordinator({ clients: [f.client, other], now: () => f.now }); await assert.rejects(c.inspect(f.selection));
});
const req = body => new Request('https://goghpunks.xyz/api/v2/punks/93/erc20-withdraw', { method: 'POST', headers: { origin: 'https://goghpunks.xyz', 'content-type': 'application/json' }, body: JSON.stringify(body) });
test('API requires origin/session and rejects undeclared transaction fields', async t => {
  const originalUrl = process.env.SITE_URL; process.env.SITE_URL = 'https://goghpunks.xyz'; t.after(() => { if (originalUrl === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = originalUrl; });
  const f = erc20Fixture(), dependencies = { sessionPool: () => ({}), sessionReader: async () => ({ walletAddress: OWNER }), runtimeFactory: () => f.coordinator };
  const valid = { operation: 'prepare', role: 'AGENT', contract: TOKEN, amount: '1' };
  assert.equal((await handleErc20Withdrawal(req(valid), dependencies)).status, 200);
  assert.equal((await handleErc20Withdrawal(req({ ...valid, recipient: OTHER }), dependencies)).status, 400);
  const foreign = new Request(req(valid), { headers: { origin: 'https://evil.example' } }); assert.equal((await handleErc20Withdrawal(foreign, dependencies)).status, 403);
  const r = await f.prepare(); r.owner = OTHER; assert.equal((await handleErc20Withdrawal(req({ operation: 'verify', review: r }), dependencies)).status, 403);
});
test('undeployed wallet reports activation without calling missing owner/state methods', async () => {
  const f = erc20Fixture(), oldCode = f.client.getCode, oldRead = f.client.readContract; let accountReads = 0;
  f.client.getCode = async q => q.address.toLowerCase() === ACCOUNT ? '0x' : oldCode(q);
  f.client.readContract = async q => { if (q.address.toLowerCase() === ACCOUNT) accountReads++; return oldRead(q); };
  await assert.rejects(f.coordinator.inspect(f.selection), { code: 'ERC20_WITHDRAW_ACCOUNT_NOT_ACTIVATED' }); assert.equal(accountReads, 0);
});
test('a wrong block number with a plausible hash cannot anchor a withdrawal', async () => {
  const f = erc20Fixture(), block = f.client.getBlock; f.client.getBlock = async q => ({ ...await block(q), number: 999n }); await assert.rejects(f.prepare(), { code: 'ERC20_WITHDRAW_STALE_BLOCK' });
});
for (const field of ['gasUsed', 'effectiveGasPrice']) test(`receipt missing ${field} is not delivery proof`, async () => {
  const f = erc20Fixture(), r = await f.prepare(); f.confirm(r); delete f.receipt[field]; await assert.rejects(f.coordinator.recover({ review: r, transactionHash: TX }));
});
test('untrusted backend error values cannot leak RPC credential messages', async t => {
  const original = process.env.SITE_URL; process.env.SITE_URL = 'https://goghpunks.xyz'; t.after(() => { if (original === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = original; });
  const response = await handleErc20Withdrawal(req({ operation: 'inspect', role: 'AGENT', contract: TOKEN }), { sessionPool: () => ({}), sessionReader: async () => ({ walletAddress: OWNER }), runtimeFactory: () => ({ inspect: async () => { throw Object.assign(new Error('https://provider/SECRET'), { code: 'ERC20_WITHDRAW_PRIVATE' }); } }) });
  const body = await response.json(); assert.equal(response.status, 503); assert.doesNotMatch(JSON.stringify(body), /SECRET|provider\//);
});
