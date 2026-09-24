// Local-only guided journey. The fixture throws on every real wallet/RPC call.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Also used by the unit journey, so its canonical journal fixture is identical.
export function createSetupFixture({ root, mountSwarmSetup, keccak256Hex, saved = new Map() }) {
  const OWNER = '0x' + '1'.repeat(40), VAULT = '0x' + '2'.repeat(40), FACTORY = '0x' + '3'.repeat(40), HASH = '0x' + 'a'.repeat(64);
  const word = value => BigInt(value).toString(16).padStart(64, '0');
  const hex = value => '0x' + BigInt(value).toString(16);
  const digest = text => keccak256Hex('0x' + [...new TextEncoder().encode(text)].map(v => v.toString(16).padStart(2, '0')).join(''));
  const selector = text => digest(text).slice(0, 10), agent = id => '0x' + word(BigInt(id) + 100n).slice(-40);
  const state = { owner: OWNER, chainId: 4663, selected: '349', punks: ['93', '94'], created: new Set(['93']),
    vaultCreated: false, balance: 0n, ownerNonce: 8n, vaultNonce: 0n, creationRecord: null, walletRecord: null,
    calls: [], sends: [], storageFailure: false, holdRead: null, readRelease: null,
    missionStatuses: new Map(), missionRecoveryOverrides: null };
  const provider = { request() { throw Error('Real wallet and RPC requests are forbidden in this fixture'); } };
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => {
    if (state.storageFailure) throw Error('Fixture device storage is full'); saved.set(key, value);
  }, removeItem: key => saved.delete(key) };
  const readAccount = async (_provider, { owner, tokenId }) => {
    state.calls.push(['read-account', tokenId]);
    if (state.readErrors?.has(tokenId)) throw state.readErrors.get(tokenId);
    if (state.holdRead === tokenId) await new Promise(done => { state.readRelease = done; });
    return { owner, chainId: 4663, tokenId, account: agent(tokenId), created: state.created.has(tokenId) };
  };
  function prepared(action, owner) {
    const timestamp = String(Math.floor(Date.now() / 1000)), expiresAt = (Number(timestamp) + 90) * 1000;
    const nonce = state.vaultNonce.toString(), allocations = (action.allocations ?? []).map(row => ({ ...row, account: agent(row.tokenId) }));
    const data = action.kind === 'CREATE' ? selector('createVault()') : action.kind === 'DEPOSIT' ? selector('deposit()')
      : selector('fundBatch((uint256,uint256)[],uint256,uint256)') + word(96) + word(nonce) + word(expiresAt / 1000)
        + word(allocations.length) + allocations.map(row => word(row.tokenId) + word(row.amountWei)).join('');
    return { schema: 'GOGH_SWARM_WALLET_REVIEW_V1', owner, chainId: 4663, releaseIdentity: HASH, factory: FACTORY,
      action, vault: VAULT, created: action.kind !== 'CREATE', vaultNonce: action.kind === 'CREATE' ? null : nonce,
      accountSalt: '0x' + word(0), canonicalRegistry: FACTORY, vaultCodeHash: action.kind === 'CREATE' ? null : HASH,
      allocations, anchor: { number: '100', hash: HASH, timestamp }, expiresAt,
      transaction: { chainId: '0x1237', from: owner, to: action.kind === 'CREATE' ? FACTORY : VAULT,
        value: action.kind === 'DEPOSIT' ? hex(action.amountWei) : '0x0', data, nonce: hex(state.ownerNonce), gas: '0x186a0', gasPrice: '0xf4240' },
      maximumNetworkFeeWei: '100000000000' };
  }
  function receipt(review, transactionHash) {
    const event = (address, signature, topics, data) => ({ address,
      topics: [digest(signature), ...topics.map(value => '0x' + word(value))], data: '0x' + data.map(word).join('') });
    const { action, owner, vaultNonce } = review;
    const events = action.kind === 'CREATE' ? [event(FACTORY, 'VaultCreated(address,address)', [owner, VAULT], [])]
      : action.kind === 'DEPOSIT' ? [event(VAULT, 'Deposit(address,uint256)', [owner], [action.amountWei])]
        : [...review.allocations.map(row => event(VAULT, 'PunkFunded(uint256,uint256,address,uint256)', [vaultNonce, row.tokenId, row.account], [row.amountWei])),
          event(VAULT, 'BatchFunded(uint256,uint256,uint256)', [vaultNonce], [review.allocations.length, review.allocations.reduce((sum, row) => sum + BigInt(row.amountWei), 0n)])];
    return { transactionHash, blockNumber: '101', blockHash: HASH, status: '0x1', events };
  }
  const creationClient = {
    getAgentWalletCreationRecord: owner => state.creationRecord?.owner === owner ? state.creationRecord : null,
    readAgentWalletCreation: readAccount,
    prepareAgentWalletCreation: async (_provider, value) => {
      state.calls.push(['prepare-account', value.tokenId]);
      return { ...await readAccount(_provider, value), registry: FACTORY, maximumNetworkFeeWei: '1000', expiresAt: Date.now() + 90000 };
    },
    submitAgentWalletCreation: async (_provider, review, { isCurrent }) => {
      if (!isCurrent()) throw Error('Stale creation'); state.sends.push(['CREATE_AGENT', review.tokenId]);
      return state.creationRecord = { owner: review.owner, status: 'SUBMITTED', review, transactionHash: HASH };
    },
    recoverAgentWalletCreation: async () => {
      state.created.add(state.creationRecord.review.tokenId); state.creationRecord = { ...state.creationRecord, status: 'CONFIRMED' };
      return state.creationRecord;
    },
  };
  const walletClient = {
    getSwarmWalletRecord: owner => state.walletRecord?.owner === owner ? state.walletRecord : null,
    readSwarmWallet: async () => { state.calls.push(['read-vault']); return { owner: state.owner, chainId: 4663,
      created: state.vaultCreated, vault: VAULT, balanceWei: String(state.balance), dependenciesVerified: true }; },
    prepareSwarmWallet: async (_provider, { owner, action }) => { state.calls.push(['prepare-vault', action.kind]); return prepared(action, owner); },
    submitSwarmWallet: async (_provider, review, { isCurrent }) => {
      if (!isCurrent()) throw Error('Stale funding'); state.sends.push([review.action.kind, review.action.allocations ?? review.action.amountWei ?? '0']);
      return state.walletRecord = { schema: 'GOGH_SWARM_WALLET_JOURNAL_V1', owner: review.owner,
        status: 'SUBMITTED', review, transactionHash: HASH, receipt: null };
    },
    recoverSwarmWallet: async () => {
      const record = state.walletRecord, action = record.review.action;
      if (record.status === 'CONFIRMED') return record;
      if (action.kind === 'CREATE') state.vaultCreated = true;
      if (action.kind === 'DEPOSIT') state.balance += BigInt(action.amountWei);
      if (action.kind === 'BATCH') { state.balance -= action.allocations.reduce((sum, row) => sum + BigInt(row.amountWei), 0n); state.vaultNonce++; }
      state.ownerNonce++;
      return state.walletRecord = { ...record, status: 'CONFIRMED', receipt: receipt(record.review, record.transactionHash) };
    },
  };
  let controller;
  const mount = () => controller = mountSwarmSetup({ root,
    getContext: () => ({ owner: state.owner, chainId: state.chainId }),
    getPunks: () => state.punks.map(tokenId => ({ tokenId })), getProvider: () => provider,
    storage, readAccount, creationOptions: { client: creationClient, readProvider: provider, locks: {} },
    walletOptions: { client: walletClient, release: { status: 'LIVE' }, readProvider: provider, locks: {} },
    openReview: async ({ tokenId }) => { state.calls.push(['mission-review', tokenId]); return {
      intentHash: HASH, intent: { punkTokenId: tokenId, expectedOwner: state.owner } }; },
    checkMission: async tokenId => {
      state.calls.push(['mission-check', tokenId]);
      const overrides = state.missionStatuses.get(tokenId) ?? {}, now = Date.now();
      return { ok: true, tokenId, owner: state.owner, chainId: 4663, receivedAt: now, ...overrides,
        runtime: overrides.runtime === null ? null : { accountCreated: state.created.has(tokenId),
          owner: state.owner, account: agent(tokenId), sessionActive: false, ...overrides.runtime },
        mission: !overrides.mission ? overrides.mission ?? null : {
          account: agent(tokenId), authorizationTransactionHash: HASH,
          validAfter: new Date(now - 60_000).toISOString(), validUntil: new Date(now + 3_600_000).toISOString(),
          ...overrides.mission, intent: overrides.mission.intent === null ? null : {
            expectedOwner: state.owner, punkTokenId: tokenId, ...overrides.mission.intent },
        },
      };
    },
    recoverMission: async value => {
      state.calls.push(['mission-recover', value]);
      state.missionStatuses.set(value.tokenId, { runtime: { sessionActive: true }, mission: {
        status: 'ACTIVE', sessionId: value.sessionId, authorizationTransactionHash: value.authorizationTransactionHash,
      } });
      const overrides = state.missionRecoveryOverrides ?? {};
      return { ok: true, tokenId: value.tokenId, strategyActivated: true, ...overrides,
        session: { sessionId: value.sessionId, status: 'ACTIVE', transactionHash: value.authorizationTransactionHash,
          ...overrides.session },
      };
    },
    openStatus: tokenId => state.calls.push(['open-status', tokenId]),
  });
  mount();
  return { state, saved, storage, provider, walletClient, creationClient, get controller() { return controller; },
    remount: mount, refresh: () => controller.refresh(),
    savedPlan: () => JSON.parse(saved.get('gogh-swarm-setup-v1:4663:' + state.owner) ?? 'null'),
    approveMission: tokenId => {
      const identity = { tokenId, intentHash: HASH }, attempt = { sessionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', setupArtifactHash: HASH };
      controller.missionPrepared(identity, attempt); controller.missionSubmitted(identity, HASH); controller.authorization(identity, 'AUTHORIZED');
      state.missionStatuses.set(tokenId, { runtime: { sessionActive: true }, mission: { status: 'ACTIVE', sessionId: attempt.sessionId } });
    } };
}

export async function runBrowserJourney() {
  assert.equal(process.argv.length, 2, 'This harness accepts no remote URL or wallet configuration.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = await mkdtemp('/private/tmp/gogh-swarm-setup-browser-'), profile = await mkdtemp('/private/tmp/gogh-swarm-setup-profile-');
  const result = { status: 'RUNNING', mode: 'LOCAL_BROWSER_WITH_WALLET_FIXTURE', output, viewports: [], errors: [], screenshots: [] };
  const fixture = `import {mountSwarmSetup} from '/broker-swarm-setup.js'; import {keccak256Hex} from '/keccak256.js'; window.fixture=(${createSetupFixture.toString()})({root:document.querySelector('main'),mountSwarmSetup,keccak256Hex});`;
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/broker-v2.css"></head><body><main></main><script type="module" src="/fixture.js"></script></body></html>'); return; }
      if (req.url === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(fixture); return; }
      if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (!/^\/[a-z0-9/_.-]+\.(js|css)$/.test(req.url) || req.url.includes('..')) { res.writeHead(404); res.end(); return; }
      const file = resolve(root, 'site', '.' + req.url); assert.ok(file.startsWith(resolve(root, 'site') + '/'));
      res.setHeader('content-type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--disk-cache-size=1', '--media-cache-size=1', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise(done => chrome.once('exit', done)); let ws;
  try {
    const endpoint = await new Promise((done, reject) => { let text = ''; const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 20000);
      chrome.once('error', error => { clearTimeout(timer); reject(error); }); chrome.stderr.on('data', value => { text += value; const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); done(match[1]); } }); });
    const target = await (await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`, { method: 'PUT' })).json();
    ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((done, reject) => { ws.onopen = done; ws.onerror = reject; });
    let id = 0; const pending = new Map();
    const call = (method, params = {}) => new Promise((done, reject) => { const number = ++id, timer = setTimeout(() => { pending.delete(number); reject(Error(method + ' timeout')); }, 15000);
      pending.set(number, { done: value => { clearTimeout(timer); done(value); }, reject: error => { clearTimeout(timer); reject(error); } }); ws.send(JSON.stringify({ id: number, method, params })); });
    ws.onmessage = ({ data }) => { const message = JSON.parse(data); if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (item) message.error ? item.reject(Error(JSON.stringify(message.error))) : item.done(message.result); }
      if (message.method === 'Runtime.exceptionThrown') result.errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') result.errors.push(message.params.args.map(a => a.value ?? a.description).join(' '));
      if (message.method === 'Fetch.requestPaused') { const p = message.params; if (p.request.url.startsWith(origin + '/')) void call('Fetch.continueRequest', { requestId: p.requestId });
        else { result.errors.push('External request blocked: ' + new URL(p.request.url).origin); void call('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }); } } };
    for (const method of ['Runtime.enable', 'Page.enable']) await call(method);
    await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    const evaluate = async expression => { const value = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text); return value.result.value; };
    const until = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(done => setTimeout(done, 50)); } throw Error('UI timeout: ' + expression); };
    const find = name => `document.querySelector('[data-${name}]')`;
    const click = async name => { assert.equal(await evaluate(find(name) + '.disabled'), false, name + ' enabled'); await evaluate(find(name) + '.click()'); };
    const shot = async name => {
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false, name + ': no horizontal overflow');
      const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      await writeFile(join(output, name), Buffer.from(screenshot.data, 'base64')); result.screenshots.push(name);
    };
    const approve = async prefix => { await evaluate(find(prefix + '-consent') + '.click()'); await click(prefix + '-confirm'); await until('!' + find(prefix + '-recovery') + '.hidden'); await click(prefix + '-recover'); await until(find(prefix + '-recovery') + '.hidden'); };
    for (const [width, height] of [[1440, 1000], [375, 812], [320, 740]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await call('Page.navigate', { url: origin }); await until('Boolean(window.fixture)');
      assert.equal(await evaluate('fixture.state.calls.length'), 0);
      await evaluate(`${find('swarm-setup-plan-form')}.querySelectorAll('input[type=checkbox]').forEach(n=>n.click()); document.querySelector('[name=fundingBudgetEth]').value='0.002'; ${find('swarm-setup-plan-form')}.requestSubmit();`);
      await until('Boolean(' + find('swarm-setup-check-wallets') + ')'); assert.equal(await evaluate('fixture.state.sends.length'), 0);
      await shot(`plan-${width}.png`); await click('swarm-setup-check-wallets'); await until('!' + find('agent-wallet-creation-prepare') + '.disabled');
      assert.match(await evaluate(find('agent-wallet-creation-title') + '.textContent'), /#94/);
      await click('agent-wallet-creation-prepare'); await until('!' + find('agent-wallet-creation-review') + '.hidden'); await shot(`agent-creation-${width}.png`); await approve('agent-wallet-creation');
      await click('swarm-setup-to-funding'); await until('!' + find('swarm-wallet-create') + '.hidden');
      await click('swarm-wallet-create'); await until('!' + find('swarm-wallet-review') + '.hidden'); await approve('swarm-wallet');
      await click('swarm-wallet-deposit'); await until('!' + find('swarm-wallet-review') + '.hidden'); await approve('swarm-wallet');
      await click('swarm-wallet-batch'); await until('!' + find('swarm-wallet-review') + '.hidden'); await shot(`batch-review-${width}.png`); await approve('swarm-wallet');
      await until('!' + find('swarm-setup-to-missions') + '.disabled'); await click('swarm-setup-to-missions');
      for (const tokenId of ['93', '94']) {
        await click('swarm-setup-next-mission'); await until(`fixture.state.calls.some(c=>c[0]==='mission-review'&&c[1]==='${tokenId}')`);
        await evaluate(`fixture.approveMission('${tokenId}')`);
        if (tokenId === '93') {
          await evaluate('fixture.remount()'); await until('Boolean(' + find('swarm-setup-mission-hash') + ')');
          assert.equal(await evaluate(find('swarm-setup-next-mission') + '.disabled'), true);
          assert.equal(await evaluate("fixture.state.calls.filter(c=>c[0]==='mission-review').length"), 1);
          await shot(`mission-recovery-${width}.png`);
          await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='RECOVER MISSION CONFIRMATION').click()");
          await until('!' + find('swarm-setup-next-mission') + '.disabled');
          assert.equal(await evaluate('fixture.state.sends.length'), 4);
        }
      }
      await until("document.querySelector('main').textContent.includes('Swarm setup is finished')");
      assert.deepEqual(await evaluate('fixture.state.sends.map(s=>s[0])'), ['CREATE_AGENT', 'CREATE', 'DEPOSIT', 'BATCH']);
      assert.equal(await evaluate('fixture.state.balance.toString()'), '0');
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false, 'No horizontal overflow');
      await shot(`complete-${width}.png`); result.viewports.push({ width, height, fundedPunks: 2, batches: 1, overflow: false });
    }
    assert.deepEqual(result.errors, []); result.status = 'PASS';
  } catch (error) { result.status = 'FAIL'; result.failure = error.stack; process.exitCode = 1; }
  finally { await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2)); ws?.close(); chrome.kill('SIGTERM'); await exited; await rm(profile, { recursive: true, force: true }); await new Promise(done => server.close(done)); console.log(JSON.stringify(result, null, 2)); }
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runBrowserJourney();
