import assert from 'node:assert/strict';
import { createPublicClient, createWalletClient, http, parseAbi, toFunctionSelector, zeroAddress } from 'viem';
import { startPreview } from './dev/skill-forge/preview-server.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--local-only') throw Error('Requires --local-only');
const preview = await startPreview({ controlCenterTraining: true, reviewedTraining: true, burnPractice: true });
const transport = http(`http://127.0.0.1:${preview.resumeConfig.rpcPort}`, { retryCount: 0 });
const client = createPublicClient({ transport, cacheTime: 0 });
const wallet = createWalletClient({ transport, account: preview.resumeConfig.owner });
const nftAbi = parseAbi(['function ownerOf(uint256) view returns(address)', 'function approve(address,uint256)',
  'function burn(uint256)', 'function totalSupply() view returns(uint256)']);
const walletAbi = parseAbi(['function owner() view returns(address)', 'function withdraw()']);
const get = async () => (await fetch(`${preview.url}/api/burn-practice`)).json();
let state;
const post = async (action, body, expected = 200, headerOverrides = {}) => {
  const response = await fetch(`${preview.url}/api/burn-practice/${action}`, { method: 'POST',
    headers: { origin: preview.url, 'content-type': 'application/json', 'x-forge-nonce': state.localTrainingNonce, ...headerOverrides }, body: JSON.stringify(body) });
  const text = await response.text(); assert.equal(response.status, expected, text);
  return expected === 200 ? JSON.parse(text) : text;
};
const prepare = () => post('prepare', { sourceTokenId: 7, targetTokenId: 44 });
const confirmation = record => ({ intentId: record.review.intentId, typedConfirmation: 'BURN 7', acknowledgeAccessLoss: true });
const callBurn = record => client.call({ account: state.owner, to: state.source, data: record.review.transaction.data });
const write = async (functionName, args) => {
  const hash = await wallet.writeContract({ address: state.collection, abi: nftAbi, functionName, args, chain: null });
  assert.equal((await client.waitForTransactionReceipt({ hash })).status, 'success');
};
const checkpoint = () => client.request({ method: 'evm_snapshot' });
const restore = id => client.request({ method: 'evm_revert', params: [id] });
try {
  state = await get();
  assert.equal(state.supply, '1119'); assert.equal(state.credits, '0'); assert.equal(state.wallets.length, 4);
  const initialNonce = await client.getTransactionCount({ address: state.owner });
  await post('prepare', { sourceTokenId: 44, targetTokenId: 44 }, 409);
  await post('prepare', { sourceTokenId: 7, targetTokenId: 44 }, 403, { origin: 'https://example.com' });
  await post('prepare', { sourceTokenId: 7, targetTokenId: 44 }, 403, { 'x-forge-nonce': 'wrong' });
  let record = await prepare();
  await post('confirm', { ...confirmation(record), typedConfirmation: 'BURN 44' }, 409);
  await post('confirm', { ...confirmation(record), acknowledgeAccessLoss: false }, 409);
  await post('confirm', { ...confirmation(record), transaction: record.review.transaction }, 409);
  await post('cancel', { intentId: record.review.intentId });
  assert.equal(await client.getTransactionCount({ address: state.owner }), initialNonce, 'prepare, bad confirmations and cancel never send');
  assert.equal((await get()).credits, '0');

  record = await prepare();
  const beforeExpiry = await checkpoint();
  await client.request({ method: 'evm_increaseTime', params: [61] }); await client.request({ method: 'evm_mine' });
  await assert.rejects(callBurn(record), /REVIEW_EXPIRED/);
  await post('confirm', confirmation(record), 409);
  await restore(beforeExpiry);

  record = await prepare();
  await preview.roundTripFixture(44);
  await assert.rejects(callBurn(record), /OWNERSHIP_CHANGED/);
  await post('confirm', confirmation(record), 409);
  record = await prepare();
  await preview.roundTripFixture(7);
  await assert.rejects(callBurn(record), /OWNERSHIP_CHANGED/);
  await post('confirm', confirmation(record), 409);
  await write('approve', [state.source, 7n]);

  record = await prepare();
  await client.request({ method: 'anvil_setBalance', params: [state.wallets[0].address, '0x1'] });
  assert.match(await post('confirm', confirmation(record), 409), /FIXTURE_WALLET_NOT_EMPTY/);
  await client.request({ method: 'anvil_setBalance', params: [state.wallets[0].address, '0x0'] });

  record = await prepare();
  const beforeFloor = await checkpoint();
  for (let id = 3000n; id < 3008n; id++) await write('burn', [id]);
  assert.equal(await client.readContract({ address: state.collection, abi: nftAbi, functionName: 'totalSupply' }), 1111n);
  await assert.rejects(callBurn(record), new RegExp(toFunctionSelector('SupplyFloorReached()')));
  assert.match(await post('confirm', confirmation(record), 409), /SUPPLY_FLOOR_REACHED/);
  assert.equal((await get()).credits, '0');
  await restore(beforeFloor);

  record = await prepare();
  const beforeApproval = await checkpoint();
  await write('approve', [zeroAddress, 7n]);
  await assert.rejects(callBurn(record));
  assert.equal((await get()).credits, '0');
  assert.equal((await client.readContract({ address: state.collection, abi: nftAbi, functionName: 'ownerOf', args: [7n] })).toLowerCase(), state.owner.toLowerCase());
  await post('confirm', confirmation(record), 409); await restore(beforeApproval);

  record = await prepare();
  const nonceBeforeBurn = await client.getTransactionCount({ address: state.owner });
  preview.setReceiptVisibility(false);
  const confirmations = await Promise.all([post('confirm', confirmation(record)), post('confirm', confirmation(record))]);
  assert.ok(confirmations.every(result => ['CHECKING', 'SUBMISSION_UNKNOWN', 'SUBMITTED'].includes(result.status)));
  assert.equal(await client.getTransactionCount({ address: state.owner }), nonceBeforeBurn + 1, 'concurrent confirmations send exactly once');
  assert.equal((await get()).record.status, 'SUBMITTED', 'missing receipt never confirms optimistically');
  preview.setReceiptVisibility(true);
  const confirmed = await post('status', {});
  assert.equal(confirmed.status, 'CONFIRMED');
  assert.equal((await post('confirm', confirmation(record))).transactionHash, confirmed.transactionHash);
  assert.equal(await client.getTransactionCount({ address: state.owner }), nonceBeforeBurn + 1, 'retries only read the original receipt');
  state = await get(); assert.equal(state.credits, '1'); assert.equal(state.supply, '1118');
  assert.equal(state.sourceOwner, zeroAddress);
  await assert.rejects(client.readContract({ address: state.collection, abi: nftAbi, functionName: 'ownerOf', args: [7n] }));
  await assert.rejects(callBurn(record), new RegExp(toFunctionSelector('ERC721NonexistentToken(uint256)')));

  // Wallet addresses survive the NFT. Later test deposits remain, but the former owner cannot withdraw.
  const fixtureWallet = state.wallets[0].address;
  assert.ok((await client.getCode({ address: fixtureWallet })).length > 2);
  const deposit = await wallet.sendTransaction({ to: fixtureWallet, value: 1n, chain: null });
  await client.waitForTransactionReceipt({ hash: deposit });
  assert.equal(await client.getBalance({ address: fixtureWallet }), 1n);
  assert.equal(await client.readContract({ address: fixtureWallet, abi: walletAbi, functionName: 'owner' }), zeroAddress);
  await assert.rejects(client.simulateContract({ address: fixtureWallet, abi: walletAbi, functionName: 'withdraw', account: state.owner }), /NO_OWNER_ACCESS/);

  const train = async (path, input) => {
    const response = await fetch(`${preview.url}/api/local-training/${path}`, { method: 'POST', headers: {
      origin: preview.url, 'content-type': 'application/json', 'x-forge-nonce': state.localTrainingNonce }, body: JSON.stringify(input) });
    const text = await response.text(); assert.equal(response.status, 200, text); return JSON.parse(text);
  };
  let target = await (await fetch(`${preview.url}/api/forge?tokenId=44`)).json();
  const key = target.skills.find(skill => skill.id === 3).key;
  const learn = await train('prepare', { tokenId: 44, operation: 'learn', key, expectedBlock: target.blockNumber });
  assert.equal((await get()).credits, '1', 'learning review spends nothing');
  await train('confirm', { intentId: learn.intentId });
  target = await (await fetch(`${preview.url}/api/forge?tokenId=44`)).json();
  assert.equal(target.credits, '0'); assert.equal(target.learned.length, 1); assert.equal(target.learned[0].level, 1);
  assert.equal(target.equipped[0], `0x${'0'.repeat(64)}`, 'learning does not equip');
  const equip = await train('prepare', { tokenId: 44, operation: 'equip', key, slot: 0, expectedBlock: target.blockNumber });
  await train('confirm', { intentId: equip.intentId });
  target = await (await fetch(`${preview.url}/api/forge?tokenId=44`)).json();
  assert.equal(target.equipped[0], key);
  console.log(JSON.stringify({ result: 'PASS', source: 7, recipient: 44, chain: 'DISPOSABLE_31337',
    prepareAndCancelNoWrites: true, explicitConfirmation: true, expiryAndOwnershipEpochs: true,
    supplyFloor: true, walletDustBlocks: true, approvalFailureAtomic: true, concurrentBurnSends: 1,
    receiptRecovery: true, burnTransaction: confirmed.transactionHash, exactlyOneCredit: true,
    separateLearnAndEquip: true, postBurnWalletAccessLost: true, publicChainTransactions: 0 }, null, 2));
} finally { await preview.close(); }
