// Uses a separate headless Chrome profile on loopback; never the owner's wallet profile.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { startEpochRehearsal } from './server.mjs';
if (process.argv.length !== 3 || process.argv[2] !== '--local-only') throw Error('Requires --local-only');
const rehearsal = await startEpochRehearsal();
let ws, page, chrome, debuggerHost;
try {
  const profileDirectory = await mkdtemp(join(tmpdir(), 'gogh-epoch-chrome-'));
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profileDirectory}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Chrome startup timeout')), 15000);
    let output = '';
    chrome.once('error', error => { clearTimeout(timeout); reject(error); });
    chrome.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  debuggerHost = new URL(endpoint).host;
  const denied = await fetch(`${rehearsal.url}/action`, { method: 'POST', headers: { Origin: 'https://example.invalid', 'Content-Type': 'application/json' }, body: '{"action":"wrap"}' });
  assert.equal(denied.status, 403);
  assert.equal((await rehearsal.world.state()).wrapped, false);
  page = await (await fetch(`http://${debuggerHost}/json/new?${encodeURIComponent(rehearsal.url)}`, { method: 'PUT' })).json();
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
  const verifyProfile = async () => {
    await evaluate("document.querySelector('[data-epoch-control] button').click()");
    await until("document.querySelector('[data-epoch-punk=\"93\"]') !== null");
    await evaluate("document.querySelector('[data-epoch-punk=\"93\"]').click()");
    await until("document.querySelector('[data-epoch-control] [role=status]').textContent.includes('progression verified')");
    assert.match(await evaluate("document.querySelector('.epoch-profile').textContent"), /2 learned/);
    assert.match(await evaluate("document.querySelector('.epoch-profile').textContent"), /Direct owner access requires unwrapping/);
    assert.match(await evaluate("document.querySelector('.epoch-profile').textContent"), /ENROLLMENT LOCKED/);
  };
  await verifyProfile();
  await click('transfer'); await click('transfer'); await click('replay', true);
  await verifyProfile();
  assert.match(await evaluate("document.querySelector('.epoch-profile').textContent"), /INACTIVE/);
  await click('authorize'); await click('mint');
  await verifyProfile();
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
  // Explicitly delay a UI response across an owner switch. No wallet or chain writes.
  await evaluate(`(async () => {
    const {createEpochControl} = await import('/broker-v2-epoch.js');
    window.raceRoot = document.createElement('section'); document.body.append(raceRoot);
    window.raceOwner = '0x1111111111111111111111111111111111111111';
    window.raceControl = createEpochControl(raceRoot, {getOwner:()=>raceOwner,
      readRoster:()=>new Promise(resolve=>{window.resolveRoster=resolve}),
      readProfile:()=>new Promise(resolve=>{window.resolveProfile=resolve})});
    window.racePending = raceControl.refresh();
    raceControl.invalidate(); window.raceOwner = '0x2222222222222222222222222222222222222222';
    resolveRoster({ok:true,enabled:true,complete:true,owner:'0x1111111111111111111111111111111111111111',tokenIds:['93']});
    await racePending;
  })()`);
  assert.equal(await evaluate("raceRoot.querySelectorAll('[data-epoch-punk]').length"), 0);
  await evaluate(`(async () => {
    window.racePending=raceControl.refresh();
    resolveRoster({ok:true,enabled:true,complete:true,owner:raceOwner,tokenIds:['93'],chainId:4663,
      collection:'0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6',wrapper:'0x3333333333333333333333333333333333333333'}); await racePending;
    raceRoot.querySelector('[data-epoch-punk]').click(); raceControl.invalidate();
    resolveProfile({ok:true,profile:{owner:raceOwner,tokenId:'93'}}); await Promise.resolve();
  })()`);
  assert.equal(await evaluate("raceRoot.querySelector('.epoch-profile').children.length"), 0);
  await evaluate('raceRoot.remove()');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', desktopAndMobile: true, originRejection: true, staleReplayRejected: true,
    fixtureMints: 2, sharedRosterAndProfile: true, staleOwnerResponsesDiscarded: true,
    browserExceptions: errors.length, screenshots: output }, null, 2));
} finally {
  ws?.close();
  if (page?.id) await fetch(`http://${debuggerHost}/json/close/${page.id}`).catch(() => {});
  chrome?.kill('SIGTERM');
  await rehearsal.close();
}
