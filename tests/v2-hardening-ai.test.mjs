import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAIArtBrokerProvider } from '../broker/src/v4/ai/openai.mjs';
import { AnthropicArtBrokerProvider } from '../broker/src/v4/ai/anthropic.mjs';
import { NetlifyGrokArtBrokerProvider } from '../broker/src/v4/ai/xai-gateway.mjs';
import { createGoghIntelligenceRuntime } from '../broker/src/v4/ai/runtime.mjs';
import { GoghIntelligenceRouter } from '../broker/src/v4/ai/router.mjs';
import { ArtBrokerModelRegistry } from '../broker/src/v4/ai/registry.mjs';
import { ArtBrokerProviderError } from '../broker/src/v4/ai/provider.mjs';
import { handleV2Chat } from '../netlify/functions/broker-v2-chat.mjs';
import { handleV2AiCheck, readV2AiDatabasePrivileges } from '../netlify/functions/broker-v2-ai-check.mjs';

const readPrivileges = async () => ({ usageSelect: true, usageInsert: true, usageUpdate: true,
  registrySelect: true, registryInsert: true, registryUpdate: true });
const gateway = 'https://gogh-punks.netlify.app/.netlify/ai/';
const secret = 'mock-secret-never-public';
const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
for (const [Provider, variable, key, path, payload] of [
  [OpenAIArtBrokerProvider, 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'v1/responses', { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"answer":"OK"}' }] }] }],
  [AnthropicArtBrokerProvider, 'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'v1/messages', { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"answer":"OK"}' }] }],
]) {
  test(`${key} binds direct and managed credentials to their exact approved destination`, async () => {
    let called;
    const provider = new Provider({ modelId: 'configured-model', environment: { [variable]: gateway,
      [key]: secret, NETLIFY_AI_GATEWAY_URL: gateway }, fetchImpl: async (url, options) => {
      called = { url, options }; return new Response(JSON.stringify(payload));
    } });
    assert.deepEqual((await provider.classifyArt({ prompt: 'Classify.', schema })).value, { answer: 'OK' });
    assert.equal(called.url, gateway + path); assert.equal(called.options.redirect, 'error');
    for (const bad of ['https://evil.example/.netlify/ai/', 'http://gogh-punks.netlify.app/.netlify/ai/',
      gateway + '?key=leak', gateway + '#fragment', 'https://gogh-punks.netlify.app:8443/.netlify/ai/',
      'https://gogh-punks.netlify.app/bad/../.netlify/ai/', 'https://user:pass@gogh-punks.netlify.app/.netlify/ai/']) {
      assert.throws(() => new Provider({ modelId: 'model', environment: {
        [variable]: bad, [key]: secret, NETLIFY_AI_GATEWAY_URL: gateway } }));
    }
    assert.throws(() => new Provider({ modelId: 'model', endpoint: 'https://evil.example/' + path,
      environment: { [variable]: gateway, [key]: secret, NETLIFY_AI_GATEWAY_URL: gateway } }));
    assert.throws(() => new Provider({ modelId: 'model', environment: { [variable]: gateway, [key]: secret } }));
  });
}

test('Grok gateway is explicit, uses the platform key and keeps actual provider identity', async () => {
  let called;
  const environment = { GOGH_XAI_MODEL: 'x-ai/grok-4.5', GOGH_XAI_TRANSPORT: 'NETLIFY_GATEWAY',
    NETLIFY_AI_GATEWAY_URL: gateway, NETLIFY_AI_GATEWAY_KEY: secret, XAI_API_KEY: 'do-not-mix-this-key' };
  const runtime = createGoghIntelligenceRuntime({ environment, fetchImpl: async (url, options) => {
    called = { url, options }; return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop',
      message: { content: '{"answer":"OK"}' } }], usage: { prompt_tokens: 2, completion_tokens: 5 } }));
  } });
  const result = await runtime.router.run('CLASSIFY_ART', { prompt: 'Classify.', schema }, { preference: 'XAI' });
  assert.equal(result.provider, 'XAI'); assert.equal(called.url, gateway + 'v1/chat/completions');
  assert.equal(called.options.headers.authorization, `Bearer ${secret}`);
  assert.equal(JSON.parse(called.options.body).model, 'x-ai/grok-4.5');
  assert.equal(JSON.parse(called.options.body).tools, undefined);
  assert.equal((await runtime.providers['xai:auto'].healthCheck()).code, 'CONFIGURED');
  assert.throws(() => new NetlifyGrokArtBrokerProvider({ modelId: 'openai/gpt-5', environment }));
  assert.throws(() => createGoghIntelligenceRuntime({ environment: { ...environment, GOGH_XAI_TRANSPORT: 'AUTO' } }));
  const direct = createGoghIntelligenceRuntime({ environment: { ...environment, GOGH_XAI_TRANSPORT: 'DIRECT' } });
  assert.equal(direct.providers['xai:auto'].endpoint, 'https://api.x.ai/v1/responses');
});

function routerFixture(options = {}) {
  const registry = new ArtBrokerModelRegistry(['OPENAI', 'BANKR', 'ANTHROPIC'].map((provider, i) => ({
    registryKey: `${provider.toLowerCase()}:auto`, provider, modelId: `model-${i}`, displayName: provider,
    capabilities: { supportsImages: false, supportsTools: false, supportsStructuredOutput: true },
    costTier: i + 1, speedTier: 5 - i, fallbackPriority: i + 1, enabled: true,
  })));
  const records = [], reservations = [], calls = [];
  const providers = Object.fromEntries(registry.enabled().map(entry => [entry.registryKey, {
    invoke: async () => { calls.push(entry.provider); return { provider: entry.provider, text: 'Complete reply.', task: 'CHAT' }; },
  }]));
  const router = new GoghIntelligenceRouter({ registry, providers,
    quota: { consume: async value => { reservations.push(value); return `reservation-${reservations.length}`; } },
    usage: { record: async value => records.push(value) }, ...options });
  return { router, providers, records, reservations, calls };
}

test('explicit provider preference cannot fall back to a different provider', async () => {
  const fixture = routerFixture();
  await fixture.router.run('CHAT', { prompt: 'Hello.' }, { preference: 'BANKR' });
  assert.deepEqual(fixture.calls, ['BANKR']);
  assert.equal(fixture.reservations[0].provider, 'BANKR');
  for (const preference of ['openai', '', null, {}, 'attacker', 'OPENAI ']) {
    await assert.rejects(fixture.router.run('CHAT', { prompt: 'Hello.' }, { preference }));
  }
  assert.equal(fixture.reservations.length, 1);
});

test('each fallback reserves quota and accounting failure never buys another generation', async () => {
  const fixture = routerFixture();
  fixture.providers['openai:auto'].invoke = async () => { throw new ArtBrokerProviderError('PROVIDER_TIMEOUT', 'Timeout', { retryable: true }); };
  await fixture.router.run('CHAT', { prompt: 'Hello.' });
  assert.equal(fixture.reservations.length, 2);
  assert.deepEqual(fixture.records.map(x => x.reservationId), ['reservation-1', 'reservation-2']);
  const failed = routerFixture({ usage: { record: async () => { throw new ArtBrokerProviderError('PROVIDER_TIMEOUT', 'Accounting failed', { retryable: true }); } } });
  await assert.rejects(failed.router.run('CHAT', { prompt: 'Hello.' }));
  assert.deepEqual(failed.calls, ['OPENAI']);
  assert.equal(failed.reservations.length, 1);
});

test('one deadline bounds stalled providers and prevents late fallback or result publication', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = routerFixture({ deadlineMs: 1_000 });
  let started, finish, signal;
  const starting = new Promise(resolve => { started = resolve; });
  fixture.providers['openai:auto'].invoke = async (_, __, options) => {
    signal = options.signal; started(); return new Promise(resolve => { finish = resolve; });
  };
  const pending = fixture.router.run('CHAT', { prompt: 'Hello.' });
  const rejected = assert.rejects(pending, { code: 'AI_REQUEST_TIMEOUT' });
  await starting; t.mock.timers.tick(1_000); await rejected;
  assert.equal(signal.aborted, true);
  finish({ provider: 'OPENAI', text: 'Too late.', task: 'CHAT' });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(fixture.calls, []); assert.equal(fixture.reservations.length, 1);
});

test('deadline during reservation cannot start a late provider call', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let complete;
  const fixture = routerFixture({ deadlineMs: 1_000, quota: { consume: () => new Promise(resolve => { complete = resolve; }) } });
  const rejected = assert.rejects(fixture.router.run('CHAT', { prompt: 'Hello.' }), { code: 'AI_REQUEST_TIMEOUT' });
  t.mock.timers.tick(1_000); await rejected; complete('committed-reservation');
  await Promise.resolve(); await Promise.resolve(); assert.deepEqual(fixture.calls, []);
});

const owner = `0x${'1'.repeat(40)}`, punkWallet = `0x${'2'.repeat(40)}`;
process.env.SITE_URL = 'https://goghpunks.xyz';
function chatRequest(body) { return new Request('https://goghpunks.xyz/api/v2/punks/93/chat', {
  method: 'POST', headers: { origin: 'https://goghpunks.xyz', 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
function chatDependencies(call) {
  const client = { release() {}, query: async sql => ({ rows: sql.includes('SELECT conversation_id') ? [{ conversation_id: 'chat' }] : [] }) };
  return { pool: { query: async () => ({ rows: [] }), connect: async () => client },
    requireSession: async () => ({ walletAddress: owner }), readAuthority: async () => ({ punkWallet, blockNumber: '123' }),
    checkAuthority: async () => {}, createIntelligence: () => ({ router: { run: call } }) };
}
test('chat validates provider preference and sends only the exact choice with existing owner binding', async () => {
  const calls = [];
  const deps = chatDependencies(async (...args) => { calls.push(args); return { provider: 'ANTHROPIC', text: 'Hello.', registryKey: 'anthropic:auto' }; });
  for (const providerPreference of ['ANTHROPIC', undefined]) {
    const response = await handleV2Chat(chatRequest({ message: 'What do you think about pixel art?', providerPreference }), deps);
    assert.equal(response.status, 200); assert.equal((await response.json()).economicPermissionsActivated, false);
  }
  assert.equal(calls[0][2].preference, 'ANTHROPIC'); assert.equal(calls[1][2].preference, 'AUTO');
  assert.equal(calls[0][2].ownerFingerprint, owner); assert.equal(calls[0][2].punkTokenId, '93');
  for (const providerPreference of ['openai', '', null, false, {}, 'ANY']) {
    const response = await handleV2Chat(chatRequest({ message: 'Hello.', providerPreference }), deps);
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, 2);
});
test('fixed admin provider probe cannot accept another provider as proof', async () => {
  const environment = { GOGH_V2_AI_CHECK_TOKEN: secret };
  const make = provider => new Request('https://goghpunks.xyz/api/v2/admin/ai/check', { method: 'POST',
    headers: { origin: 'https://goghpunks.xyz', authorization: `Bearer ${secret}` }, body: JSON.stringify({ action: 'check', provider }) });
  const calls = [];
  const createRuntime = () => ({ router: { run: async (...args) => { calls.push(args); return { provider: 'GEMINI', text: 'GOGH_CONNECTION_OK', value: { answer: 'PIXEL_ART' } }; } } });
  const response = await handleV2AiCheck(make('OPENAI'), { environment, createRuntime, readPrivileges });
  assert.equal(response.status, 503); assert.ok((await response.json()).checks.every(x => !x.verified));
  assert.ok(calls.every(x => x[2].preference === 'OPENAI' && x[1].maxOutputTokens === 256));
  assert.equal((await handleV2AiCheck(make('arbitrary'), { environment, createRuntime, readPrivileges })).status, 400);
  assert.equal(calls.length, 2);
});

test('OpenAI accepts exactly one gateway v1 prefix; Anthropic retains its unversioned base', async () => {
  for (const base of [gateway, gateway.slice(0, -1), gateway + 'v1', gateway + 'v1/']) {
    let url;
    const provider = new OpenAIArtBrokerProvider({ modelId: 'configured-model',
      environment: { OPENAI_API_KEY: secret, OPENAI_BASE_URL: base, NETLIFY_AI_GATEWAY_URL: gateway },
      fetchImpl: async value => { url = value; return new Response(JSON.stringify({ status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Ready.' }] }] })); } });
    await provider.chat({ prompt: 'Check.' });
    assert.equal(url, gateway + 'v1/responses');
  }
  for (const base of [gateway + 'v1/v1', gateway + 'v1/../v1', gateway + '%76%31', gateway + 'v2',
    gateway + 'v1?api_key=secret', gateway + 'v1#fragment',
    'https://different.netlify.app/.netlify/ai/v1']) {
    assert.throws(() => new OpenAIArtBrokerProvider({ modelId: 'model', environment: {
      OPENAI_BASE_URL: base, NETLIFY_AI_GATEWAY_URL: gateway } }));
  }
  // The authoritative gateway URL itself is never treated as a versioned URL.
  for (const Provider of [OpenAIArtBrokerProvider, AnthropicArtBrokerProvider]) {
    const variable = Provider === OpenAIArtBrokerProvider ? 'OPENAI_BASE_URL' : 'ANTHROPIC_BASE_URL';
    assert.throws(() => new Provider({ modelId: 'model', environment: {
      [variable]: gateway + 'v1', NETLIFY_AI_GATEWAY_URL: gateway + 'v1' } }));
  }
  for (const base of [gateway + 'v1', gateway + 'v1/', 'https://api.anthropic.com/v1']) {
    assert.throws(() => new AnthropicArtBrokerProvider({ modelId: 'model', environment: {
      ANTHROPIC_BASE_URL: base, NETLIFY_AI_GATEWAY_URL: gateway } }));
  }
});

test('admin privilege check exposes only fixed booleans and blocks every missing grant before providers', async () => {
  const environment = { GOGH_V2_AI_CHECK_TOKEN: secret };
  const request = () => new Request('https://goghpunks.xyz/api/v2/admin/ai/check', { method: 'POST',
    headers: { origin: 'https://goghpunks.xyz', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ action: 'check', provider: 'OPENAI' }) });
  const all = await readPrivileges();
  let providerCalls = 0;
  const createRuntime = () => { providerCalls++; throw Error('Provider must not start.'); };
  for (const name of Object.keys(all)) {
    const response = await handleV2AiCheck(request(), { environment, createRuntime,
      readPrivileges: async () => ({ ...all, [name]: false, database: secret, connectionString: secret }) });
    const body = await response.json();
    assert.equal(response.status, 503); assert.equal(body.code, 'AI_DATABASE_PRIVILEGES_UNAVAILABLE');
    assert.equal(body.databasePrivileges[name], false); assert.equal(body.databasePrivileges.checked, true);
    assert.deepEqual(body.checks, []); assert.equal(JSON.stringify(body).includes(secret), false);
  }
  const response = await handleV2AiCheck(request(), { environment, createRuntime,
    readPrivileges: async () => { throw Error('postgres://user:' + secret + '@private.example'); } });
  const body = await response.json(); assert.equal(response.status, 503);
  assert.equal(body.databasePrivileges.checked, false); assert.equal(JSON.stringify(body).includes(secret), false);
  assert.equal(providerCalls, 0);
});

test('actual database privilege helper uses only fixed read-only catalog SQL and fail-closed fields', async () => {
  let query;
  const result = await readV2AiDatabasePrivileges({ query: async sql => {
    query = sql; return { rows: [{ usageSelect: true, usageInsert: true, usageUpdate: false,
      registrySelect: 'true', registryInsert: true, registryUpdate: null, unexpected: secret }] };
  } });
  assert.match(query, /^SELECT/); assert.match(query, /has_table_privilege/);
  assert.doesNotMatch(query, /GRANT|REVOKE|INSERT INTO|UPDATE broker/);
  assert.deepEqual(result, { usageSelect: true, usageInsert: true, usageUpdate: false,
    registrySelect: false, registryInsert: true, registryUpdate: false });
});

test('stalled database privilege check is bounded and cannot start paid probes later', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let begin, finish, calls = 0;
  const started = new Promise(resolve => { begin = resolve; });
  const request = new Request('https://goghpunks.xyz/api/v2/admin/ai/check', { method: 'POST',
    headers: { origin: 'https://goghpunks.xyz', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ action: 'check', provider: 'OPENAI' }) });
  const pending = handleV2AiCheck(request, { environment: { GOGH_V2_AI_CHECK_TOKEN: secret },
    readPrivileges: () => { begin(); return new Promise(resolve => { finish = resolve; }); },
    createRuntime: () => { calls++; throw Error('must not start'); } });
  await started; t.mock.timers.tick(3_000);
  const response = await pending; assert.equal(response.status, 503);
  assert.equal((await response.json()).databasePrivileges.checked, false);
  finish(await readPrivileges()); await Promise.resolve(); await Promise.resolve();
  assert.equal(calls, 0);
});
