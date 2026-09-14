import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveForgeRpcPair, createForgeRpcClients } from '../broker/src/v4/skill-forge/rpc-clients.mjs';

test('Forge prefers configured archive hosts without exposing URLs in client results', () => {
  const env = { ROBINHOOD_ARCHIVE_RPC_URL: 'https://archive.example/v1/private',
    ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL: 'https://independent.example/rpc',
    RPC_URL: 'https://old.example', ROBINHOOD_AUTOMATION_SECONDARY_RPC_URL: 'https://automation.example' };
  assert.deepEqual(resolveForgeRpcPair(env), { primary: env.ROBINHOOD_ARCHIVE_RPC_URL, secondary: env.ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL });
  const options = [], clients = createForgeRpcClients(env, { transportFactory: (url, config) => ({ url, config }),
    clientFactory: config => { options.push(config); return { marker: options.length }; } });
  assert.deepEqual(clients, [{ marker: 1 }, { marker: 2 }]);
  assert.equal(options[1].transport.url, env.ROBINHOOD_ARCHIVE_RPC_URL);
  assert.equal(options[0].transport.url, env.ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL);
  for (const option of options) {
    assert.equal(option.cacheTime, 0); assert.equal(option.ccipRead, false); assert.equal(option.transport.config.retryCount, 0);
    assert.equal(option.transport.config.fetchOptions.redirect, 'error');
    assert.equal(option.transport.config.batch.batchSize, 20);
  }
});

test('Forge keeps existing private configuration and distinct public defaults', () => {
  assert.deepEqual(resolveForgeRpcPair({}), { primary: 'https://rpc.mainnet.chain.robinhood.com/', secondary: 'https://robinhood-rpc.publicnode.com/' });
  assert.equal(resolveForgeRpcPair({ RPC_URL: 'https://private.example/key' }).primary, 'https://private.example/key');
});

test('Forge fails closed on malformed credentials and same-host receipt providers', () => {
  const secret = 'sensitive-value';
  for (const value of ['', `http://archive.example/${secret}`, `https://user:${secret}@archive.example/`,
    `https://archive.example/key#${secret}`, `bad-${secret}`]) {
    assert.throws(() => resolveForgeRpcPair({ ROBINHOOD_ARCHIVE_RPC_URL: value }), error =>
      error.message === 'FORGE_RPC_CONFIGURATION_UNAVAILABLE' && !error.message.includes(secret));
  }
  assert.throws(() => resolveForgeRpcPair({ ROBINHOOD_ARCHIVE_RPC_URL: 'https://same.example/one',
    ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL: 'https://same.example/two' }), /FORGE_RPC_CONFIGURATION_UNAVAILABLE/);
});

test('training and selected burn both consume the same configured independent clients', async () => {
  const training = await readFile(new URL('../netlify/functions/_shared/forge-training-runtime.mjs', import.meta.url), 'utf8');
  const burn = await readFile(new URL('../netlify/functions/_shared/selected-burn-runtime.mjs', import.meta.url), 'utf8');
  assert.match(training, /const clients = createForgeRpcClients\(environment\)/);
  assert.match(burn, /\{release,pool,clients\}=await forgeTrainingRuntime\('request'\)/);
  assert.doesNotMatch(burn, /publicnode|createPublicClient/);
});
