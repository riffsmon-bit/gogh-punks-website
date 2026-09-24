import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSwarmWallet } from '../site/swarm-wallet-panel.js';
const OWNER=`0x${'1'.repeat(40)}`, OTHER=`0x${'2'.repeat(40)}`, VAULT=`0x${'3'.repeat(40)}`, HASH=`0x${'a'.repeat(64)}`;
class Node {
  constructor(tag, doc) { this.tag=tag; this.ownerDocument=doc; this.children=[]; this.attrs={}; this.listeners={}; this.classList={add(){}}; this.value=''; this.checked=false; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children=nodes; }
  setAttribute(k,v) { this.attrs[k]=v; }
  addEventListener(k,f) { this.listeners[k]=f; }
  querySelectorAll(tag) { return walk(this).filter(n=>n.tag===tag); }
  scrollIntoView() {}
  click() { if(!this.disabled) this.listeners.click?.(); }
}
const walk=n=>[n,...n.children.flatMap(walk)];
const flush=async()=>{for(let i=0;i<4;i++) await new Promise(r=>setTimeout(r,0));};
function fixture({release={status:'LIVE'},saved=null}={}) {
  const doc={createElement:tag=>new Node(tag,doc)},root=new Node('section',doc),calls=[];
  let context={owner:OWNER,chainId:4663},punks=[{tokenId:'93'},{tokenId:'94'}],record=saved,resolvePrepare,provider={};
  const readProvider={request(){throw Error('Panel fixtures must not request the network');}};
  const client={
    getSwarmWalletRecord:()=>record,
    readSwarmWallet:async(_p,options)=>{assert.equal(options.readProvider,readProvider);calls.push('read');return{created:true,vault:VAULT,balanceWei:'3000000000000000'};},
    prepareSwarmWallet:async(_p,{owner,action,readProvider:reader})=>{assert.equal(reader,readProvider);calls.push(['prepare',action]); if(resolvePrepare)await resolvePrepare;
      return{owner,vault:VAULT,action,expiresAt:Date.now()+90000,maximumNetworkFeeWei:'1000',allocations:action.allocations?.map(a=>({...a,account:VAULT}))};},
    submitSwarmWallet:async(_p,review,{isCurrent,readProvider:reader})=>{assert.equal(reader,readProvider);assert.equal(isCurrent(),true);calls.push('wallet');record={status:'SUBMITTED',transactionHash:HASH,review};return record;},
    recoverSwarmWallet:async(_p,_owner,options)=>{assert.equal(options.readProvider,readProvider);calls.push('recover');record={...record,status:'CONFIRMED'};return record;},
  };
  const panel=mountSwarmWallet({root,getContext:()=>context,getPunks:()=>punks,getProvider:()=>provider,release,client,readProvider,storage:{},locks:{}});
  const node=name=>walk(root).find(n=>Object.hasOwn(n.attrs,'data-swarm-wallet-'+name));
  return{root,calls,node,panel,client,get record(){return record;},setPending(p){resolvePrepare=p;},
    replaceProvider({refresh=true}={}){provider={};if(refresh)panel.refresh();},
    wallet(c,{refresh=true}={}){context=c;if(refresh)panel.refresh();},roster(ids){punks=ids.map(tokenId=>({tokenId}));panel.refresh();},
    async click(name){node(name).click();await flush();},async ready(){await this.click('check');},
    select(id){const n=node('punks').querySelectorAll('input').find(n=>n.value===id);n.checked=true;n.listeners.change();},
    consent(){node('consent').checked=true;node('consent').listeners.change();}};
}
test('unreleased wallet is hidden and mount/passive refresh performs no provider operation',()=>{
  const off=fixture({release:null});assert.equal(off.root.hidden,true);assert.deepEqual(off.calls,[]);
  const f=fixture();f.panel.refresh();assert.deepEqual(f.calls,[]);assert.equal(f.node('review').hidden,true);
});
test('batch review splits exact budget, requires separate consent and one explicit wallet confirmation',async()=>{
  const f=fixture();await f.ready();f.select('93');f.select('94');f.node('batch-amount').value='0.003';await f.click('batch');
  const action=f.calls.find(c=>Array.isArray(c)&&c[0]==='prepare')[1];
  assert.deepEqual(action,{kind:'BATCH',allocations:[{tokenId:'93',amountWei:'1500000000000000'},{tokenId:'94',amountWei:'1500000000000000'}]});
  assert.equal(f.node('review').hidden,false);assert.equal(f.node('confirm').disabled,true);assert.equal(f.calls.includes('wallet'),false);
  f.consent();await f.click('confirm');assert.equal(f.calls.filter(c=>c==='wallet').length,1);assert.equal(f.node('review').hidden,true);assert.equal(f.node('recovery').hidden,false);
  await f.click('batch');await f.click('confirm');assert.equal(f.calls.filter(c=>c==='wallet').length,1);
  await f.click('recover');assert.equal(f.record.status,'CONFIRMED');assert.equal(f.calls.filter(c=>c==='wallet').length,1);
});
test('an unknown wallet result restored after reload is recovery-only',async()=>{
  const f=fixture({saved:{status:'WALLET_REQUESTED',transactionHash:null}});await f.ready();
  assert.equal(f.node('deposit').disabled,true);assert.equal(f.node('recovery').hidden,false);
  await f.click('deposit');assert.equal(f.calls.includes('wallet'),false);assert.equal(f.calls.some(c=>Array.isArray(c)),false);
});
test('passive refresh preserves chosen batch, but owner/roster/input change invalidates its review',async()=>{
  const f=fixture();await f.ready();f.select('93');f.node('batch-amount').value='0.001';const original=f.node('punks').children[1];
  f.panel.refresh();assert.equal(f.node('punks').children[1],original);assert.equal(f.node('batch-amount').value,'0.001');
  await f.click('batch');f.roster(['94']);assert.equal(f.node('review').hidden,true);assert.equal(f.node('confirm').disabled,true);
  f.node('deposit-amount').value='0.001';await f.click('deposit');f.node('deposit-amount').value='0.002';f.node('deposit-amount').listeners.input();assert.equal(f.node('review').hidden,true);
  await f.click('deposit');f.wallet({owner:OTHER,chainId:4663});assert.equal(f.node('review').hidden,true);assert.equal(f.node('deposit-amount').value,'');
  assert.equal(f.calls.includes('wallet'),false);
});
test('late preparation after a wallet switch cannot display another owner’s transaction',async()=>{
  const f=fixture();await f.ready();let finish;f.setPending(new Promise(r=>{finish=r;}));f.node('deposit-amount').value='0.001';f.node('deposit').click();await flush();
  f.wallet({owner:OTHER,chainId:4663});finish();await flush();assert.equal(f.node('review').hidden,true);assert.equal(f.calls.includes('wallet'),false);
});
test('replacing provider for the same account invalidates in-flight preparation',async()=>{
  const f=fixture();await f.ready();let finish;f.setPending(new Promise(r=>{finish=r;}));
  f.node('deposit-amount').value='0.001';f.node('deposit').click();await flush();
  f.replaceProvider();finish();await flush();assert.equal(f.node('review').hidden,true);assert.equal(f.calls.includes('wallet'),false);
});
test('unavailable account verification pauses funding while retaining owner withdrawals',async()=>{
  const f=fixture();f.client.readSwarmWallet=async()=>({created:true,vault:VAULT,balanceWei:'3000000000000000',dependenciesVerified:false});
  await f.ready();assert.equal(f.node('deposit').disabled,true);assert.equal(f.node('batch').disabled,true);assert.equal(f.node('withdraw').disabled,false);
  assert.match(f.node('info').textContent,/funding is paused/);
  f.node('withdraw-amount').value='0.003';await f.click('withdraw');assert.equal(f.node('review').hidden,false);
});
test('owner with no remaining Punks can still review unused Swarm ETH withdrawal',async()=>{
  const f=fixture();f.roster([]);await f.ready();
  assert.equal(f.root.hidden,false);assert.equal(f.node('withdraw').disabled,false);
  f.node('withdraw-amount').value='0.003';await f.click('withdraw');
  assert.equal(f.node('review').hidden,false);assert.equal(f.node('confirm').disabled,true);
  assert.deepEqual(f.calls.find(c=>Array.isArray(c)&&c[0]==='prepare')[1],{kind:'WITHDRAW',amountWei:'3000000000000000'});
  assert.equal(f.calls.includes('wallet'),false);
});
test('verified wallet cancellation explains non-delivery and restores owner actions',async()=>{
  const f=fixture({saved:{status:'SUBMITTED',transactionHash:HASH}});await f.ready();
  f.client.recoverSwarmWallet=async()=>({status:'CANCELLED',transactionHash:HASH});
  await f.click('recover');assert.match(f.node('status').textContent,/intended Swarm action did not execute/);
  assert.equal(f.node('recovery').hidden,true);assert.equal(f.node('withdraw').disabled,false);
});
test('recovery surfaces a higher owner-edited mined fee without sending again',async()=>{
  const f=fixture({saved:{status:'SUBMITTED',transactionHash:HASH}});await f.ready();
  f.client.recoverSwarmWallet=async()=>({status:'CONFIRMED',transactionHash:HASH,receipt:{feeExceeded:true,actualNetworkFeeWei:'6000000000000'}});
  await f.click('recover');assert.match(f.node('status').textContent,/above the original review.*0.000006 ETH.*no new transaction/);
  assert.equal(f.calls.includes('wallet'),false);assert.equal(f.node('withdraw').disabled,false);
});

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
async function creation(f) {
  f.client.readSwarmWallet=async()=>({created:false,vault:VAULT,balanceWei:'0',dependenciesVerified:true});
  await f.ready();
}
test('roster hydration during wallet check reveals creation instead of silently discarding its result',async()=>{
  const f=fixture(),wait=deferred();
  f.client.readSwarmWallet=async()=>{await wait.promise;return{created:false,vault:VAULT,balanceWei:'0',dependenciesVerified:true};};
  await f.click('check');f.roster(['93','94','95']);wait.resolve();await flush();
  assert.equal(f.node('create').hidden,false);assert.equal(f.node('create').disabled,false);
  assert.equal(f.root.attrs['aria-busy'],'false');assert.match(f.node('status').textContent,/Wallet checked/);
  assert.equal(f.calls.includes('wallet'),false);
});
test('CREATE review and explicit confirmation survive same-owner roster updates',async()=>{
  const f=fixture();await creation(f);const wait=deferred();f.setPending(wait.promise);
  await f.click('create');f.roster(['93','94','95']);wait.resolve();await flush();
  assert.equal(f.node('review').hidden,false);assert.equal(f.node('confirm').disabled,true);
  assert.match(f.node('confirm-status').textContent,/Check the confirmation box/);
  f.consent();f.roster(['94','95']);assert.equal(f.node('confirm').disabled,false);
  await f.click('confirm');
  assert.equal(f.calls.filter(call=>call==='wallet').length,1);assert.equal(f.record.review.action.kind,'CREATE');
  assert.equal(f.node('recovery').hidden,false);assert.match(f.node('status').textContent,/Wallet request saved/);
});
for(const kind of ['DEPOSIT','WITHDRAW'])test(`${kind} review survives roster-only changes without opening the wallet`,async()=>{
  const f=fixture();await f.ready();const name=kind==='DEPOSIT'?'deposit':'withdraw',wait=deferred();
  f.node(name+'-amount').value='0.001';f.setPending(wait.promise);await f.click(name);
  f.roster([]);wait.resolve();await flush();
  assert.equal(f.node('review').hidden,false);assert.equal(f.calls.includes('wallet'),false);
  f.consent();f.roster(['94']);assert.equal(f.node('confirm').disabled,false);
});
test('roster changes invalidate an in-flight batch review with an explicit retry message',async()=>{
  const f=fixture();await f.ready();f.select('93');f.node('batch-amount').value='0.001';
  const wait=deferred();f.setPending(wait.promise);await f.click('batch');f.roster(['94']);wait.resolve();await flush();
  assert.equal(f.node('review').hidden,true);assert.equal(f.node('confirm').disabled,true);
  assert.match(f.node('status').textContent,/roster changed.*Review the funding batch again/);
  assert.equal(f.calls.includes('wallet'),false);assert.equal(f.root.attrs['aria-busy'],'false');
});
test('roster change during final batch checks stops the wallet request',async()=>{
  const f=fixture();await f.ready();f.select('93');f.node('batch-amount').value='0.001';await f.click('batch');f.consent();
  const wait=deferred(),submit=f.client.submitSwarmWallet;
  f.client.submitSwarmWallet=async(...args)=>{await wait.promise;if(!args[2].isCurrent())throw Error('Selection changed');return submit(...args);};
  await f.click('confirm');f.roster(['94']);wait.resolve();await flush();
  assert.equal(f.calls.includes('wallet'),false);assert.equal(f.node('review').hidden,true);
  assert.match(f.node('status').textContent,/roster changed/);
});
test('late batch transaction hash remains recoverable after roster invalidates its review',async()=>{
  const f=fixture();await f.ready();f.select('93');f.node('batch-amount').value='0.001';await f.click('batch');f.consent();
  const wait=deferred(),submit=f.client.submitSwarmWallet;
  f.client.submitSwarmWallet=async(...args)=>{const result=await submit(...args);await wait.promise;return result;};
  await f.click('confirm');f.roster(['94']);wait.resolve();await flush();
  assert.equal(f.calls.filter(call=>call==='wallet').length,1);assert.equal(f.record.status,'SUBMITTED');
  assert.equal(f.node('recovery').hidden,false);assert.equal(f.node('hash').value,HASH);assert.equal(f.node('deposit').disabled,true);
  assert.match(f.node('status').textContent,/wallet request is saved.*will not be resent/);
  await f.click('confirm');assert.equal(f.calls.filter(call=>call==='wallet').length,1);
});
test('receipt recovery survives same-owner roster changes',async()=>{
  const f=fixture({saved:{status:'SUBMITTED',transactionHash:HASH}});await f.ready();
  const wait=deferred(),recover=f.client.recoverSwarmWallet;
  f.client.recoverSwarmWallet=async(...args)=>{await wait.promise;return recover(...args);};
  await f.click('recover');f.roster([]);wait.resolve();await flush();
  assert.equal(f.record.status,'CONFIRMED');assert.equal(f.node('recovery').hidden,true);
  assert.match(f.node('status').textContent,/Transaction confirmed/);assert.equal(f.calls.includes('wallet'),false);
});
for(const transition of ['owner','provider'])test(`CREATE confirmation cannot reuse a review after ${transition} changes before refresh`,async()=>{
  const f=fixture();await creation(f);await f.click('create');f.consent();
  if(transition==='owner')f.wallet({owner:OTHER,chainId:4663},{refresh:false});else f.replaceProvider({refresh:false});
  await f.click('confirm');assert.equal(f.calls.includes('wallet'),false);
  assert.equal(f.node('review').hidden,true);assert.equal(f.node('confirm').disabled,true);
});
test('CREATE result after provider change shows its saved journal, never stale review authority',async()=>{
  const f=fixture();await creation(f);await f.click('create');f.consent();
  const wait=deferred(),submit=f.client.submitSwarmWallet;
  f.client.submitSwarmWallet=async(...args)=>{const result=await submit(...args);await wait.promise;return result;};
  await f.click('confirm');f.replaceProvider();wait.resolve();await flush();
  assert.equal(f.node('review').hidden,true);assert.equal(f.node('recovery').hidden,false);
  assert.equal(f.node('hash').value,HASH);assert.equal(f.node('create').disabled,true);
  assert.equal(f.calls.filter(call=>call==='wallet').length,1);
});
test('expired confirmation gives an adjacent explanation without automatically renewing or sending',async()=>{
  const f=fixture();await creation(f);const prepare=f.client.prepareSwarmWallet;
  f.client.prepareSwarmWallet=async(...args)=>({...await prepare(...args),expiresAt:Date.now()-1});
  await f.click('create');f.consent();
  assert.equal(f.node('confirm').disabled,true);assert.match(f.node('confirm-status').textContent,/review expired.*Discard.*review.*again/);
  await f.click('confirm');assert.equal(f.calls.includes('wallet'),false);
});
test('a failed wallet check shows a safe actionable reason and diagnostic code without raw RPC content',async()=>{
  const f=fixture();
  f.client.readSwarmWallet=async()=>{throw Object.assign(Error('raw rpc private detail'),{code:'SWARM_WALLET_STALE_CHAIN'});};
  await f.click('check');
  assert.match(f.node('status').textContent,/old block.*device clock.*Check code: STALE_CHAIN/);
  assert.doesNotMatch(f.node('status').textContent,/raw rpc private detail/);
  assert.equal(f.node('check').disabled,false);assert.equal(f.node('review').hidden,true);assert.equal(f.calls.includes('wallet'),false);
});
test('saved-journal read errors use recovery-safe copy after a wallet context change',()=>{
  const f=fixture();
  f.client.getSwarmWalletRecord=()=>{throw Object.assign(Error('raw storage private detail'),{code:'SWARM_WALLET_JOURNAL_INVALID'});};
  f.replaceProvider();
  assert.match(f.node('status').textContent,/history is unreadable.*Keep it intact.*Check code: JOURNAL_INVALID/);
  assert.doesNotMatch(f.node('status').textContent,/raw storage private detail/);
  assert.equal(f.node('review').hidden,true);assert.equal(f.calls.includes('wallet'),false);
});
