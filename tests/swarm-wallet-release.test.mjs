import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keccak256, toFunctionSelector } from 'viem';
import { SWARM_WALLET_RELEASE as release } from '../site/swarm-wallet-release.js';
import { readSwarmWallet } from '../site/swarm-wallet-client.js';
import { AGENT_RECOVERY_PINS as pins } from '../site/punk-agent-recovery.js';
import { CODE } from './fixtures/punk-agent-runtime.mjs';

// Public checked-in evidence only: Netlify does not have contracts/out artifacts.
const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const deployment = json('../deployments/robinhood-swarm-wallet.json');
const factory = json('./fixtures/swarm-wallet-release-runtime.json');
const accountDeployment = json('../deployments/robinhood.json');
const OWNER = '0x' + '1'.repeat(40), OTHER = '0x' + '2'.repeat(40), VAULT = '0x' + '4'.repeat(40);
const word = value => '0x' + BigInt(value).toString(16).padStart(64, '0');
const quantity = value => '0x' + BigInt(value).toString(16);

// AST identifiers/offsets from the reviewed 0.8.34 vault compilation. These are
// independent expected masks, so accidentally widening the release mask fails.
const immutables = {
  3246: { name: 'chainId', starts: [794, 3250, 3697, 4878] },
  3248: { name: 'collection', starts: [961, 3108, 3426] },
  3250: { name: 'registry', starts: [1056, 2468, 3583] },
  3252: { name: 'implementation', starts: [1181, 2957, 3374, 3828] },
  3254: { name: 'canonicalRegistry', starts: [331, 2664, 4030] },
  3256: { name: 'accountSalt', starts: [1115, 2817, 3663] },
  3258: { name: 'registryCodeHash', starts: [2112, 2513] },
  3260: { name: 'implementationCodeHash', starts: [708, 3341] },
  3472: { name: 'owner', starts: [396, 860, 1317, 3534, 4287] },
};
const config = {
  chainId: word(4663), collection: word(pins.collection), registry: word(pins.registry),
  implementation: word(pins.implementation), registryCodeHash: pins.registryHash,
  implementationCodeHash: pins.implementationHash,
  accountSalt: accountDeployment.accountSalt,
  canonicalRegistry: word(accountDeployment.canonicalERC6551Registry),
};
function putWord(code, start, value) {
  const offset = 2 + start * 2;
  return code.slice(0, offset) + word(value).slice(2) + code.slice(offset + 64);
}
function materializeVault(owner = OWNER) {
  let code = release.vaultRuntime.object;
  for (const { name, starts } of Object.values(immutables)) {
    for (const start of starts) code = putWord(code, start, name === 'owner' ? owner : config[name]);
  }
  return code;
}
function changeImmutable(code, name, value, repeated = true) {
  const { starts } = Object.values(immutables).find(item => item.name === name);
  for (const start of repeated ? starts : starts.slice(0, 1)) code = putWord(code, start, value);
  return code;
}
function flipByte(code, offset) {
  const index = 2 + offset * 2;
  const value = Number.parseInt(code.slice(index, index + 2), 16) ^ 1;
  return code.slice(0, index) + value.toString(16).padStart(2, '0') + code.slice(index + 2);
}
function fixture() {
  const calls = [], state = { code: materializeVault(), factoryCode: factory.code };
  const head = { number: quantity(BigInt(deployment.blockNumber) + 100n), hash: word(100), timestamp: quantity(Math.floor(Date.now() / 1000)) };
  const selectors = Object.fromEntries(Object.keys(config).concat('owner', 'nonce', 'getVault', 'isVaultCreated')
    .map(name => [toFunctionSelector(name + (['getVault', 'isVaultCreated'].includes(name) ? '(address)' : '()')), name]));
  const registrySelectors = Object.fromEntries(Object.entries({ accountSalt: config.accountSalt, canonicalRegistry: config.canonicalRegistry,
    ROBINHOOD_CHAIN_ID: config.chainId, GOGH_PUNKS: config.collection, implementation: config.implementation })
    .map(([name, value]) => [toFunctionSelector(name + '()'), value]));
  const provider = { request: async ({ method, params = [] }) => {
    calls.push({ method, params: structuredClone(params) });
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_accounts') return [OWNER];
    if (method === 'eth_getTransactionCount') return '0x1';
    if (method === 'eth_getBlockByNumber') {
      assert.ok(params[0] === 'latest' || params[0] === head.number); return { ...head };
    }
    if (method === 'eth_getBalance') return quantity(10n ** 18n);
    if (method === 'eth_getCode') {
      assert.equal(params[1], head.number);
      if (params[0] === release.factory) return state.factoryCode;
      if (params[0] === VAULT) return state.code;
      if (params[0] === pins.registry) return CODE.registry;
      if (params[0] === pins.implementation) return CODE.implementation;
    }
    if (method === 'eth_call') {
      const [{ to, data }, at] = params; assert.equal(at, head.number);
      if (to === pins.registry && registrySelectors[data]) return registrySelectors[data];
      const name = selectors[data.slice(0, 10)];
      if (to === release.factory) {
        if (name === 'getVault' || name === 'isVaultCreated') {
          assert.equal(data.slice(10), word(OWNER).slice(2)); return name === 'getVault' ? word(VAULT) : word(1);
        }
        if (config[name]) return config[name];
      }
      if (to === VAULT) {
        if (name === 'nonce') return word(0);
        const immutable = Object.values(immutables).find(item => item.name === name);
        if (immutable) {
          // Getter evidence follows the actual patched word rather than returning
          // fixed expected values that could hide a wrong immutable owner/config.
          const offset = 2 + immutable.starts[0] * 2;
          return '0x' + state.code.slice(offset, offset + 64);
        }
      }
    }
    assert.fail(`Unexpected mock method or destination: ${method}`);
  } };
  return { state, calls, read: () => readSwarmWallet(provider, { owner: OWNER, release }) };
}

test('live Swarm release matches public deployment, dependency pins and verified factory bytes', () => {
  assert.equal(release.status, 'LIVE'); assert.equal(deployment.status, 'DEPLOYED_VERIFIED');
  assert.equal(release.chainId, 4663); assert.equal(deployment.chainId, 4663);
  assert.equal(release.factory, deployment.factory); assert.equal(release.factory, factory.address);
  assert.equal(release.factoryCodeHash, deployment.factoryCodeHash); assert.equal(release.factoryCodeHash, factory.hash);
  assert.equal(keccak256(factory.code), release.factoryCodeHash);
  assert.equal((factory.code.length - 2) / 2, 8585);
  assert.match(deployment.transactionHash, /^0x[0-9a-f]{64}$/); assert.match(deployment.blockHash, /^0x[0-9a-f]{64}$/);
  assert.ok(BigInt(deployment.blockNumber) > 0n);
  for (const key of ['chainId', 'collection', 'registry', 'implementation', 'registryCodeHash', 'implementationCodeHash']) {
    assert.equal(release[key], deployment.bindings[key], key);
  }
  assert.equal(release.collection, pins.collection); assert.equal(release.registry, pins.registry);
  assert.equal(release.implementation, pins.implementation);
  assert.equal(release.registryCodeHash, pins.registryHash); assert.equal(release.implementationCodeHash, pins.implementationHash);
  assert.equal(keccak256(CODE.registry), pins.registryHash); assert.equal(keccak256(CODE.implementation), pins.implementationHash);
  assert.equal(deployment.compiler, '0.8.34+commit.80d5c536'); assert.equal(deployment.settings.viaIR, true);
  assert.equal(deployment.settings.optimizer.runs, 500); assert.equal(deployment.settings.evmVersion, 'cancun');
});

test('actual vault template and immutable ranges remain bound to the reviewed compilation', () => {
  assert.equal((release.vaultRuntime.object.length - 2) / 2, 4945);
  assert.equal(keccak256(release.vaultRuntime.object), '0x8fb896f2c2029f3f50712f23e034e88f2e1aa146f72b01051a0aa99fabaeef70');
  assert.deepEqual(release.vaultRuntime.immutableReferences, Object.fromEntries(Object.entries(immutables)
    .map(([id, { starts }]) => [id, starts.map(start => ({ start, length: 32 }))])));
});

test('browser client accepts a materialized real vault template under the unmodified live manifest', async () => {
  const f = fixture(), snapshot = await f.read();
  assert.equal(snapshot.factory, deployment.factory); assert.equal(snapshot.vault, VAULT); assert.equal(snapshot.owner, OWNER);
  assert.equal(snapshot.created, true); assert.equal(snapshot.dependenciesVerified, true);
  assert.equal(snapshot.vaultCodeHash, keccak256(f.state.code)); assert.equal(snapshot.vaultNonce, '0');
  assert.equal(snapshot.accountSalt, config.accountSalt);
  assert.equal(snapshot.canonicalRegistry, accountDeployment.canonicalERC6551Registry.toLowerCase());
  assert.ok(f.calls.length > 0); assert.ok(f.calls.every(({ method }) => !/send|sign|requestAccounts/i.test(method)));
});

test('real release rejects changes outside immutable ranges, runtime length and repeated immutable disagreement', async () => {
  for (const fault of ['instruction', 'trailer', 'length', 'owner-word', 'salt-word', 'factory-code']) {
    const f = fixture();
    if (fault === 'instruction') f.state.code = flipByte(f.state.code, 0);
    if (fault === 'trailer') f.state.code = flipByte(f.state.code, 4944);
    if (fault === 'length') f.state.code += '00';
    if (fault === 'owner-word') f.state.code = changeImmutable(f.state.code, 'owner', OTHER, false);
    if (fault === 'salt-word') f.state.code = changeImmutable(f.state.code, 'accountSalt', 1, false);
    if (fault === 'factory-code') f.state.factoryCode = flipByte(f.state.factoryCode, 0);
    await assert.rejects(f.read(), error => error.code === 'SWARM_WALLET_RUNTIME_CHANGED', fault);
  }
});

test('consistent masked words cannot bypass real vault immutable owner and configuration getter checks', async () => {
  for (const name of ['owner', 'chainId', 'collection', 'registry', 'implementation', 'canonicalRegistry', 'accountSalt', 'registryCodeHash', 'implementationCodeHash']) {
    const f = fixture(); f.state.code = changeImmutable(f.state.code, name, ['owner', 'collection', 'registry', 'implementation', 'canonicalRegistry'].includes(name) ? OTHER : 1);
    await assert.rejects(f.read(), error => error.code === 'SWARM_WALLET_CONFIG_CHANGED', name);
  }
});
