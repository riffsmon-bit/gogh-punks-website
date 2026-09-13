import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createGoghIntelligenceRuntime } from '../broker/src/v4/ai/runtime.mjs';
import { handleV2AiCheck } from '../netlify/functions/broker-v2-ai-check.mjs';
import { createForgeRpcClients } from '../broker/src/v4/skill-forge/rpc-clients.mjs';

// Independent release review: exercise the real adapter/router/admin seam with
// synthetic credentials and injected accounting. No external network or DB.
const originalSiteUrl = process.env.SITE_URL;
process.env.SITE_URL = 'https://goghpunks.xyz';
after(() => {
  if (originalSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = originalSiteUrl;
});
const secret = 'synthetic-review-provider-secret';
const adminSecret = 'synthetic-review-admin-secret';
const environment = { GROQ_API_KEY: secret, GOGH_GROQ_MODEL: 'openai/gpt-oss-20b',
  GOGH_V2_AI_CHECK_TOKEN: adminSecret, GEMINI_API_KEY: 'synthetic-other-key',
  GOGH_GEMINI_MODEL: 'fixture-gemini' };
const privileges = async () => ({ usageSelect: true, usageInsert: true, usageUpdate: true,
  registrySelect: true, registryInsert: true, registryUpdate: true });
const request = () => new Request('https://goghpunks.xyz/api/v2/admin/ai/check', {
  method: 'POST', headers: { origin: 'https://goghpunks.xyz',
    authorization: `Bearer ${adminSecret}`, 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'check', provider: 'GROQ' }),
});

for (const [status, code] of [[400, 'PROVIDER_INPUT_REJECTED'], [401, 'PROVIDER_AUTHENTICATION_FAILED'],
  [402, 'PROVIDER_CREDIT_LIMIT'], [403, 'PROVIDER_ACCESS_DENIED'],
  [422, 'PROVIDER_INPUT_REJECTED'], [429, 'PROVIDER_RATE_LIMIT']]) {
  test(`independent review: Groq ${status} stays sanitized and accounted through the real admin probe`, async () => {
    const reservations = [], outcomes = [], destinations = [];
    const runtime = createGoghIntelligenceRuntime({ environment,
      quota: { consume: async context => { reservations.push(context); return `reservation-${reservations.length}`; } },
      usage: { record: async value => outcomes.push(value) },
      fetchImpl: async (url, options) => {
        destinations.push(url);
        assert.equal(options.headers.authorization, `Bearer ${secret}`);
        return new Response(`untrusted body ${secret} ${adminSecret}`, { status });
      },
    });
    const response = await handleV2AiCheck(request(), {
      environment, readPrivileges: privileges, createRuntime: () => runtime,
    });
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.equal(result.walletAuthority, 'NONE');
    assert.equal(result.transactionSubmitted, false);
    assert.equal(result.checks.length, 2);
    assert.ok(result.checks.every(check => !check.verified && check.code === code && check.httpStatus === status));
    assert.deepEqual(destinations, Array(2).fill('https://api.groq.com/openai/v1/chat/completions'));
    assert.equal(reservations.length, 2);
    assert.equal(outcomes.length, 2);
    assert.ok(outcomes.every(value => value.provider === 'GROQ' && value.resultCode === code));
    assert.equal(new Set(outcomes.map(value => value.reservationId)).size, 2);
    assert.ok(!JSON.stringify(result).includes(secret) && !JSON.stringify(result).includes(adminSecret));
    assert.match(response.headers.get('cache-control'), /no-store/);
  });
}

test('independent review: denied Groq quota prevents both admin network probes', async () => {
  let calls = 0;
  const runtime = createGoghIntelligenceRuntime({ environment,
    quota: { consume: async () => false },
    fetchImpl: async () => { calls++; throw Error('UNEXPECTED_NETWORK'); },
  });
  const response = await handleV2AiCheck(request(), {
    environment, readPrivileges: privileges, createRuntime: () => runtime,
  });
  assert.equal(response.status, 503);
  assert.ok((await response.json()).checks.every(check => check.code === 'AI_QUOTA_EXCEEDED'));
  assert.equal(calls, 0);
});

test('independent review: malformed configured Forge pair cannot construct either transport', () => {
  let transports = 0;
  assert.throws(() => createForgeRpcClients({
    ROBINHOOD_ARCHIVE_RPC_URL: `https://user:${secret}@archive.example/`,
    ROBINHOOD_RPC_URL: 'https://valid-fallback.example/',
  }, { transportFactory: () => { transports++; throw Error('UNEXPECTED_TRANSPORT'); } }),
  error => error.message === 'FORGE_RPC_CONFIGURATION_UNAVAILABLE' && !error.message.includes(secret));
  assert.equal(transports, 0);
});
