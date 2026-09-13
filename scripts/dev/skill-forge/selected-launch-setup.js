let state,config,csrf,busy=false,renderedReviewHash;
const $=id=>document.getElementById(id);
const status=text=>{$('status').textContent=text;$('status').hidden=!text;};
const errors={SETUP_CONFIRMATIONS_PENDING:'Transaction found. Recheck its receipt shortly.',
  LIVE_SETUP_READ_UNAVAILABLE:'A chain read is temporarily unavailable. Retry the current step; any saved wallet request stays preserved.',
  LOCAL_SETUP_ORIGIN_REQUIRED:'The setup server was updated. Refresh this page, then continue from the saved step.',
  SETUP_REVIEW_EXPIRED:'This review expired. Prepare a fresh review before opening your wallet.',
  SETUP_NONCE_CHANGED:'Your wallet activity changed. Check the original transaction before preparing another review.',
  RECOVER_EXISTING_WALLET_TRANSACTION:'Recover the saved wallet transaction before preparing another review.',
  RECOVER_TRANSACTION_HASH_FIRST:'Copy the original transaction hash from wallet activity, then recover it.'};
const validHash=value=>/^0x[0-9a-f]{64}$/i.test(value??'');
const hashKey=reviewHash=>'gogh.setup.transaction.'+reviewHash;
function browserHash(reviewHash) {try {return localStorage.getItem(hashKey(reviewHash));} catch {return null;}}
function rememberHash(reviewHash,hash) {try {localStorage.setItem(hashKey(reviewHash),hash);} catch {}}
const eth=wei=>{const n=BigInt(wei),fraction=(n%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');return (n/10n**18n).toString()+(fraction?'.'+fraction:'')+' ETH';};
async function request(action,extra={}) {
  const r=await fetch('/api/action',{method:'POST',headers:{'content-type':'application/json','x-setup-nonce':csrf},body:JSON.stringify({action,revision:state.revision,...extra})});
  const result=await r.json();if(!r.ok)throw Error(result.error);state=result.state;render();return state;
}
async function refresh() {const r=await fetch('/api/state');if(!r.ok)throw Error('Setup unavailable');({state,config,csrf}=await r.json());render();}
function render() {
  $('identity').textContent=config.owner;
  $('steps').replaceChildren(...config.steps.map(step=>{const li=document.createElement('li'),record=state.records.findLast(r=>r.review.action===step.action);li.textContent=step.label+' · '+(record?.status??'Pending');return li;}));
  const last=state.records.at(-1),review=last?.review;
  const savedHash=last?.transactionHash??last?.reportedTransactionHash??browserHash(last?.reviewHash);
  if(renderedReviewHash!==last?.reviewHash){$('hash').value=validHash(savedHash)?savedHash:'';renderedReviewHash=last?.reviewHash;}
  else if(!$('hash').value&&validHash(savedHash))$('hash').value=savedHash;
  $('review').hidden=!review;
  if(review){$('review-title').textContent=review.label;$('fee').textContent='Maximum network fee: '+eth(review.maximumNetworkFeeWei);$('target').textContent=review.transaction.to?'Contract: '+review.transaction.to:'New factory: '+review.predictedAddress;$('expiry').textContent=last.status==='PREPARED'&&Date.now()>=review.expiresAt?'This review expired. Select Prepare next transaction for a fresh review.':'Wallet review expires: '+new Date(review.expiresAt).toLocaleTimeString();$('review-json').textContent=JSON.stringify(last,null,2);}
  const complete=config.steps.every(step=>state.records.some(r=>r.review.action===step.action&&r.status==='INCLUDED'));
  $('prepare').disabled=busy||complete||!!last&&!['PREPARED','DECLINED','INCLUDED','REVERTED'].includes(last.status);
  $('send').disabled=busy||last?.status!=='PREPARED'||Date.now()>=review?.expiresAt;
  $('recover').disabled=busy||!['WALLET_REQUESTED','SUBMITTED'].includes(last?.status);
  $('recheck').disabled=busy||!(last?.status==='SUBMITTED'||last?.status==='WALLET_REQUESTED'&&validHash($('hash').value.trim()));
}
async function walletIdentity() {
  if(!window.ethereum)throw Error('Open this page in your wallet-enabled browser.');
  const accounts=await window.ethereum.request({method:'eth_requestAccounts'});
  if(accounts[0]?.toLowerCase()!==config.owner.toLowerCase())throw Error('Connect the selected administrator wallet.');
  if(BigInt(await window.ethereum.request({method:'eth_chainId'}))!==4663n)throw Error('Switch your wallet to Robinhood Chain.');
  $('wallet').textContent='Connected · '+accounts[0];return window.ethereum;
}
async function run(fn) {if(busy)return;busy=true;render();try{await fn();}catch(e){status(e.code===4001?'Wallet request declined. Prepare a fresh review when ready.':errors[e.message]??e.message);}finally{busy=false;await refresh().catch(()=>{});}}
$('connect').onclick=()=>run(walletIdentity);
$('prepare').onclick=()=>run(async()=>{await request('prepare');status('Review the setup transaction, then open your wallet.');});
$('send').onclick=()=>run(async()=>{
  const wallet=await walletIdentity(),record=state.records.at(-1),hash=record.reviewHash;
  await request('claim',{reviewHash:hash});
  // Only this successful claim can prompt. Refreshing a claimed record never reaches here.
  const accounts=await wallet.request({method:'eth_accounts'}),chain=await wallet.request({method:'eth_chainId'});
  if(accounts[0]?.toLowerCase()!==config.owner.toLowerCase() || BigInt(chain)!==4663n) {
    await request('decline',{reviewHash:hash});throw Error('Wallet changed. Reconnect the selected wallet and prepare a fresh review.');
  }
  let txHash;
  try {txHash=await wallet.request({method:'eth_sendTransaction',params:[state.records.at(-1).review.transaction]});}
  catch(error) {if(error.code===4001)await request('decline',{reviewHash:hash});throw error;}
  if(!validHash(txHash))throw Error('The wallet did not return a transaction hash. Check wallet activity to recover this request.');
  // Preserve the wallet result before any provider lookup or server response.
  rememberHash(hash,txHash);$('hash').value=txHash;await request('recover',{transactionHash:txHash});
  status('Wallet transaction saved. Recheck its receipt; a chain provider may need a moment to see it.');
});
$('hash').oninput=render;
$('recover').onclick=()=>run(async()=>{await request('recover',{transactionHash:$('hash').value.trim()});status('Transaction hash saved. Recheck its receipt.');});
$('recheck').onclick=()=>run(async()=>{
  const last=state.records.at(-1);
  if(last.status==='WALLET_REQUESTED'&&!last.reportedTransactionHash)await request('recover',{transactionHash:$('hash').value.trim()});
  await request('recheck');
  const current=state.records.at(-1);
  if(current.status==='INCLUDED')status(config.steps.every(step=>state.records.some(r=>r.review.action===step.action&&r.status==='INCLUDED'))
    ?'All four setup receipts are verified. Skill registration and paid-mint contract deployment are complete.'
    :'Receipt verified by both chain providers. Prepare the next setup transaction.');
  else if(current.status==='REVERTED')status('This transaction reverted. Prepare a new review for this step.');
  else status('The original transaction is saved. Waiting for chain visibility or confirmations; recheck shortly.');
});
await refresh();setInterval(()=>{if(!busy)render();},1000);
