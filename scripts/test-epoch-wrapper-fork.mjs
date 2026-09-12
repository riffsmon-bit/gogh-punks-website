// Reads the public chain; ALL writes and impersonation are confined to our private Anvil fork.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createPublicClient, createWalletClient, getAddress, http, keccak256, parseAbi } from 'viem';
import { artifact } from './dev/epoch/local-world.mjs';
if (process.argv.length !== 3 || process.argv[2] !== '--fork-read-only') throw Error('Requires --fork-read-only');
const upstream = 'https://rpc.mainnet.chain.robinhood.com';
const collection = '0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6';
const nftAbi = parseAbi(['function ownerOf(uint256) view returns (address)', 'function approve(address,uint256)',
  'function totalSupply() view returns (uint256)', 'function owner() view returns (address)',
  'function getTransferValidator() view returns (address)']);
const validatorAbi = parseAbi([
  'function getCollectionSecurityPolicy(address) view returns ((uint8 transferSecurityLevel,uint120 operatorWhitelistId,uint120 permittedContractReceiversId))',
  'function getWhitelistedAccounts(uint120) view returns (address[])',
  'function getAuthorizerAccounts(uint120) view returns (address[])',
  'function getBlacklistedAccounts(uint120) view returns (address[])',
  'function createListCopy(string,uint120) returns (uint120)',
  'function addAccountToWhitelist(uint120,address)',
  'function applyListToCollection(address,uint120)',
  'function validateTransfer(address,address,address,uint256) view',
]);
const remote = createPublicClient({ transport: http(upstream, { timeout: 15_000, retryCount: 0 }) });
assert.equal(await remote.getChainId(), 4663);
const block = await remote.getBlock();
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const node = spawn('anvil', ['--silent', '--host', '127.0.0.1', '--port', String(port), '--chain-id', '4663',
  '--fork-url', upstream, '--fork-block-number', String(block.number)], { stdio: 'ignore' });
let startupError;
node.on('error', e => { startupError = e; });
try {
  const transport = http(`http://127.0.0.1:${port}`, { timeout: 20_000, retryCount: 0 });
  const client = createPublicClient({ transport, pollingInterval: 50 });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError;
    if (node.exitCode !== null) throw Error('FORK_NODE_EXITED');
    try { ready = await client.getChainId() === 4663; } catch { }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'FORK_NODE_UNAVAILABLE');
  assert.match(await client.request({ method: 'web3_clientVersion' }), /anvil/i);
  const [deployer] = await client.request({ method: 'eth_accounts' });
  // Public Anvil default addresses can already have code (e.g. EIP-7702) on a fork.
  // Use an explicitly empty fixture recipient; never erase real fork code to force success.
  const bob = getAddress('0x00000000000000000000000000000000B0B00930');
  assert.ok(!await client.getCode({ address: bob }), 'FIXTURE_RECIPIENT_HAS_CODE');
  await client.request({ method: 'anvil_impersonateAccount', params: [bob] });
  await client.request({ method: 'anvil_setBalance', params: [bob, '0x4563918244f40000'] });
  // The ONLY wallet transport in this program points to the local fork.
  const wallet = createWalletClient({ transport, account: deployer });
  const owner = await client.readContract({ address: collection, abi: nftAbi, functionName: 'ownerOf', args: [93n] });
  const supply = await client.readContract({ address: collection, abi: nftAbi, functionName: 'totalSupply' });
  const admin = await client.readContract({ address: collection, abi: nftAbi, functionName: 'owner' });
  const validator = await client.readContract({ address: collection, abi: nftAbi, functionName: 'getTransferValidator' });
  assert.equal(validator.toLowerCase(), '0xa000027a9b2802e1ddf7000061001e5c005a0000', 'REVIEW_NEW_VALIDATOR_FIRST');
  const readValidator = (functionName, args) => client.readContract({ address: validator, abi: validatorAbi, functionName, args });
  const policyBefore = await readValidator('getCollectionSecurityPolicy', [collection]);
  // Fail if the live policy differs from the audited case; never lower a security level.
  assert.equal(policyBefore.transferSecurityLevel, 3, 'REVIEW_NEW_SECURITY_POLICY_FIRST');
  const listMethods = ['getWhitelistedAccounts', 'getAuthorizerAccounts', 'getBlacklistedAccounts'];
  const listsBefore = await Promise.all(listMethods.map(fn => readValidator(fn, [policyBefore.operatorWhitelistId])));
  await client.request({ method: 'anvil_impersonateAccount', params: [owner] });
  await client.request({ method: 'anvil_setBalance', params: [owner, '0x4563918244f40000'] });
  const a = await artifact('GoghPunkSessionWrapper.sol', 'GoghPunkSessionWrapper');
  const receipt = async hash => { const r = await client.waitForTransactionReceipt({ hash, timeout: 20_000 }); assert.equal(r.status, 'success'); return r; };
  const created = await receipt(await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args: [deployer], chain: null }));
  const wrapper = getAddress(created.contractAddress);
  const write = async (address, abi, functionName, args, account) => {
    const { request } = await client.simulateContract({ address, abi, functionName, args, account });
    return receipt(await wallet.writeContract({ ...request, chain: null }));
  };
  await write(collection, nftAbi, 'approve', [wrapper, 93n], owner);
  // Establish the real integration blocker, not a passing test against a disabled validator.
  await assert.rejects(client.simulateContract({ address: wrapper, abi: a.abi, functionName: 'wrap', args: [93n], account: owner }),
    error => error.message.includes('0x1de5204e'), 'unregistered wrapper must be rejected by the live validator');
  assert.equal(await client.readContract({ address: collection, abi: nftAbi, functionName: 'ownerOf', args: [93n] }), owner);

  // Proposed COLLECTION-OWNER configuration, rehearsed ONLY on this disposable fork.
  // Copy all current lists; add only the wrapper operator. Preserve the authorizers,
  // blacklist and security level. Never change the shared default list or disable validation.
  await client.request({ method: 'anvil_impersonateAccount', params: [admin] });
  await client.request({ method: 'anvil_setBalance', params: [admin, '0x4563918244f40000'] });
  const copy = await client.simulateContract({ address: validator, abi: validatorAbi,
    functionName: 'createListCopy', args: ['LOCAL ONLY - Gogh session wrapper rehearsal', policyBefore.operatorWhitelistId], account: admin });
  const newList = copy.result;
  await receipt(await wallet.writeContract({ ...copy.request, chain: null }));
  assert.deepEqual(await Promise.all(listMethods.map(fn => readValidator(fn, [newList]))), listsBefore);
  await write(validator, validatorAbi, 'addAccountToWhitelist', [newList, wrapper], admin);
  await assert.rejects(client.simulateContract({ address: validator, abi: validatorAbi,
    functionName: 'applyListToCollection', args: [collection, newList], account: bob }));
  await write(validator, validatorAbi, 'applyListToCollection', [collection, newList], admin);
  const policyAfter = await readValidator('getCollectionSecurityPolicy', [collection]);
  assert.deepEqual(policyAfter, { ...policyBefore, operatorWhitelistId: newList });
  const listsAfter = await Promise.all(listMethods.map(fn => readValidator(fn, [newList])));
  assert.deepEqual(listsAfter, [[...listsBefore[0], wrapper], listsBefore[1], listsBefore[2]]);
  assert.deepEqual(await Promise.all(listMethods.map(fn => readValidator(fn, [policyBefore.operatorWhitelistId]))), listsBefore);
  await assert.rejects(client.simulateContract({ address: validator, abi: validatorAbi, functionName: 'validateTransfer',
    args: [deployer, owner, bob, 93n], account: collection }), error => error.message.includes('0x1de5204e'));
  await write(wrapper, a.abi, 'wrap', [93n], owner);
  assert.equal((await client.readContract({ address: collection, abi: nftAbi, functionName: 'ownerOf', args: [93n] })).toLowerCase(), wrapper.toLowerCase());
  await write(wrapper, a.abi, 'safeTransferFrom', [owner, bob, 93n], owner);
  await write(wrapper, a.abi, 'transferFrom', [bob, owner, 93n], bob);
  const epochs = await client.readContract({ address: wrapper, abi: a.abi, functionName: 'epochs' });
  const epochAbi = parseAbi(['function epoch(uint256) view returns (uint256)']);
  assert.equal(await client.readContract({ address: epochs, abi: epochAbi, functionName: 'epoch', args: [93n] }), 3n);
  await write(wrapper, a.abi, 'unwrap', [93n], owner);
  assert.equal(await client.readContract({ address: epochs, abi: epochAbi, functionName: 'epoch', args: [93n] }), 4n);
  assert.equal(await client.readContract({ address: collection, abi: nftAbi, functionName: 'ownerOf', args: [93n] }), owner);
  assert.equal(await client.readContract({ address: collection, abi: nftAbi, functionName: 'totalSupply' }), supply);
  assert.equal((await remote.getBlock({ blockNumber: block.number })).hash, block.hash);
  console.log(JSON.stringify({ result: 'PASS', scope: 'LOCAL_FORK_ONLY', forkBlock: String(block.number), forkHash: block.hash,
    collectionCodeHash: keccak256(await remote.getCode({ address: collection, blockNumber: block.number })),
    validator, validatorCodeHash: keccak256(await remote.getCode({ address: validator, blockNumber: block.number })),
    initialWrap: 'REJECTED_UNAUTHORIZED_TRANSFER', collectionAdmin: admin,
    conditionalConfiguration: { scope: 'LOCAL_FORK_ONLY', securityLevelUnchanged: policyBefore.transferSecurityLevel,
      originalList: String(policyBefore.operatorWhitelistId), localCopiedList: String(newList),
      onlyAddedOperator: wrapper, authorizersPreserved: true, blacklistPreserved: true, sharedOriginalListUnmodified: true },
    collection, tokenId: 93, originalOwner: owner, supply: String(supply), localFinalEpoch: 4,
    checks: ['unregistered wrapper rejected', 'non-admin list assignment rejected', 'unrelated operator still rejected',
      'deployed collection approval', 'conditional wrap', 'safe receipt transfer', 'round trip', 'unwrap restores owner and supply'],
    productionTransactions: 0 }, null, 2));
} finally {
  if (node.exitCode === null && node.signalCode === null) await new Promise(resolve => { node.once('exit', resolve); node.kill('SIGTERM'); });
}
