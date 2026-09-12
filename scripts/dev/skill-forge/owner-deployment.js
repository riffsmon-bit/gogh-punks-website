import { createDeploymentWallet } from '/deployment-wallet.js';
const $ = id => document.getElementById(id);
let state, config, csrf, provider, connected = false, busy = false, walletEpoch = 0;
const same = (a,b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const eth = value => { const n = BigInt(value), fraction = (n % 10n**18n).toString().padStart(18,'0').replace(/0+$/,''); return `${n / 10n**18n}${fraction ? `.${fraction}` : ''} ETH`; };
function message(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
const explanations = {
  FORGE_WALLET_REVIEW_EXPIRED: 'This review expired. Get a fresh review before opening your wallet.',
  FORGE_WALLET_NONCE_CHANGED: 'Your wallet activity changed. Get a fresh review, or recover the transaction already requested.',
  FORGE_NONCE_STILL_UNRESOLVED: 'This wallet nonce is still unresolved. Check wallet activity; this page will not automatically resend.',
  FORGE_DEPLOYMENT_EXISTS_RECOVER_HASH: 'The deployment exists. Recover its original transaction hash from your wallet activity.',
  FORGE_WALLET_ALREADY_REQUESTED: 'This transaction already reached the wallet. Recover its receipt instead of submitting again.',
  LIVE_READ_UNAVAILABLE: 'A live RPC read is unavailable. Recheck shortly; nothing was resent.',
};
function describe(step) {
  const labels = { READY:'Not submitted', WALLET_REQUESTED:'Wallet requested · recover the original transaction if the result was lost',
    SUBMITTED:'Submitted · awaiting verified receipt', INCLUDED:'Receipt verified on both RPCs', REVERTED:'Transaction reverted', NONCE_CONSUMED:'Previous nonce resolved without this action' };
  return `${labels[step.status] ?? step.status}${step.transactionHash ? ` · ${step.transactionHash}` : ''}`;
}
function details(id, values) {
  $(id).replaceChildren();
  for (const [label,value] of values) { const dt=document.createElement('dt'), dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$(id).append(dt,dd); }
}
function render() {
  if (!state) return;
  const plan=state.packet?.plan, first=state.steps[0], second=state.steps[1];
  $('network').textContent=config.localFixture ? 'Disposable browser test · chain 31337' : 'LIVE · Robinhood Chain · 4663';
  $('administrator').textContent=config.administrator;
  $('connect').disabled=busy; $('switch').disabled=busy;
  $('prepare').disabled=busy || !connected || !state.steps.every(s=>['READY','NONCE_CONSUMED'].includes(s.status));
  $('deployment-review').hidden=!plan;
  if(plan){
    details('deployment-details',[['Action','Create the paused registry, progression and reviewed burn source'],['Maximum deployment fee',eth(BigInt(plan.gasLimits[0])*BigInt(plan.maxFeePerGas))],['Review expires',new Date(plan.expiresAt*1000).toLocaleTimeString()],['Transaction value','0 ETH'],['Administrator',plan.administrator]]);
    $('deployment-bytes').textContent=JSON.stringify({addresses:plan.addresses,transaction:plan.transactions[0]},null,2);
  }
  $('deploy').disabled=busy || !connected || !plan || first.status!=='READY' || Date.now()>plan.expiresAt*1000-15000;
  $('deploy-status').textContent=describe(first); $('deploy-status').className='address';
  $('prepare-acceptance').disabled=busy || !connected || first.status!=='INCLUDED' || !['READY','NONCE_CONSUMED'].includes(second.status);
  $('acceptance-review').hidden=!second.review;
  if(second.review) details('acceptance-details',[['Action','Accept registry administration; Forge remains paused'],['Registry',second.review.transaction.to],['Maximum acceptance fee',eth(second.review.maximumFeeWei)],['Review expires',new Date(second.review.expiresAt*1000).toLocaleTimeString()]]);
  $('accept').disabled=busy || !connected || first.status!=='INCLUDED' || second.status!=='READY' || !second.review || Date.now()>second.review.expiresAt*1000-15000;
  $('accept-status').textContent=describe(second); $('accept-status').className='address';
  $('recheck').disabled=busy || !plan; $('recover').disabled=busy || !plan; $('resolve').disabled=busy || !plan;
  $('finality').textContent=state.evidence ? (config.localFixture ? 'Disposable deployment verified on this test chain. Registry paused.' : 'Live deployment verified at a finalized block by both RPCs. Registry paused. You can now read your Punk’s real progression state.')
    : state.steps.every(s=>s.status==='INCLUDED') ? 'Both receipts are included. Recheck for finalized deployment verification.' : 'Complete the two wallet transactions, then verify their receipts.';
  $('profile-controls').hidden=!state.candidates;
}
async function refresh(){ const response=await fetch('/api/state'); if(!response.ok)throw Error('LIVE_READ_UNAVAILABLE'); const payload=await response.json();state=payload.state;config=payload.config;csrf=payload.csrf;render(); }
async function action(operation, fields={}) {
  const response=await fetch('/api/action',{method:'POST',headers:{'content-type':'application/json','x-forge-nonce':csrf},body:JSON.stringify({operation,revision:state.revision,...fields})});
  const payload=await response.json();if(!response.ok)throw Error(payload.error);state=payload.state;render();return state;
}
async function task(work){if(busy)return;busy=true;render();try{await work();}catch(error){message(explanations[error.message]??(error.code===4001 ? 'Wallet request rejected. Check the saved transaction status before trying again.' : error.message),true);try{await refresh();}catch{}}finally{busy=false;render();}}
async function walletContext(){
  if(!provider){connected=false;return;}
  const [accounts,chain]=await Promise.all([provider.request({method:'eth_accounts'}),provider.request({method:'eth_chainId'})]);
  const correctChain=BigInt(chain)===BigInt(config.chainId);connected=same(accounts?.[0],config.administrator)&&correctChain;
  $('switch').hidden=correctChain;
  $('wallet-status').textContent=connected ? 'Owner wallet connected on the correct network.' : !same(accounts?.[0],config.administrator) ? 'Select the administrator address shown above in your wallet.' : 'Switch your wallet to Robinhood Chain.';render();
}
$('connect').onclick=()=>task(async()=>{
  provider=window.ethereum?.providers?.find(p=>p.isMetaMask)??window.ethereum;
  if(!provider)throw Error('Open this page in your browser with MetaMask, or your wallet’s browser.');
  await provider.request({method:'eth_requestAccounts'});
  for(const event of ['accountsChanged','chainChanged'])provider.on?.(event,()=>{walletEpoch++;walletContext().catch(()=>{connected=false;render();});});
  await walletContext();message(connected?'Connected. Get the live deployment review.':'Choose the administrator wallet and correct network.');
});
$('switch').onclick=()=>task(async()=>{
  await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:`0x${config.chainId.toString(16)}`}]});await walletContext();
});
$('prepare').onclick=()=>task(async()=>{message('Reading both live RPCs and simulating deployment…');await action('prepare');message('Review the contracts and fee ceiling, then open your wallet.');});
$('prepare-acceptance').onclick=()=>task(async()=>{message('Verifying the deployed contracts and simulating registry acceptance…');await action('prepare-acceptance',{index:1});message('Review registry acceptance, then open your wallet.');});
async function submit(index){
  const epoch=walletEpoch;
  const sender=createDeploymentWallet({provider,isCurrent:()=>connected&&epoch===walletEpoch,
    isAttempted:hash=>localStorage.getItem(`gogh-forge-attempt:${hash}`)!==null,
    markAttempted:hash=>localStorage.setItem(`gogh-forge-attempt:${hash}`,new Date().toISOString()),
    claim:fields=>action('claim',fields)});
  message('Rechecking the exact transaction before your wallet opens…');
  const result=await sender.submit({state,config,index});state=result.state;
  // Keep the hash in the browser as well as the committed server journal, even
  // if the next HTTP request or RPC lookup is temporarily unavailable.
  localStorage.setItem(`gogh-forge-hash:${state.packet.plan.planHash}:${index}`,result.transactionHash);
  $('recover-step').value=String(index);$('recover-hash').value=result.transactionHash;
  message('Transaction submitted. Verifying its original receipt…');await action('recover',{index,transactionHash:result.transactionHash});
  message(index===0?'Deployment receipt checked. Review registry acceptance next.':'Registry acceptance checked. Recheck receipts for finalized verification.');
}
$('deploy').onclick=()=>task(()=>submit(0));$('accept').onclick=()=>task(()=>submit(1));
$('recheck').onclick=()=>task(async()=>{message('Rechecking the original receipts…');await action('recheck');message(state.evidence?'Live deployment verified. Read your Punk’s live state below.':'Receipt state refreshed. If finality is pending, recheck shortly.');});
$('recover').onclick=()=>task(async()=>{await action('recover',{index:Number($('recover-step').value),transactionHash:$('recover-hash').value.trim()});message('Original transaction recovered.');});
$('resolve').onclick=()=>task(async()=>{await action('resolve-nonce',{index:Number($('recover-step').value)});message('The previous nonce is conclusively resolved. A fresh review is available.');});
$('read-profile').onclick=()=>task(async()=>{const response=await fetch(`/api/profile?tokenId=${encodeURIComponent($('punk-id').value)}`),result=await response.json();if(!response.ok)throw Error(result.error);$('profile').textContent=JSON.stringify(result,null,2);message('Read real on-chain progression. No wallet transaction was requested.');});
await refresh();message('Connect your owner wallet to start live setup.');
setInterval(()=>{if(!busy)refresh().catch(()=>{});},15000);
