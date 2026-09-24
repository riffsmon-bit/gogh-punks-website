import test from 'node:test';
import assert from 'node:assert/strict';
import { createSwarmWalletReadProvider } from '../site/swarm-wallet-rpc.js';
import { swarmWalletErrorMessage } from '../site/swarm-wallet-errors.js';

test('public reader pins endpoint, omits credentials and refuses wallet/transaction methods', async () => {
  const calls = [];
  const provider = createSwarmWalletReadProvider({ fetcher: async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, options, body });
    return { ok: true, text: async () => JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x1237' }) };
  } });
  for (const method of ['eth_accounts', 'eth_requestAccounts', 'eth_sendTransaction', 'eth_sendRawTransaction', 'personal_sign', 'wallet_switchEthereumChain'])
    await assert.rejects(provider.request({ method }), { code: 'SWARM_WALLET_READ_UNAVAILABLE' });
  assert.equal(calls.length, 0);
  assert.equal(await provider.request({ method: 'eth_chainId' }), '0x1237');
  assert.equal(calls[0].url, 'https://rpc.mainnet.chain.robinhood.com');
  assert.equal(calls[0].options.credentials, 'omit'); assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.redirect, 'error');
});

test('bad HTTP/RPC responses and transport errors fail closed without retry or secret leakage', async () => {
  for (const response of [
    { ok: false },
    { ok: true, text: async () => 'not-json' },
    { ok: true, text: async () => JSON.stringify({ jsonrpc: '2.0', id: 999, result: '0x1237' }) },
    { ok: true, text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'SECRET_ENDPOINT' } }) },
    { ok: true, text: async () => 'x'.repeat(2_000_001) },
    null,
  ]) {
    let calls = 0;
    const provider = createSwarmWalletReadProvider({ fetcher: async () => { calls++; if (!response) throw Error('SECRET_ENDPOINT'); return response; } });
    await assert.rejects(provider.request({ method: 'eth_chainId' }), error => {
      assert.equal(error.code, 'SWARM_WALLET_READ_UNAVAILABLE'); assert.doesNotMatch(error.message, /SECRET/); return true;
    });
    assert.equal(calls, 1);
  }
});

test('slow public read is aborted and cannot become an unbounded retry', async () => {
  let calls = 0, aborted = false;
  const provider = createSwarmWalletReadProvider({ timeoutMs: 10, fetcher: async (_url, { signal }) => {
    calls++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(Error('SECRET_ENDPOINT')); }));
  } });
  await assert.rejects(provider.request({ method: 'eth_chainId' }), { code: 'SWARM_WALLET_READ_TIMEOUT' });
  assert.equal(aborted, true); assert.equal(calls, 1);
});

test('holder errors include stable diagnostic codes and actions without raw provider text', () => {
  assert.match(swarmWalletErrorMessage({ code: 'SWARM_WALLET_STALE_CHAIN' }), /old block.*device clock.*STALE_CHAIN/);
  assert.match(swarmWalletErrorMessage({ code: 'SWARM_WALLET_RPC_INVALID' }), /incomplete response.*check/i);
  assert.match(swarmWalletErrorMessage({ code: 'SWARM_WALLET_REVIEW_EXPIRED' }), /fresh review/);
  assert.equal(swarmWalletErrorMessage(Error('Choose 1–10 different Punks for funding.')), 'Choose 1–10 different Punks for funding.');
  for (const code of [undefined, '<script>', 'SWARM_WALLET_UNKNOWN'])
    assert.doesNotMatch(swarmWalletErrorMessage({ code, message: 'SECRET_ENDPOINT' }), /SECRET|<script>/);
});

test('a base-fee change reports a fresh-review action without leaking the RPC message', async () => {
  const provider = createSwarmWalletReadProvider({ fetcher: async (_url, options) => ({ ok: true,
    text: async () => JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(options.body).id,
      error: { code: -32000, message: 'max fee per gas less than block base fee: SECRET_ENDPOINT' } }),
  }) });
  await assert.rejects(provider.request({ method: 'eth_estimateGas' }), error => {
    assert.equal(error.code, 'SWARM_WALLET_FEE_CHANGED'); assert.doesNotMatch(error.message, /SECRET/);
    assert.match(swarmWalletErrorMessage(error), /fresh review/); return true;
  });
});
