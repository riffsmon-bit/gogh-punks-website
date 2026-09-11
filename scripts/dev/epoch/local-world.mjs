// Disposable Anvil fixture only. No remote URL, private key or environment override is accepted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData, getAddress,
  http, keccak256, parseAbiParameters, stringToHex } from 'viem';
import { createProgressionReader, createSkillToolGate, manifestHash, instructionHash } from '../../../broker/src/v4/skill-forge/capability-resolver.mjs';

const PUNKS = '0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6';
const CANONICAL = '0x000000006551c19487814612e58FE06813775758';
const ENTRY = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
const ZERO = `0x${'0'.repeat(40)}`, ZERO_HASH = `0x${'0'.repeat(64)}`;
const hashText = text => keccak256(stringToHex(text));
export const artifact = async (file, name) => JSON.parse(await readFile(new URL(`../../../contracts/out/${file}/${name}.json`, import.meta.url), 'utf8'));

export async function startEpochWorld() {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  // Chain 4663 is simulated to exercise exact production domain checks, on loopback only.
  const node = spawn('anvil', ['--silent', '--host', '127.0.0.1', '--port', String(port), '--chain-id', '4663'], { stdio: 'ignore' });
  let startupError;
  node.on('error', error => { startupError = error; });
  const close = async () => {
    if (node.exitCode === null && node.signalCode === null) {
      await new Promise(resolve => { node.once('exit', resolve); node.kill('SIGTERM'); });
    }
  };
  try {
    const transport = http(`http://127.0.0.1:${port}`, { timeout: 10_000, retryCount: 0 });
    const client = createPublicClient({ transport, pollingInterval: 50 });
    let ready = false;
    for (let i = 0; i < 80; ++i) {
      if (startupError) throw startupError;
      if (node.exitCode !== null) throw new Error('LOCAL_NODE_EXITED');
      try { ready = await client.getChainId() === 4663; } catch { }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'LOCAL_NODE_UNAVAILABLE');
    assert.match(await client.request({ method: 'web3_clientVersion' }), /anvil/i);
    const [alice, bob, signer] = (await client.request({ method: 'eth_accounts' })).map(a => getAddress(a));
    const wallet = createWalletClient({ transport, account: alice });
    const load = async (file, name) => ({ ...(await artifact(file, name)), address: undefined });
    const nft = await load('GoghEpochAccount.t.sol', 'EpochFixturePunks');
    const singleton = await load('TestInfrastructure.sol', 'ERC6551RegistryHarness');
    const ep = await load('GoghPunkAgentAccount.t.sol', 'AgentAccountMockEntryPoint');
    for (const [a, address] of [[nft, PUNKS], [singleton, CANONICAL], [ep, ENTRY]]) {
      await client.request({ method: 'anvil_setCode', params: [address, a.deployedBytecode.object] }); a.address = address;
    }
    const history = [];
    const receipt = async (hash, label) => {
      const r = await client.waitForTransactionReceipt({ hash, timeout: 10_000 });
      assert.equal(r.status, 'success'); history.push({ label, hash, block: String(r.blockNumber) }); return r;
    };
    const deploy = async (file, name, args) => {
      const a = await load(file, name);
      const r = await receipt(await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args, chain: null }), `Deploy ${name}`);
      a.address = r.contractAddress; return a;
    };
    const write = async (a, functionName, args = [], owner = alice, value = 0n) => {
      const { request } = await client.simulateContract({ address: a.address, abi: a.abi, functionName, args, account: owner, value });
      return receipt(await wallet.writeContract({ ...request, chain: null }), functionName);
    };
    const read = (a, functionName, args = []) => client.readContract({ address: a.address, abi: a.abi, functionName, args });
    for (const id of [93n, 812n, 813n, 814n]) await write(nft, 'mint', [alice, id]);
    const wrapper = await deploy('GoghPunkSessionWrapper.sol', 'GoghPunkSessionWrapper', [alice]);
    const epochs = await load('GoghOwnershipEpochRegistry.sol', 'GoghOwnershipEpochRegistry'); epochs.address = await read(wrapper, 'epochs');
    const skills = await deploy('GoghSkillRegistry.sol', 'GoghSkillRegistry', [alice]);
    const source = await deploy('GoghEpochAccount.t.sol', 'EpochFixtureCredits', []);
    const snapshot = hashText('DISPOSABLE_EPOCH_RARITY');
    const leafInner = encodeAbiParameters(parseAbiParameters('bytes32,uint256,address,bytes32,uint256,uint8'),
      [hashText('GOGH_RARITY_SLOTS_V1'), 4663n, PUNKS, snapshot, 93n, 2]);
    const progression = await deploy('GoghEpochSkillProgression.sol', 'GoghEpochSkillProgression',
      [wrapper.address, skills.address, source.address, keccak256(keccak256(leafInner)), snapshot]);
    const packages = [
      { manifest: { skillId: 1, version: 1, chainId: 4663, capabilities: ['FREE_MINT'] }, instructions: 'LOCAL ONLY: prepare the approved fixture mint.' },
      { manifest: { skillId: 3, version: 1, chainId: 4663, capabilities: ['CONTRACT_READ'] }, instructions: 'LOCAL ONLY: inspect the disposable collection code.' },
    ].map(p => ({ ...p, status: 'READY', approved: true }));
    const keys = [];
    for (const [i, pack] of packages.entries()) {
      await write(skills, 'register', [pack.manifest.skillId, 1, manifestHash(pack.manifest), instructionHash(pack.instructions), ZERO_HASH, i === 0 ? 2n : 1n, 1]);
      const key = await read(skills, 'skillKey', [pack.manifest.skillId, 1]); keys.push(key);
      await write(skills, 'setStatus', [key, 3, ZERO_HASH]);
      await write(skills, 'setStatus', [key, 4, hashText('LOCAL_FIXTURE_EVIDENCE')]);
    }
    // Credits come from disposable fixture sacrifices before wrapping. No public burn method is added.
    for (const id of [812n, 813n, 814n]) {
      await write(nft, 'approve', [source.address, id]); await write(source, 'award', [progression.address, id, 93n]);
    }
    await write(progression, 'claimRaritySlots', [93n, 2, []]);
    const adapters = await deploy('ArtAdapterRegistry.sol', 'ArtAdapterRegistry', [alice]);
    const venue = await deploy('GoghPunkAgentAccount.t.sol', 'AgentAccountMockVenue', []);
    const art = await deploy('GoghPunkAgentAccount.t.sol', 'AgentAccountMockCollection', [venue.address]);
    const adapter = await deploy('GoghPunkAgentAccount.t.sol', 'AgentAccountMockFreeMintAdapter', [venue.address]);
    await write(adapters, 'registerAdapter', [adapter.address, 1, venue.address, hashText('LOCAL_ADAPTER'), hashText('FREE_ONLY')]);
    const implementation = await deploy('GoghEpochAgentAccount.sol', 'GoghEpochAgentAccount', [ENTRY, adapters.address, wrapper.address, progression.address]);
    const factory = await deploy('GoghEpochAccountRegistry.sol', 'GoghEpochAccountRegistry', [implementation.address, hashText('DISPOSABLE_EPOCH_ACCOUNT')]);
    const account = { ...implementation, address: await read(factory, 'account', [93n]) };
    const pins = { wrapper: wrapper.address, epochs: epochs.address,
      wrapperCodeHash: keccak256(await client.getCode({ address: wrapper.address })), epochsCodeHash: keccak256(await client.getCode({ address: epochs.address })) };
    const readState = createProgressionReader({ client, chainId: 4663, collection: PUNKS, registry: skills.address, progression: progression.address,
      registryCodeHash: keccak256(await client.getCode({ address: skills.address })), progressionCodeHash: keccak256(await client.getCode({ address: progression.address })), epochAuthority: pins });
    const gate = createSkillToolGate({ readState, packages, implementations: {
      inspect_contract: async () => ({ codeHash: keccak256(await client.getCode({ address: PUNKS })), walletAuthority: 'NONE', fixture: true }),
    } });
    let saved;
    const currentOwner = () => read(wrapper, 'resolveOwner', [93n]);
    const state = async () => {
      const p = await readState('93');
      const created = (await client.getCode({ address: account.address })) !== undefined;
      return { localOnly: true, chainId: 4663, tokenId: '93', alice, bob, account: account.address,
        owner: p.owner, wrapped: p.wrapped, epoch: p.epoch, paused: p.executionPaused,
        credits: String(await read(progression, 'trainingCredits', [93n])), slots: p.slots,
        learned: [Number(await read(progression, 'learnedLevel', [93n, keys[0]])), Number(await read(progression, 'learnedLevel', [93n, keys[1]]))],
        equipped: p.equipped.map(e => e.key === keys[0] ? 'Mint Hunter' : 'Contract Detective'),
        created, active: created ? await read(account, 'isAutonomousSessionActive') : false,
        mints: created ? String(await read(account, 'acquisitionNonce')) : '0',
        savedOperation: Boolean(saved), history: [...history].reverse() };
    };
    const config = async () => ({ sessionKey: signer, adapter: adapter.address, venue: venue.address,
      adapterCodeHash: keccak256(await client.getCode({ address: adapter.address })), targetCollection: art.address,
      validAfter: Number((await client.getBlock()).timestamp), validUntil: Number((await client.getBlock()).timestamp) + 86400,
      maxMintsPerDay: 5, maxMintsTotal: 5, maxGasCostWei: 1000000000000000n, minimumNativeReserveWei: 0n });
    const operation = async () => {
      const block = await client.getBlock(); const nonce = await read(account, 'acquisitionNonce');
      const intent = { account: account.address, chainId: 4663n, expectedOwner: await currentOwner(), nonce,
        policyVersion: await read(account, 'sessionGeneration'), opportunityType: 2, assetStandard: 0,
        adapter: adapter.address, venue: venue.address, collection: art.address, tokenId: 700n + nonce,
        assetAmount: 1n, currency: ZERO, expectedPrice: 0n, maxPrice: 0n, maxSlippageBps: 0,
        createdAt: block.timestamp, expiresAt: block.timestamp + 300n,
        opportunityId: hashText(`fixture-${nonce}`), reasoningHash: hashText('LOCAL_SIMULATION'),
        adapterCodeHash: keccak256(await client.getCode({ address: adapter.address })) };
      const op = { sender: account.address, nonce, initCode: '0x', callData: encodeFunctionData({ abi: account.abi, functionName: 'executeSessionAcquisition', args: [intent, '0x'] }),
        accountGasLimits: `0x${((100000n << 128n) | 150000n).toString(16).padStart(64, '0')}`,
        preVerificationGas: 50000n, gasFees: `0x${(1000000000n).toString(16).padStart(64, '0')}`,
        paymasterAndData: '0x', signature: '0x' };
      const hash = keccak256(encodeAbiParameters(parseAbiParameters('address,bytes,uint256'), [op.sender, op.callData, op.nonce]));
      op.signature = await wallet.signMessage({ account: signer, message: { raw: hash } });
      return { op, hash };
    };
    const execute = async ({ op, hash }) => {
      const result = await client.simulateContract({ address: ep.address, abi: ep.abi, functionName: 'validate', args: [account.address, op, hash, 0n], account: alice });
      assert.notEqual(result.result, 1n);
      await write(ep, 'validate', [account.address, op, hash, 0n]);
      await write(ep, 'execute', [account.address, op.callData]);
    };
    const action = async name => {
      const owner = await currentOwner();
      switch (name) {
        case 'wrap': await write(nft, 'approve', [wrapper.address, 93n], owner); await write(wrapper, 'wrap', [93n], owner); break;
        case 'create': await write(factory, 'createAccount', [93n], owner); break;
        case 'learn': await write(progression, 'learnSkill', [93n, keys[0]], owner); await write(progression, 'learnSkill', [93n, keys[1]], owner); break;
        case 'equip': await write(progression, 'equipSkill', [93n, 0, keys[0]], owner); await write(progression, 'equipSkill', [93n, 1, keys[1]], owner); break;
        case 'unequip': await write(progression, 'unequipSkill', [93n, 0], owner); await write(progression, 'unequipSkill', [93n, 1], owner); break;
        case 'authorize': await write(account, 'configureAutonomousSession', [await config()], owner); break;
        case 'save': saved = await operation(); break;
        case 'mint': await execute(await operation()); break;
        case 'replay': if (!saved) throw Error('SAVE_OPERATION_FIRST'); await execute(saved); break;
        case 'transfer': await write(wrapper, 'safeTransferFrom', [owner, owner === alice ? bob : alice, 93n], owner); break;
        case 'unwrap': await write(wrapper, 'unwrap', [93n], owner); break;
        case 'pause': await write(epochs, 'setExecutionPaused', [true]); break;
        case 'resume': await write(epochs, 'setExecutionPaused', [false]); break;
        case 'inspect': return { result: await gate.call({ tokenId: '93', owner, name: 'inspect_contract' }), state: await state() };
        default: throw Error('UNKNOWN_LOCAL_ACTION');
      }
      return { state: await state() };
    };
    return { client, wallet, alice, bob, signer, account, wrapper, epochs, progression, factory, skills, readState, gate,
      implementation, adapters, adapter, venue, art, ep, operation, action, state, close, history, read, write, pins };
  } catch (error) { await close(); throw error; }
}
