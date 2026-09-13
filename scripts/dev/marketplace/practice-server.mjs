import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAbi, encodeFunctionData, decodeEventLog, keccak256 } from 'viem';
import { prepareMarketplaceReview } from '../../../broker/src/v4/marketplace/review.mjs';
import { reconcileMarketplaceReview } from '../../../broker/src/v4/marketplace/reconcile.mjs';
import { MARKETPLACE_PINS as P, MARKETPLACE_BID_ABI, MARKETPLACE_EVENTS_ABI, SEAPORT_ABI, ORDER_COMPONENTS } from '../../../broker/src/v4/marketplace/contracts.mjs';

const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item);
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const requireFact = (value, code='PRACTICE_REQUEST_INVALID') => { if (!value) throw Error(code); };
const same = (a,b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const terminal = new Set(['COMPLETED','BID_ACTIVE','BID_FILLED','BID_CANCELLED','BID_ALREADY_CANCELLED','BID_ALREADY_SETTLED','REVERTED','CANCELLED']);
const zeroHash = `0x${'0'.repeat(64)}`, MAX_RECORDS = 80, MAX_RECOVERY_BLOCKS = 128;
const bidABI = parseAbi([`function orderComponents(bytes32) view returns (${ORDER_COMPONENTS})`]);
const wethABI = parseAbi(['function balanceOf(address) view returns(uint256)']);
const nftABI = parseAbi(['function ownerOf(uint256) view returns(address)']);
const errorCodes = new Set(['PRACTICE_REQUEST_INVALID','PRACTICE_ACTION_UNAVAILABLE','PRACTICE_CHECK_UNAVAILABLE','PRACTICE_SESSION_FULL',
  'PRACTICE_REVIEW_EXPIRED','PRACTICE_TRANSACTION_PENDING','PRACTICE_RECOVERY_LIMIT','PRACTICE_NONCE_CONFLICT','PRACTICE_RECONCILIATION_FAILED',
  'PRACTICE_BID_STATE_MISMATCH','PRACTICE_TRANSACTION_CLAIMED','PRACTICE_BUSY','SIMULATION_REVERTED_OR_UNAVAILABLE']);
const safeError = error => errorCodes.has(error?.message) ? error.message : 'PRACTICE_CHECK_UNAVAILABLE';
const events = (receipt,address,eventName) => receipt.logs.filter(log=>same(log.address,address)).flatMap(log=>{
  try { const item=decodeEventLog({abi:MARKETPLACE_EVENTS_ABI,data:log.data,topics:log.topics,strict:true});return item.eventName===eventName?[item.args]:[]; } catch { return []; }
});

// Search only blocks produced after this server's durable local claim. Never
// scan the public fork history, accept a caller hash/nonce, or send a replacement.
export async function recoverPracticeTransaction({client,claim,assertDisposable}) {
  await assertDisposable();
  requireFact(claim && /^\d+$/.test(claim.fromBlock) && /^\d+$/.test(claim.nonce),'PRACTICE_RECONCILIATION_FAILED');
  const head=await client.getBlockNumber(), start=BigInt(claim.fromBlock)+1n;
  requireFact(head>=start-1n && head-start+1n<=BigInt(MAX_RECOVERY_BLOCKS),'PRACTICE_RECOVERY_LIMIT');
  const found=[];
  for(let number=start;number<=head;number++) {
    const block=await client.getBlock({blockNumber:number,includeTransactions:true});
    requireFact(block.number===number && hash(block.hash) && Array.isArray(block.transactions),'PRACTICE_RECONCILIATION_FAILED');
    for(const tx of block.transactions) {
      requireFact(tx && typeof tx==='object','PRACTICE_RECONCILIATION_FAILED');
      if(same(tx.from,claim.from) && BigInt(tx.nonce)===BigInt(claim.nonce)) {
        requireFact(same(tx.to,claim.to) && same(tx.input,claim.data) && tx.value===BigInt(claim.value)
          && hash(tx.hash) && tx.blockNumber===number && same(tx.blockHash,block.hash),'PRACTICE_NONCE_CONFLICT');
        found.push(tx.hash);
      }
    }
  }
  requireFact(found.length<=1,'PRACTICE_RECONCILIATION_FAILED');
  if(found.length)return found[0];
  const mined=await client.getTransactionCount({address:claim.from,blockTag:'latest'});
  requireFact(BigInt(mined)<=BigInt(claim.nonce),'PRACTICE_NONCE_CONFLICT');
  return null;
}

// Node-only injection seam for tests and the owned-fork launcher. HTTP callers
// cannot choose a client, signer, RPC URL, callback, contract, nonce or calldata.
export async function startMarketplacePractice({client,owner,wallet,collection,escrow,deps,budget,
  makeListing,sendReview,send,seller,assertDisposable,anchor}) {
  await assertDisposable();
  requireFact(/^http:\/\/127\.0\.0\.1:\d+$/.test(client.transport?.url??'')
    && /anvil/i.test(await client.request({method:'web3_clientVersion'}))
    && await client.getChainId()===4663 && wallet==='0xcadcfd37e715bc031cf0cec7fa2335091c878c83');
  requireFact(deps.disposableBidDeployment?.environment==='OWNED_DISPOSABLE_CHAIN'
    && same(deps.disposableBidDeployment.address,escrow),'PRACTICE_REQUEST_INVALID');
  const dir=await mkdtemp(join(tmpdir(),'gogh-market-practice-journal-'));
  const nonce=randomBytes(32).toString('hex'),records=[],bids=new Map();
  let current=null,lastResult=null,busy=false,origin,nextToken=10001n,lastError=null;
  const persist=async()=>{await writeFile(join(dir,'journal.tmp'),json({records,bids:[...bids]}),{mode:0o600});await rename(join(dir,'journal.tmp'),join(dir,'journal.json'));};
  const request=(action,selection)=>({action,owner,punkId:'93',walletRole:'AGENT',selection,budget});
  const readBalance=async()=>{const [native,weth]=await Promise.all([client.getBalance({address:wallet}),client.readContract({address:P.weth,abi:wethABI,functionName:'balanceOf',args:[owner]})]);return {nativeWei:String(native),funderWethWei:String(weth)};};
  const snapshot=async()=>{await assertDisposable();return {schema:'GOGH_MARKETPLACE_PRACTICE_V1',localOnly:true,publicTransactions:0,
    productionAuthority:false,owner,punkId:'93',wallet,collection,nonce,busy,lastError,lastResult,balance:await readBalance(),
    review:current?{id:current.id,status:current.status,action:current.review.action,expiresAt:current.review.expiresAt,
      cost:current.review.cost,selection:current.review.selection,transactionHash:current.hash??null}:null,
    bids:[...bids.values()].map(({claim,creationReview,...bid})=>bid),
    limits:'Copied funds and test NFTs only. Skill and policy permissions are fixed practice fixtures. Public bids remain unavailable.'};};
  async function currentBidState(bid) {
    const block=await client.getBlock(),runtime=await client.getCode({address:escrow,blockNumber:block.number});
    requireFact(runtime && keccak256(runtime)===deps.disposableBidDeployment.codeHash,'PRACTICE_BID_STATE_MISMATCH');
    const row=await client.readContract({address:escrow,abi:MARKETPLACE_BID_ABI,functionName:'bids',args:[bid.orderHash],blockNumber:block.number,ccipRead:false});
    requireFact(same(row[0],owner)&&same(row[1],wallet)&&same(row[2],collection)&&row[3]===93n
      &&row[4]===BigInt(bid.anyToken?'0':bid.tokenId)&&row[5]===100000000000000n&&row[10]===bid.anyToken,'PRACTICE_BID_STATE_MISMATCH');
    if(row[13]===2) {
      const status=await client.readContract({address:P.seaport,abi:SEAPORT_ABI,functionName:'getOrderStatus',args:[bid.orderHash],blockNumber:block.number,ccipRead:false});
      const holder=await client.readContract({address:collection,abi:nftABI,functionName:'ownerOf',args:[BigInt(bid.tokenId)],blockNumber:block.number,ccipRead:false});
      requireFact(!status[1]&&status[2]!==0n&&status[2]===status[3]&&same(holder,wallet),'PRACTICE_BID_STATE_MISMATCH');
      bid.status='FILLED';
    } else if(row[13]===3)bid.status='BID_CANCELLED';
    else if(row[13]===1)bid.status=BigInt(row[9])<=block.timestamp?'BID_EXPIRED':'BID_ACTIVE';
    else throw Error('PRACTICE_BID_STATE_MISMATCH');
    requireFact(same((await client.getBlock({blockNumber:block.number})).hash,block.hash),'PRACTICE_RECONCILIATION_FAILED');
    return row;
  }
  async function verifyFill(bid) {
    if(!bid.fillHash)return;
    const [tx,receipt]=await Promise.all([client.getTransaction({hash:bid.fillHash}),client.getTransactionReceipt({hash:bid.fillHash})]);
    const claim=bid.claim;
    requireFact(claim && same(tx.hash,bid.fillHash)&&same(tx.from,seller)&&same(tx.to,P.seaport)&&same(tx.input,claim.data)
      &&tx.value===0n&&BigInt(tx.nonce)===BigInt(claim.nonce)&&tx.chainId===4663&&same(receipt.transactionHash,bid.fillHash)
      &&tx.blockNumber===receipt.blockNumber&&same(tx.blockHash,receipt.blockHash),'PRACTICE_RECONCILIATION_FAILED');
    const block=await client.getBlock({blockNumber:receipt.blockNumber});requireFact(same(block.hash,receipt.blockHash),'PRACTICE_RECONCILIATION_FAILED');
    requireFact(receipt.status==='success'||receipt.status==='reverted','PRACTICE_RECONCILIATION_FAILED');
    if(receipt.status==='reverted'){bid.fillState='REVERTED';return;}
    const filled=events(receipt,P.seaport,'OrderFulfilled').filter(e=>same(e.orderHash,bid.orderHash));
    const settled=events(receipt,escrow,'BidSettled').filter(e=>same(e.orderHash,bid.orderHash));
    const transferred=events(receipt,collection,'Transfer').filter(e=>same(e.to,wallet)&&e.tokenId===BigInt(bid.tokenId));
    requireFact(filled.length===1&&settled.length===1&&transferred.length===1,'PRACTICE_RECONCILIATION_FAILED');
    await currentBidState(bid);requireFact(bid.status==='FILLED','PRACTICE_BID_STATE_MISMATCH');bid.fillState='COMPLETED';
  }
  async function refresh() {
    if(current?.claim&&!current.hash&&!terminal.has(current.status)) {
      current.hash=await recoverPracticeTransaction({client,claim:current.claim,assertDisposable});
      if(current.hash)current.status='SUBMITTED';
    }
    if(current?.hash) {
      const result=await reconcileMarketplaceReview(current.review,{client,transactionHash:current.hash,minConfirmations:1});
      current.status=result.status;lastResult=result;
      if(result.status==='BID_ACTIVE'&&!bids.has(result.orderHash))bids.set(result.orderHash,{orderHash:result.orderHash,
        tokenId:current.fixtureTokenId,status:'BID_ACTIVE',anyToken:current.review.selection.anyToken,
        creationReview:current.id,fillHash:null,fillState:null,claim:null});
    }
    for(const bid of bids.values()) {
      if(bid.claim&&!bid.fillHash)bid.fillHash=await recoverPracticeTransaction({client,claim:bid.claim,assertDisposable});
      if(bid.fillHash)await verifyFill(bid);
      await currentBidState(bid);
    }
    if(current?.review.action==='CREATE_WETH_BID') {
      const bid=[...bids.values()].find(b=>b.creationReview===current.id);
      if(bid?.status==='FILLED'){current.status='BID_FILLED';lastResult={status:'BID_FILLED',tokenId:bid.tokenId,orderHash:bid.orderHash,transactionHash:bid.fillHash,verifiedOnChain:true};}
      else if(bid?.status==='BID_CANCELLED'){current.status='BID_ALREADY_CANCELLED';lastResult={status:'BID_ALREADY_CANCELLED',refundedWethWei:'0',refundInThisTransaction:false};}
    }
    await persist();
  }
  async function prepare(action,input) {
    requireFact(!current||terminal.has(current.status),'PRACTICE_TRANSACTION_CLAIMED');
    requireFact(records.length<MAX_RECORDS,'PRACTICE_SESSION_FULL');
    let selection,fixtureTokenId;
    if(action==='BUY_LISTINGS') {
      const listings=[];for(let i=0;i<input.quantity;i++)listings.push(await makeListing(nextToken++));
      deps={...deps,loadListings:async()=>listings};selection={collection,orderHashes:listings.map(row=>row.order_hash)};
    } else if(action==='CREATE_WETH_BID') {
      fixtureTokenId=String(nextToken++);await makeListing(BigInt(fixtureTokenId));
      selection={collection,tokenId:input.anyToken?'0':fixtureTokenId,anyToken:input.anyToken,priceWei:'100000000000000',deadline:String((await client.getBlock()).timestamp+3600n)};
    } else { requireFact(bids.has(input.orderHash));selection={orderHash:input.orderHash}; }
    const review=await prepareMarketplaceReview(request(action,selection),deps);
    requireFact(review.transaction&&review.walletRequests===0&&review.publicTransactions===0);
    current={id:randomBytes(24).toString('hex'),status:'PREPARED',review,fixtureTokenId,hash:null,claim:null};
    records.push(current);lastResult=null;await persist();
  }
  function validateAction(body) {
    requireFact(exact(body,['operation','input']));const input=body.input;
    if(body.operation==='prepare_purchase')requireFact(exact(input,['quantity'])&&[1,2].includes(input.quantity));
    else if(body.operation==='prepare_bid')requireFact(exact(input,['anyToken'])&&typeof input.anyToken==='boolean');
    else if(['prepare_cancel','fill_bid'].includes(body.operation))requireFact(exact(input,['orderHash'])&&hash(input.orderHash)&&bids.has(input.orderHash));
    else if(body.operation==='confirm')requireFact(exact(input,['reviewId','phrase'])&&input.reviewId===current?.id&&input.phrase==='CONFIRM COPY');
    else if(body.operation==='cancel_review')requireFact(exact(input,['reviewId'])&&input.reviewId===current?.id&&current.status==='PREPARED');
    else if(body.operation==='recheck')requireFact(exact(input,[]));
    else throw Error('PRACTICE_ACTION_UNAVAILABLE');
  }
  async function claim(from,to,data,value,nonceValue) {
    const [head,latest,pending]=await Promise.all([client.getBlockNumber(),client.getTransactionCount({address:from,blockTag:'latest'}),client.getTransactionCount({address:from,blockTag:'pending'})]);
    requireFact(latest===pending && (nonceValue===undefined||BigInt(latest)===BigInt(nonceValue)),'PRACTICE_TRANSACTION_PENDING');
    return {from,to,data,value:String(value),nonce:String(latest),fromBlock:String(head)};
  }
  async function act(body) {
    validateAction(body);await assertDisposable();lastError=null;
    // Only the fixed local clock update is available, never caller RPC methods.
    await client.request({method:'evm_mine',params:[]});
    if(body.operation==='prepare_purchase')await prepare('BUY_LISTINGS',body.input);
    else if(body.operation==='prepare_bid')await prepare('CREATE_WETH_BID',body.input);
    else if(body.operation==='prepare_cancel')await prepare('CANCEL_WETH_BID',body.input);
    else if(body.operation==='confirm') {
      if(current.status!=='PREPARED'){await refresh();return;}
      requireFact(Date.now()+5000<current.review.expiresAt,'PRACTICE_REVIEW_EXPIRED');
      const tx=current.review.transaction;
      current.claim=await claim(owner,tx.to,tx.data,BigInt(tx.value),tx.nonce);
      current.status='WALLET_REQUESTED';await persist();
      const receipt=await sendReview(current.review);current.hash=receipt.transactionHash;current.status='SUBMITTED';await persist();await refresh();
    } else if(body.operation==='recheck')await refresh();
    else if(body.operation==='cancel_review'){current.status='CANCELLED';lastResult={status:'REVIEW_CANCELLED'};await persist();}
    else if(body.operation==='fill_bid') {
      const bid=bids.get(body.input.orderHash);
      await currentBidState(bid);
      if(bid.claim){await refresh();return;}
      requireFact(bid.status==='BID_ACTIVE','PRACTICE_BID_STATE_MISMATCH');
      const components=await client.readContract({address:escrow,abi:bidABI,functionName:'orderComponents',args:[bid.orderHash]});
      const {counter,...parameters}=components;
      const order={parameters:{...parameters,totalOriginalConsiderationItems:1n},numerator:1n,denominator:1n,signature:'0x',extraData:'0x'};
      const criteria=bid.anyToken?[{orderIndex:0n,side:1,index:0n,identifier:BigInt(bid.tokenId),criteriaProof:[]}]:[];
      const data=encodeFunctionData({abi:SEAPORT_ABI,functionName:'fulfillAdvancedOrder',args:[order,criteria,zeroHash,seller]});
      await client.call({account:seller,to:P.seaport,data});
      bid.claim=await claim(seller,P.seaport,data,0n);bid.fillState='REQUESTED';await persist();
      const receipt=await send(seller,P.seaport,data);bid.fillHash=receipt.transactionHash;await persist();await refresh();
      requireFact(bid.status==='FILLED','PRACTICE_BID_STATE_MISMATCH');
      lastResult={status:'BID_FILLED',tokenId:bid.tokenId,orderHash:bid.orderHash,transactionHash:bid.fillHash,verifiedOnChain:true};await persist();
    }
  }
  const assets=new Map([['/','practice.html'],['/practice.js','practice.js'],['/practice.css','practice.css']]);
  const server=createServer(async(req,res)=>{
    const headers={'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY',
      'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
    try {
      requireFact(req.headers.host===new URL(origin).host);
      if(req.method==='GET'&&assets.has(req.url)) {
        const file=assets.get(req.url);res.writeHead(200,{...headers,'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
        res.end(await readFile(new URL(file,import.meta.url)));return;
      }
      if(req.method==='GET'&&req.url==='/api/state') {
        requireFact(!req.headers.origin||req.headers.origin===origin);
        const value=await snapshot();res.writeHead(200,{...headers,'content-type':'application/json'});res.end(json(value));return;
      }
      requireFact(req.method==='POST'&&req.url==='/api/action'&&req.headers.origin===origin
        &&req.headers['x-practice-nonce']===nonce&&req.headers['content-type']==='application/json');
      requireFact(!busy,'PRACTICE_BUSY');
      if(req.headers['content-length'])requireFact(/^\d+$/.test(req.headers['content-length'])&&Number(req.headers['content-length'])<=4096);
      let raw='';for await(const chunk of req){raw+=chunk;requireFact(Buffer.byteLength(raw)<=4096);}
      const body=JSON.parse(raw);validateAction(body);requireFact(!busy,'PRACTICE_BUSY');busy=true;
      try {await act(body);} catch(error) {lastError=safeError(error);throw error;} finally {busy=false;}
      const value=await snapshot();res.writeHead(200,{...headers,'content-type':'application/json'});res.end(json(value));
    } catch(error) {
      if(!res.headersSent)res.writeHead(409,{...headers,'content-type':'application/json'});
      res.end(json({ok:false,code:safeError(error),publicTransactions:0}));
    }
  });
  server.headersTimeout=10000;server.requestTimeout=65000;server.keepAliveTimeout=1000;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  let closed=false;const close=async()=>{if(closed)return;closed=true;await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});await rm(dir,{recursive:true,force:true});};
  return {url:origin,close};
}

export async function serveMarketplacePractice(context) {
  const session=await startMarketplacePractice(context);
  console.log(json({schema:'GOGH_MARKETPLACE_PRACTICE_READY_V1',url:session.url,publicTransactions:0,walletConnectionRequired:false,
    copiedPunk:'93',anchor:{number:String(context.anchor.number),hash:context.anchor.hash}}));
  await new Promise(resolve=>{const close=()=>{process.off('SIGINT',close);process.off('SIGTERM',close);session.close().then(resolve);};process.once('SIGINT',close);process.once('SIGTERM',close);});
}
