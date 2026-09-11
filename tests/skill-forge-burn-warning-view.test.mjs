import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBurnWarning } from '../broker/src/v4/skill-forge/burn-warning-view.mjs';

function documentStub() {
  const document = { createElement(tag) {
    return { tag, textContent: '', children: [], attributes: {}, events: {}, ownerDocument: document,
      append(...nodes) { this.children.push(...nodes); }, replaceChildren() { this.children = []; },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) { this.events[name] = callback; } };
  } };
  return document;
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
test('warning shows exact dust, review action and permanently disabled burn control', () => {
  const doc = documentStub(); const container = doc.createElement('div'); let selected = null;
  const wallet = { role: 'V3', address: '0x06D5e0Df2Eb9512777403bF017031618F4713e19', nativeWei: '1' };
  const result = renderBurnWarning(container, { wallets: [wallet] }, { onReviewWallet: w => { selected = w; }, now: 1000 });
  const nodes = descendants(container);
  assert.equal(result.canBurn, false);
  assert.ok(nodes.some(n => n.textContent.includes('Native balance: 1 wei')));
  assert.ok(nodes.some(n => n.attributes.role === 'alert' && n.textContent.includes('NOT transferred')));
  const review = nodes.find(n => n.tag === 'button' && n.textContent.startsWith('REVIEW'));
  review.events.click(); assert.equal(selected, wallet);
  assert.equal(nodes.find(n => n.textContent === 'SACRIFICE UNAVAILABLE').disabled, true);
});
test('missing balances stay unknown and asset text is not inserted as HTML', () => {
  const doc = documentStub(); const container = doc.createElement('div');
  renderBurnWarning(container, { wallets: [{ role: '<script>bad()</script>' }] });
  const nodes = descendants(container);
  assert.ok(nodes.some(n => n.textContent.includes('Native balance: unknown')));
  assert.ok(nodes.every(n => !Object.hasOwn(n, 'innerHTML')));
});
