import test from 'node:test';
import assert from 'node:assert/strict';
import { createHolderBurnInspectionPanel } from '../site/forge-holder-inspection-panel.js';

class Element {
  constructor(tag, document) { this.localName = tag; this.ownerDocument = document; this.childNodes = []; this.listeners = {}; this.attributes = {};
    this.classList = { add() {} }; this.value = ''; this.checked = false; }
  set textContent(v) { this.text = String(v); this.childNodes = []; }
  get textContent() { return (this.text ?? '') + this.childNodes.map(c => typeof c === 'string' ? c : c.textContent).join(''); }
  get options() { return this.childNodes.filter(c => c.localName === 'option'); }
  append(...nodes) { this.childNodes.push(...nodes); }
  replaceChildren(...nodes) { this.text = ''; this.childNodes = nodes; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  click() { if (!this.disabled) this.listeners.click?.(); }
}
const walk = node => [node, ...node.childNodes.filter(c => typeof c !== 'string').flatMap(walk)];
const until = async predicate => { for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Panel did not settle'); };
const owner = `0x${'1'.repeat(40)}`;
function fixture() {
  const document = { createElement: tag => new Element(tag, document) }, root = new Element('div', document);
  let selected = { owner, tokenId: '119', chainId: 4663 }, unblock;
  let responsePromise = null; const requests = [];
  const source = { wallets: [{ role: 'V1', nativeWei: '1000000000000000', wethWei: '0', entryPointDepositWei: '0' }],
    canBurn: true, blockers: ['HOLDER_ASSETS_PRESENT'], training: { status: 'VERIFIED', burnCredits: '0', purchasedCredits: '1' } };
  const panel = createHolderBurnInspectionPanel({ root, getSelection: () => selected, getOwnedPunks: () => ['119','812'], ensureSession: async () => {},
    request: async (url, options) => { requests.push({url,options}); if(responsePromise) await responsePromise;
      return { ok: true, owner, sourceTokenId: '812', targetTokenId: '119', source }; } });
  const button = () => walk(root).find(el => el.localName === 'button');
  return { root, panel, requests, button,
    choose() { const select = walk(root).find(el => el.localName === 'select'); select.value='812'; select.listeners.change(); },
    hold() { responsePromise = new Promise(resolve => { unblock=resolve; }); }, release() { unblock?.(); },
    switchOwner() { selected={ ...selected, owner: `0x${'2'.repeat(40)}` }; } };
}
test('public inspection excludes recipient, displays unknown inventory, and never offers wallet mutation', async () => {
  const f=fixture(); f.panel.refresh();
  assert.deepEqual(walk(f.root).find(el=>el.localName==='select').options.map(el=>el.value),['','812']);
  f.choose(); f.button().click(); await until(()=>f.root.textContent.includes('0.001 ETH'));
  assert.ok(f.root.textContent.includes('Sacrifice is blocked'));
  assert.ok(f.root.textContent.includes('not fully verified'));
  assert.deepEqual(walk(f.root).filter(el=>el.localName==='button').map(el=>el.textContent),['Check wallets']);
  assert.equal(f.requests[0].options.body.operation,'check'); assert.equal(f.requests.length,1);
  assert.equal(walk(f.root).find(el=>el.localName==='a').href,'/broker/v2/?tab=withdraw&tokenId=812');
});
test('public inspection suppresses responses after owner and selection refresh', async () => {
  const f=fixture();f.panel.refresh();f.choose();f.hold();f.button().click();await until(()=>f.requests.length===1);
  f.switchOwner();f.panel.refresh();f.release();await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(f.root.textContent.includes('0.001 ETH'),false);
});
