import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_HELP, SWARM_WALLET_HELP, mountFeatureHelp } from '../site/broker-feature-help.js';

class Node {
  constructor(tag) { this.tagName=tag; this.dataset={}; this.children=[]; this.parentElement=null; this.className=''; this.hidden=false; }
  set textContent(value) { this.text=String(value); this.children=[]; }
  get textContent() { return (this.text??'')+this.children.map(node=>node.textContent).join(''); }
  append(...nodes) { for(const node of nodes){node.parentElement=this;this.children.push(node);} }
  after(...nodes) { const siblings=this.parentElement.children; for(const node of nodes)node.parentElement=this.parentElement;
    siblings.splice(siblings.indexOf(this)+1,0,...nodes); }
  querySelector(selector) {
    const nodes=walk(this).slice(1);
    if(selector==='.panel-header')return nodes.find(node=>node.className==='panel-header')??null;
    if(selector==='[data-feature-help]')return nodes.find(node=>Object.hasOwn(node.dataset,'featureHelp'))??null;
    if(selector==='[data-swarm-wallet-help]')return nodes.find(node=>Object.hasOwn(node.dataset,'swarmWalletHelp'))??null;
    return null;
  }
}
const walk=node=>[node,...node.children.flatMap(walk)];
function fixture({selected=false,wallet=true}={}) {
  const root=new Node('main'),ownerSection=new Node('details'),walletPanel=new Node('section'),stage=new Node('section'),panels=new Map();
  ownerSection.dataset.swarmWalletDetails='';ownerSection.append(walletPanel);stage.hidden=!selected;
  if(wallet)root.append(ownerSection);root.append(stage);
  for(const tab of Object.keys(FEATURE_HELP)) {
    const panel=new Node('section'),header=new Node('header');header.className='panel-header';panel.append(header);
    panels.set(tab,panel);stage.append(panel);
  }
  const doc={createElement:tag=>new Node(tag),querySelector(selector){
    const tab=selector.match(/^\[data-v2-panel="([^"]+)"\]$/)?.[1];
    if(tab)return panels.get(tab)??null;
    if(selector==='[data-swarm-wallet-details]')return wallet?ownerSection:null;
    return root.querySelector(selector);
  }};
  return{doc,root,ownerSection,walletPanel,stage,panels};
}

test('Swarm Wallet instructions remain available outside hidden selected-Punk controls',()=>{
  const f=fixture();mountFeatureHelp(f.doc);
  assert.equal(f.stage.hidden,true);
  const help=f.ownerSection.querySelector('[data-swarm-wallet-help]');
  assert.ok(help);assert.equal(help.parentElement,f.ownerSection);
  assert.equal(f.ownerSection.hidden,false);assert.equal(f.walletPanel.children.length,0);
  assert.equal(help.children[0].tagName,'summary');assert.equal(help.children[0].textContent,SWARM_WALLET_HELP.title);
  assert.equal(help.children.find(node=>node.tagName==='ol').children.length,SWARM_WALLET_HELP.steps.length);
  assert.match(help.textContent,/withdraw.*only to its owner wallet/i);
});

test('repeated help mounting preserves seven tab guides and only one owner-level walkthrough',()=>{
  const f=fixture({selected:true});mountFeatureHelp(f.doc);
  const original=f.ownerSection.querySelector('[data-swarm-wallet-help]');mountFeatureHelp(f.doc);
  assert.equal(f.ownerSection.querySelector('[data-swarm-wallet-help]'),original);
  assert.equal(walk(f.root).filter(node=>Object.hasOwn(node.dataset,'swarmWalletHelp')).length,1);
  assert.equal(walk(f.root).filter(node=>Object.hasOwn(node.dataset,'featureHelp')).length,7);
  for(const [tab,panel]of f.panels){
    const help=panel.querySelector('[data-feature-help]');assert.equal(help.dataset.featureHelp,tab);
    assert.equal(help.children.at(-1).href,`/guide/#${FEATURE_HELP[tab].anchor}`);
  }
});

test('missing Swarm owner section leaves individual funding guidance intact',()=>{
  const f=fixture({wallet:false});assert.doesNotThrow(()=>mountFeatureHelp(f.doc));
  const help=f.panels.get('fund').querySelector('[data-feature-help]');
  assert.match(help.textContent,/Punk Wallet or Agent Account/);
  assert.match(help.textContent,/Funding alone does not activate a new mission/);
  assert.equal(walk(f.root).filter(node=>Object.hasOwn(node.dataset,'swarmWalletHelp')).length,0);
});

test('walkthrough states batch limits, separate permission, fees, ownership and individual alternative',()=>{
  const steps=SWARM_WALLET_HELP.steps.join(' ');
  assert.match(steps,/1–10 Punks/);assert.match(steps,/number order/);
  assert.match(steps,/1 ETH per Punk and 10 ETH per batch/);
  assert.match(steps,/approve this batch only/);assert.match(steps,/All transfers.*succeed together, or none/);
  assert.match(steps,/created Agent Accounts/);assert.match(steps,/does not start a new mission or grant minting permission/);
  assert.match(SWARM_WALLET_HELP.costs,/connected wallet pays the network fee/);
  assert.match(SWARM_WALLET_HELP.costs,/no automatic refills/);
  assert.match(SWARM_WALLET_HELP.ownership,/follows that Punk’s ownership/);
  assert.match(SWARM_WALLET_HELP.alternative,/each Punk’s deposit separately/);
  assert.match(SWARM_WALLET_HELP.recovery,/Do not submit the same action again/);
  assert.doesNotMatch(Object.values(SWARM_WALLET_HELP).flat().join(' '),/LIVE-TESTED|guaranteed|unlimited|gas-free/);
});

test('rendered individual funding guide separates creation, funding and final mission permission',()=>{
  const f=fixture({selected:true});mountFeatureHelp(f.doc);
  const help=f.panels.get('fund').querySelector('[data-feature-help]');
  const steps=help.children.find(node=>node.tagName==='ol').children.map(node=>node.textContent);
  const create=steps.findIndex(text=>text.includes('creates only the wallet'));
  const fund=steps.findIndex(text=>text.startsWith('Enter an amount'));
  const mission=steps.findIndex(text=>text.includes('choose Start mission'));
  assert.ok(create>=0&&create<fund&&fund<mission,'holder instructions must put wallet creation and funding before mission permission');
  assert.match(steps[create],/does not grant minting permission or start a mission/);
  assert.match(steps[mission],/confirm the separate mission permission/);
  assert.match(help.textContent,/connected wallet pays the network fee/);
  assert.match(help.textContent,/without Recall.*permission is still active.*resume collecting/);
});

test('rendered Swarm instructions fund created accounts before starting new missions and explain active top-ups',()=>{
  const f=fixture();mountFeatureHelp(f.doc);
  const help=f.ownerSection.querySelector('[data-swarm-wallet-help]');
  const steps=help.children.find(node=>node.tagName==='ol').children.map(node=>node.textContent);
  const create=steps.findIndex(text=>text.includes('create missing wallets'));
  const fund=steps.findIndex(text=>text.includes('Choose Review gas batch'));
  const mission=steps.findIndex(text=>text.includes('choose Start mission'));
  assert.ok(create>=0&&create<fund&&fund<mission);
  assert.match(steps[create],/without switching Punks or starting missions/);
  assert.match(steps[mission],/After funding.*same saved Swarm plan.*Wallet confirmations remain individual/);
  assert.match(steps[mission],/does not start a new mission or grant minting permission/);
  assert.match(help.textContent,/do not need to Recall.*permission is still active.*resume collecting/);
  assert.match(help.textContent,/individual Fund screen/);
});
