// Uses a separate headless Chrome profile on loopback; never the owner's wallet profile.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEpochRehearsal } from './server.mjs';
if (process.argv.length !== 3 || process.argv[2] !== '--local-only') throw Error('Requires --local-only');
const rehearsal = await startEpochRehearsal();
let ws, page;
try {
  const denied = await fetch(`${rehearsal.url}/action`, { method: 'POST', headers: { Origin: 'https://example.invalid', 'Content-Type': 'application/json' }, body: '{"action":"wrap"}' });
  assert.equal(denied.status, 403);
  assert.equal((await rehearsal.world.state()).wrapped, false);
  page = await (await fetch(`http://127.0.0.1:9231/json/new?${encodeURIComponent(rehearsal.url)}`, { method: 'PUT' })).json();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = ({ data }) => { const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    const task = pending.get(message.id); if (task) { pending.delete(message.id); message.error ? task.reject(Error(JSON.stringify(message.error))) : task.resolve(message.result); }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); ws.send(JSON.stringify({ id: next, method, params })); });
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const until = async expression => { for (let i = 0; i < 200; ++i) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw Error(`DOM timeout: ${expression}`); };
  const click = async (action, blocked = false) => {
    await evaluate(`document.querySelector('[data-action="${action}"]').click()`);
    await until("!document.querySelector('[data-action=wrap]').disabled");
    const error = await evaluate("document.querySelector('#notice').dataset.error === 'true'");
    assert.equal(error, blocked, `${action}: ${await evaluate("document.querySelector('#notice').textContent")}`);
  };
  await call('Page.enable'); await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await until("document.querySelector('#notice')?.textContent.includes('Ready.')");
  await click('wrap'); await click('create'); await click('learn'); await click('authorize', true);
  await click('equip'); await click('inspect'); await click('authorize'); await click('save');
  await click('transfer'); await click('transfer'); await click('replay', true);
  await click('authorize'); await click('mint');
  assert.equal((await rehearsal.world.state()).mints, '1');
  const output = await mkdtemp(join(tmpdir(), 'gogh-epoch-review-'));
  for (const [name, width, height, mobile] of [['desktop', 1440, 1000, false], ['mobile', 390, 844, true]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${name} horizontal overflow`);
    await evaluate('window.scrollTo(0,0)');
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(output, `${name}.png`), Buffer.from(shot.data, 'base64'));
  }
  await click('unequip'); await click('inspect', true); await click('mint', true);
  await click('equip'); await click('unwrap'); await click('wrap'); await click('mint', true);
  await click('authorize'); await click('mint');
  assert.equal((await rehearsal.world.state()).mints, '2');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', desktopAndMobile: true, originRejection: true, staleReplayRejected: true,
    fixtureMints: 2, browserExceptions: errors.length, screenshots: output }, null, 2));
} finally {
  ws?.close();
  if (page?.id) await fetch(`http://127.0.0.1:9231/json/close/${page.id}`).catch(() => {});
  await rehearsal.close();
}
