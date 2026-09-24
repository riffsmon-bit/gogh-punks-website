// Dedicated Swarm setup UI: shared deployment UIs retain their existing semantics.
let state,config,csrf,busy=false,renderedReviewHash,stateKnown=false;
const $=id=>document.getElementById(id);
const status=text=>{$('status').textContent=text;$('status').hidden=!text;};
const errors={SETUP_CONFIRMATIONS_PENDING:'Transaction found. Recheck its receipt shortly.',
  LIVE_SETUP_READ_UNAVAILABLE:'A chain check is temporarily unavailable. Your saved step is preserved. Check wallet activity before retrying a transaction.',
  LOCAL_SETUP_ORIGIN_REQUIRED:'The setup server was updated. Refresh this page, then continue from the saved step.',
  SETUP_REVIEW_EXPIRED:'This review expired. Prepare a fresh review before opening your wallet.',
  SETUP_NONCE_CHANGED:'Your wallet activity changed. Check the original transaction before preparing another review.',
  RECOVER_EXISTING_WALLET_TRANSACTION:'Recover the saved wallet transaction before preparing another review.',
  RECOVER_TRANSACTION_HASH_FIRST:'Copy the deployment or its replacement transaction hash from wallet activity, then recover it.',
  SETUP_RECOVERY_MISMATCH:'This transaction could not be verified as the reviewed deployment or its cancellation. The original wallet request is still saved.',
  SETUP_PROVIDERS_DISAGREE:'The two chain providers disagree. Nothing was marked complete. Recheck later.'};
const validHash=value=>/^0x[0-9a-f]{64}$/i.test(value??'');
const hashKey=reviewHash=>'gogh.setup.transaction.'+reviewHash;
function browserHash(reviewHash) {try {return localStorage.getItem(hashKey(reviewHash));} catch {return null;}}
function rememberHash(reviewHash,hash) {try {localStorage.setItem(hashKey(reviewHash),hash);} catch {}}
const eth=wei=>{const n=BigInt(wei),fraction=(n%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');return (n/10n**18n).toString()+(fraction?'.'+fraction:'')+' ETH';};
async function request(action,extra={}) {
  const r=await fetch('/api/action',{method:'POST',headers:{'content-type':'application/json','x-setup-nonce':csrf},body:JSON.stringify({action,revision:state.revision,...extra})});
  const result=await r.json();if(!r.ok)throw Error(result.error);state=result.state;render();return state;
}
async function refresh() {stateKnown=false;const r=await fetch('/api/state');if(!r.ok)throw Error('Setup unavailable');({state,config,csrf}=await r.json());stateKnown=true;render();}
function render() {
  $('identity').textContent=config.owner;
  $('steps').replaceChildren(...config.steps.map(step=>{const li=document.createElement('li'),record=state.records.findLast(r=>r.review.action===step.action);li.textContent=step.label+' · '+(record?.status??'Pending');return li;}));
  const last=state.records.at(-1),review=last?.review;
  const savedHash=last?.recoveryTransactionHash??last?.transactionHash??last?.reportedTransactionHash??browserHash(last?.reviewHash);
  if(renderedReviewHash!==last?.reviewHash){$('hash').value=validHash(savedHash)?savedHash:'';renderedReviewHash=last?.reviewHash;}
  else if(!$('hash').value&&validHash(savedHash))$('hash').value=savedHash;
  $('review').hidden=!review;
  if(review){$('review-title').textContent=review.label;$('fee').textContent='Reviewed maximum network fee: '+eth(review.maximumNetworkFeeWei)+(last.inclusion?.actualNetworkFeeWei!=null?' · Actual fee: '+eth(last.inclusion.actualNetworkFeeWei)+(last.inclusion.feeExceeded?' · Your wallet transaction exceeded the reviewed fee limit.':''):'');$('target').textContent=review.transaction.to?'Contract: '+review.transaction.to:'New contract: '+review.predictedAddress;$('expiry').textContent=last.status==='PREPARED'&&Date.now()>=review.expiresAt?'This review expired. Select Prepare next transaction for a fresh review.':'Wallet review expires: '+new Date(review.expiresAt).toLocaleTimeString();$('review-json').textContent=JSON.stringify(last,null,2);}
  const complete=config.steps.every(step=>state.records.some(r=>r.review.action===step.action&&r.status==='INCLUDED'));
  $('prepare').disabled=busy||!stateKnown||complete||!!last&&!['PREPARED','DECLINED','INCLUDED','REVERTED','CANCELLED'].includes(last.status);
  $('send').disabled=busy||!stateKnown||last?.status!=='PREPARED'||Date.now()>=review?.expiresAt;
  $('recover').disabled=busy||!['WALLET_REQUESTED','SUBMITTED'].includes(last?.status);
  $('recheck').disabled=busy||!(last?.status==='SUBMITTED'||last?.status==='WALLET_REQUESTED'&&validHash($('hash').value.trim()));
}
async function walletIdentity() {
  if(!window.ethereum)throw Error('Open this page in your wallet-enabled browser.');
  const accounts=await window.ethereum.request({method:'eth_requestAccounts'});
  if(accounts[0]?.toLowerCase()!==config.owner.toLowerCase())throw Error('Connect the selected deployment wallet.');
  if(BigInt(await window.ethereum.request({method:'eth_chainId'}))!==4663n)throw Error('Switch your wallet to Robinhood Chain.');
  $('wallet').textContent='Connected · '+accounts[0];return window.ethereum;
}
function showRecoveryStatus() {
  const current=state.records.at(-1);
  if(current?.status==='INCLUDED')status(config.completionMessage);
  else if(current?.status==='CANCELLED')status('Cancellation confirmed by both chain providers. No factory was deployed by this request. You may prepare a fresh review; no transaction will be sent automatically.');
  else if(current?.status==='REVERTED')status('The deployment transaction reverted. You may prepare a fresh review.');
  else status('Wallet request saved. Waiting for chain visibility or 12 confirmations. A speed-up or cancellation can be checked by pasting its replacement hash.');
}
async function run(fn) {
  if(busy)return;busy=true;render();
  try{await fn();}
  catch(e){
    // A lost claim response may already have saved WALLET_REQUESTED. Only a
    // successful authoritative refresh can establish that it is safe to retry.
    const refreshed=await refresh().then(()=>true,()=>false);
    const retryable=refreshed&&state.records.at(-1)?.status==='PREPARED';
    status(e.message==='LIVE_SETUP_READ_UNAVAILABLE'&&retryable
      ? 'The chain check could not finish. No deployment transaction was requested. Your review is saved; retry Confirm setup, or prepare a fresh review if it expired.'
      :e.code===4001?'Wallet request declined. No new transaction was confirmed here. Follow the saved step below.':errors[e.message]??e.message);
  } finally{busy=false;await refresh().catch(()=>{});render();}
}
$('connect').onclick=()=>run(async()=>{await walletIdentity();status('Wallet connected. No transaction submitted. Review the deployment below, then choose Confirm setup to open the transaction in MetaMask.');});
$('prepare').onclick=()=>run(async()=>{status('Checking both chain providers and simulating the deployment. This does not open a transaction in MetaMask.');await request('prepare');status('Review the setup transaction, then choose Confirm setup to open MetaMask.');});
$('send').onclick=()=>run(async()=>{
  status('Checking your connected wallet. No transaction has been requested yet.');
  const wallet=await walletIdentity(),record=state.records.at(-1),hash=record.reviewHash;
  status('Checking the deployment with both chain providers. MetaMask will open after these checks pass.');
  await request('claim',{reviewHash:hash});
  // Only this successful claim can prompt. Refreshing a claimed record never reaches here.
  const accounts=await wallet.request({method:'eth_accounts'}),chain=await wallet.request({method:'eth_chainId'});
  if(accounts[0]?.toLowerCase()!==config.owner.toLowerCase() || BigInt(chain)!==4663n) {
    await request('decline',{reviewHash:hash});throw Error('Wallet changed. Reconnect the selected wallet and prepare a fresh review.');
  }
  let txHash;
  status('Checks passed. Review the contract deployment in MetaMask and confirm only if it matches your intent.');
  try {txHash=await wallet.request({method:'eth_sendTransaction',params:[state.records.at(-1).review.transaction]});}
  catch(error) {if(error.code===4001)await request('decline',{reviewHash:hash});throw error;}
  if(!validHash(txHash))throw Error('The wallet did not return a transaction hash. Check wallet activity to recover this request.');
  // Preserve the wallet result before any provider lookup or server response.
  rememberHash(hash,txHash);$('hash').value=txHash;await request('recover',{transactionHash:txHash});
  showRecoveryStatus();
});
$('hash').oninput=render;
$('recover').onclick=()=>run(async()=>{await request('recover',{transactionHash:$('hash').value.trim()});showRecoveryStatus();});
$('recheck').onclick=()=>run(async()=>{
  const last=state.records.at(-1),hash=$('hash').value.trim();
  const saved=last.recoveryTransactionHash??last.transactionHash??last.reportedTransactionHash;
  if(validHash(hash)&&hash.toLowerCase()!==saved?.toLowerCase())await request('recover',{transactionHash:hash});
  else await request('recheck');
  showRecoveryStatus();
});
await refresh();setInterval(()=>{if(!busy)render();},1000);
