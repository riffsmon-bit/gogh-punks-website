import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoghIntelligenceRuntime } from '../broker/src/v4/ai/runtime.mjs';
import { availableProviderPreferences, validProviderPreference } from '../site/broker-v2-preferences.js';

const environment = { GOGH_GROQ_MODEL: 'openai/gpt-oss-20b', GROQ_API_KEY: 'local-test-key',
  GOGH_GEMINI_MODEL: 'fixture-gemini', GEMINI_API_KEY: 'local-other-key' };
const reply = { model: 'openai/gpt-oss-20b', choices: [{ finish_reason: 'stop', message: { content: 'Ready.' } }] };

test('Auto selects configured Groq for text; explicit selection stays with Groq and accounts once', async () => {
  const reservations = [], usage = [], requests = [];
  const { router, registry } = createGoghIntelligenceRuntime({ environment,
    quota: { consume: async context => { reservations.push(context); return 'reservation'; } },
    usage: { record: async result => usage.push(result) },
    fetchImpl: async (url, request) => { requests.push({ url, request }); return new Response(JSON.stringify(reply)); } });
  assert.equal(router.candidates('CHAT')[0].provider, 'GROQ');
  assert.equal(registry.get('groq:auto').capabilities.supportsImages, false);
  assert.equal(registry.enabled().some(row => row.provider === 'BANKR'), false);
  const result = await router.run('CHAT', { prompt: 'Hello' }, { preference: 'GROQ', ownerFingerprint: 'holder', punkTokenId: '93' });
  assert.equal(result.provider, 'GROQ'); assert.equal(requests.length, 1);
  assert.equal(reservations.length, 1); assert.equal(usage.length, 1);
  assert.equal(usage[0].reservationId, 'reservation'); assert.equal(usage[0].resultCode, 'OK');
  assert.equal(requests[0].url, 'https://api.groq.com/openai/v1/chat/completions');
});

test('Groq free rate limit is terminal even on Auto; another provider is not charged', async () => {
  let calls = 0; const usage = [];
  const { router } = createGoghIntelligenceRuntime({ environment,
    usage: { record: async result => usage.push(result) },
    fetchImpl: async () => { calls++; return new Response('private upstream text', { status: 429 }); } });
  await assert.rejects(router.run('CHAT', { prompt: 'Hello' }), { code: 'PROVIDER_RATE_LIMIT', retryable: false });
  assert.equal(calls, 1); assert.equal(usage.length, 1); assert.equal(usage[0].resultCode, 'PROVIDER_RATE_LIMIT');
});

test('A saved key alone does not enable Groq and the preference UI reflects server availability', () => {
  const { registry } = createGoghIntelligenceRuntime({ environment: { GROQ_API_KEY: 'local-test-key' } });
  assert.equal(registry.enabled().length, 0);
  assert.equal(validProviderPreference('GROQ'), 'GROQ');
  assert.deepEqual(availableProviderPreferences({ ok: true, providers: [
    { provider: 'GROQ', health: { ok: true } }, { provider: 'BANKR', health: { ok: false } },
  ] }), ['AUTO', 'GROQ']);
});

test('Bankr text-only adapter is not advertised as accepting images', () => {
  const { registry } = createGoghIntelligenceRuntime({ environment: { GOGH_BANKR_MODEL: 'reviewed-text-model' } });
  assert.equal(registry.get('bankr:auto').capabilities.supportsImages, false);
});
