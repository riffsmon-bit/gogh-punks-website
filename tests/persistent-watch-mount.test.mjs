import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPersistentWatchMount } from '../site/broker-persistent-watch-mount.js';
import { createPersistentWatchController } from '../site/broker-persistent-watch.js';
import { OWNER, OTHER, watchConfig, watch, browserIdentity } from './helpers/persistent-watch-fixture.mjs';

class Element {
  constructor(tag, ownerDocument) { this.tagName = tag; this.ownerDocument = ownerDocument;
    this.children = []; this.listeners = {}; this.classList = { add() {} }; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.text = ''; this.children = children; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text ?? '') + this.children.map(child => child.textContent).join(' '); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
}
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const descendants = node => [node, ...node.children.flatMap(descendants)];
function fixture(t, { signed = true, selection = browserIdentity() } = {}) {
  const document = { createElement: tag => new Element(tag, document) }, root = document.createElement('section');
  let selected = { ...selection, preview: false }, signedIn = signed, expiresAt = '2031-01-01T00:00:00.000Z';
  let signIns = 0, currentWatch = null, intercept = null;
  const requests = [], session = () => ({ authenticated: true, walletAddress: selected.owner, expiresAt });
  const request = async (path, options = {}) => {
    requests.push({ path, options });
    if (intercept) { const answer = intercept(path, options); if (answer !== undefined) return answer; }
    if (path === '/api/v2/session') {
      if (!signedIn) throw Object.assign(Error('Sign in'), { code: 'V2_SESSION_REQUIRED' });
      return session();
    }
    const tokenId = path.split('/')[4], payload = options.body && JSON.parse(options.body);
    if (payload?.action === 'prepare') return { ok: true, tokenId, draft: { draftId: 'draft', config: payload.config } };
    if (payload?.action === 'confirm') currentWatch = watch({ tokenId });
    if (payload?.action === 'pause') currentWatch = watch({ tokenId, state: 'PAUSED', version: 2 });
    return { ok: true, tokenId, watch: currentWatch, history: [], summary: { reviewed: 0, matched: 0, passed: 0 },
      status: currentWatch ? { watching: currentWatch.state === 'ACTIVE', state: currentWatch.state } : null };
  };
  const mount = createPersistentWatchMount({ root, getSelection: () => selected, request,
    ensureSession: async () => { signIns++; signedIn = true; }, now: () => Date.parse('2030-01-01') });
  t.after(() => mount.destroy());
  const button = text => descendants(root).find(node => node.tagName === 'button' && node.textContent === text);
  return { root, mount, requests, session, button,
    selected: () => selected, change: patch => { selected = { ...selected, ...patch }; return mount.selectionChanged(); },
    signIns: () => signIns, intercept: value => { intercept = value; }, expiry: value => { expiresAt = value; },
    writes: () => requests.filter(row => row.options.method === 'POST'),
    submit: () => { const form = descendants(root).find(node => node.tagName === 'form');
      form.listeners.submit({ preventDefault() {} }); },
  };
}
test('unsigned holder sees explicit sign-in; mount never opens the wallet or writes', async t => {
  const f = fixture(t, { signed: false }); await f.mount.selectionChanged();
  assert.equal(f.signIns(), 0); assert.equal(f.requests.length, 1); assert.equal(f.writes().length, 0);
  f.button('Sign in to manage watching').listeners.click(); await flush();
  assert.equal(f.signIns(), 1); assert.equal(f.writes().length, 0);
  assert.ok(f.root.textContent.includes('Review watching settings'));
});
test('preview, wrong chain, unsupported host context and disconnected owner never probe the watch API', async t => {
  for (const patch of [{ preview: true }, { chainId: 1 }, { context: null }, { owner: null }]) {
    const f = fixture(t); await f.change(patch); assert.equal(f.requests.length, 0); assert.equal(f.signIns(), 0);
  }
});
test('rendered settings require prepare then explicit confirmation and serialize each body once', async t => {
  const f = fixture(t); await f.mount.selectionChanged();
  const fields = descendants(f.root).filter(node => node.tagName === 'input');
  fields.find(node => node.name === 'likes').value = 'pixel, generative';
  f.submit(); await flush();
  assert.equal(f.writes().length, 1); assert.equal(JSON.parse(f.writes()[0].options.body).action, 'prepare');
  assert.deepEqual(JSON.parse(f.writes()[0].options.body).config.likes, ['pixel', 'generative']);
  assert.ok(f.root.textContent.includes('Review your Punk’s taste and limits'));
  const confirm = f.button('Confirm · activate watching'); confirm.listeners.click(); confirm.listeners.click(); await flush();
  assert.deepEqual(f.writes().map(x => JSON.parse(x.options.body).action), ['prepare', 'confirm']);
  assert.ok(f.root.textContent.includes('OUT LOOKING')); assert.equal(f.signIns(), 0);
  f.button('Pause watching').listeners.click(); await flush();
  assert.deepEqual(f.writes().map(x => JSON.parse(x.options.body).action), ['prepare', 'confirm', 'pause']);
  assert.ok(f.root.textContent.includes('WATCHING PAUSED'));
});
for (const kind of ['owner', 'punk', 'chain', 'context', 'round_trip', 'without_render']) {
  test(`a ${kind} change during the pre-write session check prevents dispatch`, async t => {
    const f = fixture(t); await f.mount.selectionChanged();
    const pending = deferred(); let held = false;
    f.intercept(path => { if (path === '/api/v2/session' && !held) { held = true; return pending.promise; } });
    f.submit();
    if (kind === 'owner') await f.change({ owner: OTHER });
    else if (kind === 'chain') await f.change({ chainId: 1 });
    else if (kind === 'context') await f.change({ context: null });
    else if (kind === 'without_render') f.selected().tokenId = '94';
    else { await f.change({ tokenId: '94' }); if (kind === 'round_trip') await f.change({ tokenId: '93' }); }
    pending.resolve({ authenticated: true, walletAddress: OWNER, expiresAt: '2031-01-01T00:00:00.000Z' }); await flush();
    assert.equal(f.writes().length, 0);
    assert.ok(!f.root.textContent.includes('Confirm · activate watching'));
  });
}
test('changed or expired authenticated sessions invalidate a prepared draft before confirmation', async t => {
  for (const expiry of ['2032-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z']) {
    const f = fixture(t); await f.mount.selectionChanged(); f.submit(); await flush(); f.expiry(expiry);
    f.button('Confirm · activate watching').listeners.click(); await flush();
    assert.equal(f.writes().length, 1); assert.ok(!f.root.textContent.includes('Confirm · activate watching'));
    assert.ok(f.root.textContent.includes('sign-in changed'));
  }
});
test('session notification resets the old review, and stale watch reads cannot restore it after an account round trip', async t => {
  const f = fixture(t), pending = deferred(); let held = false;
  f.intercept(path => { if (path.endsWith('/persistent-watch') && !held) { held = true; return pending.promise; } });
  const old = f.mount.selectionChanged(); await flush();
  await f.change({ owner: OTHER }); await f.change({ owner: OWNER });
  pending.resolve({ ok: true, tokenId: '93', watch: watch({ config: watchConfig({ likes: ['STALE_WATCH'] }) }) }); await old;
  assert.ok(!f.root.textContent.includes('STALE_WATCH'));
  f.submit(); await flush(); assert.ok(f.root.textContent.includes('Confirm · activate watching'));
  await f.mount.sessionChanged(null); assert.ok(!f.root.textContent.includes('Confirm · activate watching'));
});
test('failed fresh reads clear actionable controller data and draft instead of displaying stale authority', async () => {
  let fail = false;
  const control = createPersistentWatchController({ request: async (_path, options) => {
    if (fail) throw Error('Offline');
    return options.body ? { ok: true, tokenId: '93', draft: { draftId: 'draft', config: watchConfig() } }
      : { ok: true, tokenId: '93', watch: watch() };
  } });
  control.setIdentity(browserIdentity()); await control.refresh(); await control.prepare(watchConfig());
  fail = true; await control.refresh(); assert.equal(control.getState().draft, null); assert.equal(control.getState().data, null);
  assert.equal(await control.confirm(), false); assert.equal(await control.pause(), false);
});
test('actual holder screen mounts watching outside the administrator and purchase mounts with immediate wallet invalidation', async () => {
  const source = await readFile(new URL('../site/broker-v2.js', import.meta.url), 'utf8');
  const page = await readFile(new URL('../site/broker/v2/index.html', import.meta.url), 'utf8');
  assert.match(page, /href="\/broker-persistent-watch\.css"/); assert.match(page, /data-persistent-watch/);
  assert.match(source, /function renderRoster\(\) \{\s+void persistentWatchControl\?\.selectionChanged\(\)/);
  assert.match(source, /state\.wallet = \{ \.\.\.wallet, account \};\s+\/\/[^\n]+\n\s+void persistentWatchControl\?\.selectionChanged\(\)/);
  assert.ok(source.indexOf('persistentWatchControl = createPersistentWatchMount') > source.indexOf('const recoveryRoot ='));
  assert.ok(source.includes('forgeSkillAdminControl = createForgeSkillAdminPanel'));
  assert.match(source, /ownershipAccount === state\.wallet\?\.account/);
});
