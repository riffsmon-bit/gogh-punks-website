import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const source = (name, relative) => process.env[name]
  ? pathToFileURL(path.join(process.env[name], relative)).href
  : new URL(`../${relative}`, import.meta.url).href;
const { linkFindings, createLinkFindingsCard } = await import(source('GOGH_SECURITY_UI_ROOT', 'site/broker-v2-link-findings.js'));
const contract = `0x${'11'.repeat(20)}`, hash = `0x${'aa'.repeat(32)}`;
const fixture = () => ({ link: { kind: 'ROBINHOOD_CONTRACT', identity: contract }, evidence: {
  source: 'ROBINHOOD_MAINNET_RPC', chainId: 4663, contract,
  anchor: { blockHash: hash, blockNumber: '100', canonicalRechecked: true },
  contractInspection: { codeHash: hash, codeBytes: 1, chainId: 4663, contract, blockNumber: '100', blockHash: hash },
  walletAuthority: 'NONE', executionAuthorized: false,
  security: 'PASSED', simulation: 'PASSED', calldata: 'UNTRUSTED_TRANSACTION', instructions: 'SIGN_UNRESTRICTED',
  mint: { status: 'OBSERVED', standard: 'SEADROP_PUBLIC', priceWei: '1', publicWindow: 'OPEN' },
} });

test('independent link card: untrusted extra PASS labels and transaction data never become authority', () => {
  const result = linkFindings(fixture());
  assert.deepEqual(result.rows.slice(-2), [['Security', 'Full review still needed'], ['Simulation', 'Not run']]);
  assert.doesNotMatch(JSON.stringify(result), /PASSED|UNTRUSTED_TRANSACTION|SIGN_UNRESTRICTED/);
  assert.equal(result.rows.find(row => row[0] === 'Mint price')[1], '0.000000000000000001 ETH');
});

test('independent link card: malformed contract types and authority mismatches cannot make a card', () => {
  for (const value of [93, {}, [], null, 'javascript:alert(1)']) {
    const input = fixture(); input.evidence.contract = value; assert.equal(linkFindings(input), null);
  }
  for (const edit of [input => input.evidence.executionAuthorized = true,
    input => input.evidence.walletAuthority = 'SIGN', input => input.evidence.chainId = 1,
    input => input.evidence.anchor.canonicalRechecked = false,
    input => input.evidence.contractInspection = null, input => input.status = 'BLOCKED',
    input => input.evidence.contractInspection.blockHash = `0x${'bb'.repeat(32)}`]) {
    const input = fixture(); edit(input); assert.equal(linkFindings(input), null);
  }
});

test('independent link card: DOM projection inserts plain text and a fixed-origin link only', () => {
  const nodes = [];
  const document = { createElement(tag) {
    const node = { tag, children: [], attributes: {}, append(...items) { this.children.push(...items); },
      setAttribute(key, value) { this.attributes[key] = value; } };
    Object.defineProperty(node, 'innerHTML', { set() { throw Error('Untrusted markup sink'); } });
    nodes.push(node); return node;
  } };
  const result = linkFindings(fixture()), card = createLinkFindingsCard(result, document);
  assert.equal(card.tag, 'section');
  const link = nodes.find(node => node.tag === 'a');
  assert.equal(link.href, `https://robinhoodchain.blockscout.com/address/${contract}`);
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(nodes.some(node => ['script', 'iframe', 'button', 'form'].includes(node.tag)), false);
});

const { createRobinhoodLinkInspector } = await import(source('GOGH_SECURITY_LINK_ROOT', 'broker/src/v4/discovery/robinhood-link-resolver.mjs'));
const fixedNow = 1_789_320_000_000;
function resolverFixture({ wrongChain = false, reorg = false, noCode = true, fetchImpl } = {}) {
  const calls = []; let blocks = 0;
  const inspect = createRobinhoodLinkInspector({ now: () => new Date(fixedNow), timeoutMs: 100,
    environment: { ROBINHOOD_ARCHIVE_RPC_URL: 'https://archive.example/private-test-key' },
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ url, method: body.method, options });
      if (fetchImpl) return fetchImpl(body, options);
      let result;
      if (body.method === 'eth_chainId') result = wrongChain ? '0x1' : '0x1237';
      else if (body.method === 'eth_getBlockByNumber') result = { number: '0x10', timestamp: `0x${BigInt(fixedNow / 1000).toString(16)}`,
        hash: reorg && blocks++ ? `0x${'bb'.repeat(32)}` : hash, transactions: [] };
      else if (body.method === 'eth_getCode' && noCode) result = '0x';
      else throw Error('Unexpected RPC');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json' } });
    } });
  return { calls, inspect: value => inspect(value ?? `https://robinhoodchain.blockscout.com/address/${contract}`) };
}

test('independent link resolver: no deployed code stays blocked with no executable finding', async () => {
  const f = resolverFixture(), result = await f.inspect();
  assert.equal(result.status, 'BLOCKED'); assert.equal(result.reason, 'NO_CONTRACT_CODE');
  assert.equal(result.evidence.contractInspection, null); assert.equal(result.evidence.mint.priceWei, null);
  assert.equal(result.evidence.simulationStatus, 'UNAVAILABLE'); assert.equal(result.executable, false);
  assert.equal(result.evidence.walletAuthority, 'NONE'); assert.equal(result.evidence.executionAuthorized, false);
  assert.ok(f.calls.every(call => call.url === 'https://archive.example/private-test-key' && call.options.redirect === 'error'
    && ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode'].includes(call.method)));
  assert.doesNotMatch(JSON.stringify(result), /private-test-key/);
});
for (const flag of ['wrongChain', 'reorg']) test(`independent link resolver: ${flag} withholds anchored inspection evidence`, async () => {
  const result = await resolverFixture({ [flag]: true }).inspect();
  assert.equal(result.reason, 'INSPECTION_UNAVAILABLE'); assert.equal(result.evidence.anchor, null);
  assert.equal(result.evidence.mint.priceWei, null); assert.equal(result.executable, false);
});

test('independent link resolver: an arbitrary website never becomes the network destination', async () => {
  const f = resolverFixture(), result = await f.inspect('https://attacker.example/mint');
  assert.equal(f.calls.length, 0); assert.equal(result.reason, 'NO_TRUSTED_RESOLVER');
  assert.equal(result.executable, false);
});

test('independent link resolver: RPC error credentials are discarded rather than reflected', async () => {
  const result = await resolverFixture({ fetchImpl: async body => new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id,
    error: { code: -32000, message: 'SECRET_RPC_CREDENTIAL', data: 'SECRET_AUTHORIZATION' } }), { headers: { 'content-type': 'application/json' } }) }).inspect();
  assert.equal(result.reason, 'INSPECTION_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(result), /SECRET_RPC_CREDENTIAL|SECRET_AUTHORIZATION/);
});

test('independent link resolver: oversized response and hung transport cannot produce a successful inspection', async () => {
  const oversized = await resolverFixture({ fetchImpl: async () => new Response('{}', { headers: { 'content-length': '262145' } }) }).inspect();
  assert.equal(oversized.reason, 'INSPECTION_UNAVAILABLE');
  const f = resolverFixture({ fetchImpl: () => new Promise(() => {}) });
  const result = await f.inspect();
  assert.equal(result.reason, 'INSPECTION_UNAVAILABLE'); assert.equal(result.evidence.anchor, null);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].options.signal.aborted, true);
});

test('independent link resolver: a stalled response body is cancelled when the bounded read expires', async () => {
  let cancelled = 0;
  const f = resolverFixture({ fetchImpl: async () => new Response(new ReadableStream({
    pull() {}, cancel() { cancelled += 1; },
  })) });
  const result = await f.inspect();
  assert.equal(result.reason, 'INSPECTION_UNAVAILABLE'); assert.equal(result.evidence.anchor, null);
  assert.equal(f.calls.length, 1); assert.equal(cancelled, 1);
  assert.equal(f.calls[0].options.signal.aborted, true);
});
