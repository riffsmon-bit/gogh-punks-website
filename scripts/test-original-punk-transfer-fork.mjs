// ALL transfers are confined to a disposable fork. No keys/env, deployment, wrapping,
// collection configuration, marketplace order or public transaction is accepted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi } from 'viem';
import agentDeployment from '../deployments/robinhood-punk-agent-account.json' with { type: 'json' };
import walletDeployment from '../deployments/robinhood-automation-v3.json' with { type: 'json' };

if (process.argv.length !== 3 || process.argv[2] !== '--fork-read-only') throw Error('Requires --fork-read-only');
const upstream='https://rpc.mainnet.chain.robinhood.com';
const collection='0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6';
const originalHash='0x3222e4925f77909e6370e17fe071d2774d43e191f6bc72c3a97c97209c6e2e93';
const abi=parseAbi(['function ownerOf(uint256) view returns(address)', 'function owner() view returns(address)',
  'function token() view returns(uint256,address,uint256)', 'function account(uint256) view returns(address)',
  'function safeTransferFrom(address,address,uint256)', 'function transferFrom(address,address,uint256)',
  'function approve(address,uint256)', 'function getTransferValidator() view returns(address)',
  'function getCollectionSecurityPolicy(address) view returns((uint8 transferSecurityLevel,uint120 operatorWhitelistId,uint120 permittedContractReceiversId))',
  'function getWhitelistedAccounts(uint120) view returns(address[])',
  'function isAutonomousSessionActive() view returns(bool)', 'function entryPointDeposit() view returns(uint256)']);
const remote=createPublicClient({transport:http(upstream,{timeout:15000,retryCount:0})});
assert.equal(await remote.getChainId(),4663);
const block=await remote.getBlock();
assert.equal(keccak256(await remote.getCode({address:collection,blockNumber:block.number})),originalHash);
const records=[agentDeployment.contracts.GoghPunkAgentAccount,agentDeployment.contracts.GoghPunkAgentAccountRegistry,
  walletDeployment.contracts.GoghPunkAccountV3,walletDeployment.contracts.GoghPunkAccountRegistryV3];
for(const record of records) assert.equal(keccak256(await remote.getCode({address:record.address,blockNumber:block.number})),record.runtimeBytecodeHash);
const reservation=createServer(); await new Promise(r=>reservation.listen(0,'127.0.0.1',r));
const port=reservation.address().port; await new Promise(r=>reservation.close(r));
const node=spawn('anvil',['--silent','--host','127.0.0.1','--port',String(port),'--chain-id','4663',
  '--fork-url',upstream,'--fork-block-number',String(block.number)],{stdio:'ignore'});
let startupError; node.on('error',error=>{startupError=error;});
try {
  const transport=http(`http://127.0.0.1:${port}`,{timeout:20000,retryCount:0});
  const client=createPublicClient({transport,pollingInterval:50});
  let ready=false;
  for(let i=0;i<100;i++) {
    if(startupError) throw startupError;
    if(node.exitCode!==null) throw Error('FORK_EXITED');
    try {ready=await client.getChainId()===4663;} catch {}
    if(ready) break; await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(ready); assert.match(await client.request({method:'web3_clientVersion'}),/anvil/i);
  const read=(address,functionName,args=[])=>client.readContract({address,abi,functionName,args});
  const owner=await read(collection,'ownerOf',[93n]);
  const buyer='0x00000000000000000000000000000000b0b00930';
  assert.notEqual(owner.toLowerCase(),buyer.toLowerCase());
  assert.ok(!await client.getCode({address:buyer}));
  const account=await read(records[1].address,'account',[93n]);
  const punkWallet=await read(records[3].address,'account',[93n]);
  for(const address of [account,punkWallet]) {
    const code=await client.getCode({address}); assert.ok(code && code!=='0x');
    assert.equal(await read(address,'owner'),owner);
    assert.deepEqual(await read(address,'token'),[4663n,collection,93n]);
  }
  const snapshot=async()=>({agent:await client.getBalance({address:account}),
    punkWallet:await client.getBalance({address:punkWallet}),deposit:await read(account,'entryPointDeposit')});
  const balances=await snapshot(), activeBefore=await read(account,'isAutonomousSessionActive');
  // Impersonation and gas funding affect our local fork only, never the public owner.
  for(const address of [owner,buyer]) {
    await client.request({method:'anvil_impersonateAccount',params:[address]});
    await client.request({method:'anvil_setBalance',params:[address,'0x4563918244f40000']});
  }
  const wallet=createWalletClient({transport}); // the ONLY signer transport is loopback
  let transfers=0;
  const write=async(functionName,args,from)=>{
    const {request}=await client.simulateContract({address:collection,abi,functionName,args,account:from});
    const receipt=await client.waitForTransactionReceipt({hash:await wallet.writeContract({...request,chain:null}),timeout:20000});
    assert.equal(receipt.status,'success'); transfers+=functionName.endsWith('TransferFrom')||functionName==='transferFrom'?1:0;
  };
  await write('safeTransferFrom',[owner,buyer,93n],owner);
  for(const address of [account,punkWallet]) assert.equal((await read(address,'owner')).toLowerCase(),buyer.toLowerCase());
  assert.deepEqual(await snapshot(),balances);
  assert.equal(await read(account,'isAutonomousSessionActive'),false);
  assert.equal(await read(records[1].address,'account',[93n]),account);
  assert.equal(await read(records[3].address,'account',[93n]),punkWallet);
  // No buyer account creation, registration, skill claim or synchronization transaction.
  await write('transferFrom',[buyer,owner,93n],buyer);
  const activeAfterReturn=await read(account,'isAutonomousSessionActive');
  // Do not hide the existing immutable account's round-trip limitation.
  assert.equal(activeAfterReturn,activeBefore);
  const validator=await read(collection,'getTransferValidator');
  const policy=await read(validator,'getCollectionSecurityPolicy',[collection]);
  const operators=await read(validator,'getWhitelistedAccounts',[policy.operatorWhitelistId]);
  assert.ok(operators.length>0,'APPROVED_OPERATOR_REQUIRED');
  const operator=operators[0];
  await client.request({method:'anvil_impersonateAccount',params:[operator]});
  await client.request({method:'anvil_setBalance',params:[operator,'0x4563918244f40000']});
  await write('approve',[operator,93n],owner);
  await write('safeTransferFrom',[owner,buyer,93n],operator);
  assert.equal((await read(account,'owner')).toLowerCase(),buyer.toLowerCase());
  assert.equal((await read(punkWallet,'owner')).toLowerCase(),buyer.toLowerCase());
  assert.deepEqual(await snapshot(),balances);
  assert.equal(await read(account,'isAutonomousSessionActive'),false);
  assert.equal((await remote.getBlock({blockNumber:block.number})).hash,block.hash);
  console.log(JSON.stringify({result:'PASS',scope:'DISPOSABLE_FORK_ONLY',originalCollection:collection,
    block:String(block.number),blockHash:block.hash,collectionCodeHash:originalHash,account,punkWallet,
    balancesWei:balances,localTransfers:transfers,publicTransactions:0,wrapperUsed:false,buyerSetupTransactions:0,
    originalMarketplaceOperator:operator,collectionConfigurationChanges:0,
    checks:['direct original NFT transfer','unchanged account addresses','buyer automatically controls BOTH existing accounts',
      'native and EntryPoint balances retained','seller session inactive for different buyer',
      'approved original-collection operator transfer'],
    limitations:['No OpenSea order matching/settlement tested','No production skills activated or migrated',
      'Same-owner round-trip revocation still requires worker continuity enforcement'],activeBefore,activeAfterReturn},
    (_,value)=>typeof value==='bigint'?String(value):value,2));
} finally {
  if(node.exitCode===null && node.signalCode===null) await new Promise(r=>{node.once('exit',r);node.kill('SIGTERM');});
}
