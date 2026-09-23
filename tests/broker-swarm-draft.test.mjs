import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSwarm } from '../site/broker-swarm.js';

const OWNER = `0x${'1'.repeat(40)}`, OTHER = `0x${'2'.repeat(40)}`, TARGET = `0x${'3'.repeat(40)}`;
class Node {
  constructor(tag, doc) { this.localName = tag; this.ownerDocument = doc; this.children = []; this.listeners = {}; this.classList = { add() {} }; this.value = ''; this.checked = false; }
  set textContent(v) { this.text = v; this.children = []; } get textContent() { return (this.text ?? '') + this.children.map(n => n.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); if (this.localName === 'select' && !this.value) this.value = nodes[0].value; }
  replaceChildren() { if (walk(this).includes(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = null; this.children = []; this.text = ''; }
  setAttribute() {} addEventListener(k, f) { this.listeners[k] = f; }
  focus() { this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
}
const walk = node => [node, ...node.children.flatMap(walk)];
function fixture() {
  const doc = { createElement: tag => new Node(tag, doc), activeElement: null }, root = new Node('section', doc), values = new Map();
  let context = { owner: OWNER, chainId: 4663 }, ids = ['93', '94'], opens = 0;
  const panel = mountSwarm({ root, getContext: () => context, getPunks: () => ids.map(tokenId => ({ tokenId })),
    openReview() { opens++; throw Error('Draft editing must not open a mission'); }, openFunding() { opens++; throw Error('Draft editing must not fund'); }, openStatus() {},
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } });
  const field = name => walk(root).find(n => n.name === name);
  const checkbox = id => walk(root).find(n => n.type === 'checkbox' && n.value === id);
  const form = () => walk(root).find(n => n.localName === 'form');
  function select(id) { const node = checkbox(id); node.checked = true; node.listeners.change(); }
  function edit() {
    select('93'); field('mode').value = 'DIRECTED'; field('mode').listeners.change();
    field('target').value = TARGET; field('daily').value = '5'; field('total').value = '10';
    field('duration').value = 'KEEP_HUNTING'; field('duration').listeners.change(); field('fundingBudgetEth').value = '0.0015';
    field('target').focus(); field('target').setSelectionRange(5, 12);
  }
  return { panel, doc, root, values, field, checkbox, form, select, edit, get opens() { return opens; },
    submit() { form().listeners.submit({ preventDefault() {} }); },
    roster(next) { ids = next; panel.refresh(); }, wallet(next) { context = next; panel.refresh(); } };
}
function assertDraft(f) {
  assert.equal(f.field('mode').value, 'DIRECTED'); assert.equal(f.field('target').value, TARGET);
  assert.equal(f.field('daily').value, '5'); assert.equal(f.field('total').value, '10');
  assert.equal(f.field('duration').value, 'KEEP_HUNTING'); assert.equal(f.field('total').disabled, true);
  assert.equal(f.field('fundingBudgetEth').value, '0.0015');
}

test('passive status refresh preserves Swarm selections, amounts and the exact focused form node', () => {
  const f = fixture(); f.edit(); const form = f.form(), target = f.field('target');
  for (let i = 0; i < 4; i++) f.panel.refresh();
  assert.equal(f.form(), form); assert.equal(f.checkbox('93').checked, true); assertDraft(f);
  assert.equal(f.doc.activeElement, target); assert.equal(target.selectionStart, 5); assert.equal(target.selectionEnd, 12);
  assert.equal(f.opens, 0); assert.equal(f.values.size, 0);
});

test('reordered roster with identical ownership preserves draft DOM and focus', () => {
  const f = fixture(); f.edit(); const form = f.form(), target = f.field('target');
  f.roster(['94', '93']);
  assert.equal(f.form(), form); assert.equal(f.checkbox('93').checked, true); assertDraft(f); assert.equal(f.doc.activeElement, target);
  assert.equal(f.opens, 0);
});

test('validation errors preserve selected Punks and editable values for correction', () => {
  const f = fixture(); f.edit(); f.field('target').value = 'bad contract'; f.submit();
  assert.match(f.root.textContent, /full Robinhood Chain collection contract/);
  assert.equal(f.checkbox('93').checked, true); assert.equal(f.field('target').value, 'bad contract');
  assert.equal(f.field('daily').value, '5'); assert.equal(f.field('fundingBudgetEth').value, '0.0015');
  f.field('target').value = TARGET; f.submit();
  assert.match(f.root.textContent, /Batch planned/); assert.equal(f.values.size, 1); assert.equal(f.opens, 0);
  const saved = JSON.parse([...f.values.values()][0]); assert.deepEqual(saved.rows.map(row => row.tokenId), ['93']);
  assert.equal(saved.options.daily, '5'); assert.equal(saved.options.total, '100'); assert.equal(saved.options.target, TARGET);
});

test('ownership changes remove transferred selections but retain remaining selections, settings and focus', () => {
  const f = fixture(); f.edit(); f.select('94');
  f.roster(['94', '95']);
  assert.equal(f.checkbox('93'), undefined); assert.equal(f.checkbox('94').checked, true); assert.equal(f.checkbox('95').checked, false);
  assertDraft(f); assert.equal(f.doc.activeElement, f.field('target'));
  assert.equal(f.field('target').selectionStart, 5); assert.equal(f.field('target').selectionEnd, 12);
  f.roster(['94', '95', '93']); assert.equal(f.checkbox('93').checked, false, 'a transferred-away selection cannot revive');
  f.submit(); const saved = JSON.parse([...f.values.values()][0]); assert.deepEqual(saved.rows.map(row => row.tokenId), ['94']); assert.equal(f.opens, 0);
});

test('changing owner or chain clears the private draft and never inherits its funding budget', () => {
  for (const next of [{ owner: OTHER, chainId: 4663 }, { owner: OWNER, chainId: 1 }, { owner: null, chainId: 4663 }]) {
    const f = fixture(); f.edit(); f.wallet(next); f.wallet({ owner: OWNER, chainId: 4663 });
    assert.equal(f.checkbox('93').checked, false); assert.equal(f.field('mode').value, 'SEARCH');
    assert.equal(f.field('target').value, ''); assert.equal(f.field('fundingBudgetEth').value, '');
    assert.equal(f.opens, 0); assert.equal(f.values.size, 0);
  }
});

test('a stale form cannot submit old choices under a newly connected wallet', () => {
  const f = fixture(); f.edit(); const old = f.form(); f.wallet({ owner: OTHER, chainId: 4663 });
  old.listeners.submit({ preventDefault() {} });
  assert.equal(f.values.size, 0); assert.equal(f.opens, 0); assert.equal(f.checkbox('93').checked, false);
});
