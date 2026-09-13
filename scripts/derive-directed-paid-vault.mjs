import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {createPublicClient,http,parseAbi,keccak256,encodeDeployData,getCreate2Address,pad,toHex} from 'viem';
if(process.argv.length!==3||process.argv[2]!=='--disposable-fork-only')throw Error('Requires --disposable-fork-only');
const file=new URL('../deployments/robinhood-directed-paid-mint.json',import.meta.url);
const release=JSON.parse(await readFile(file));
const owner='0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6';
const target='0xb73f1d1aee57410d537d87b656e98b9d3df5b213';
const recipient='0xcadcfd37e715bc031cf0cec7fa2335091c878c83';
const artifact=JSON.parse(await readFile(new URL('../contracts/out/GoghPunkDirectedPaidMint.sol/GoghPunkDirectedPaidMint.json',import.meta.url)));
const data=encodeDeployData({abi:artifact.abi,bytecode:artifact.bytecode.object,args:[93n,recipient,release.adapter]});
const predicted=getCreate2Address({from:release.factory,salt:pad(toHex(93)),bytecode:data}).toLowerCase();
const pub=createPublicClient({transport:http('https://rpc.mainnet.chain.robinhood.com',{timeout:12000,retryCount:0}),cacheTime:0});
const anchor=await pub.getBlock();
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const child=spawn('anvil',['--silent','--host','127.0.0.1','--port',String(port),'--chain-id','4663','--fork-url','https://rpc.mainnet.chain.robinhood.com','--fork-block-number',String(anchor.number)],{stdio:'ignore'});
try {
 const c=createPublicClient({transport:http(`http://127.0.0.1:${port}`,{timeout:20000,retryCount:0}),cacheTime:0});
 for(let i=0;i<80;i++){try{if(await c.getChainId()===4663)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 assert.match(await c.request({method:'web3_clientVersion'}),/anvil/i);
 assert.equal((await c.getBlock({blockNumber:anchor.number})).hash,anchor.hash);
 await c.request({method:'anvil_impersonateAccount',params:[owner]});
 const abi=parseAbi(['function authorize(uint256,address,address,bytes32,uint256,uint256,uint64,uint48) payable','function vaults(uint256) view returns(address)']);
 const drop=await c.readContract({address:'0x00005ea00ac477b1030ce78506496e8c2de24bf5',abi:parseAbi(['function getPublicDrop(address) view returns(uint80,uint48,uint48,uint16,uint16,bool)']),functionName:'getPublicDrop',args:[target]});
 const {encodeFunctionData}=await import('viem');
 const targetHash=keccak256(await c.getCode({address:target}));
 const tx=await c.request({method:'eth_sendTransaction',params:[{from:owner,to:release.factory,value:toHex(drop[0]+25000000000000n),data:encodeFunctionData({abi,functionName:'authorize',args:[93n,release.executor,target,targetHash,drop[0],25000000000000n,0n,anchor.timestamp+600n]})}]});
 assert.equal((await c.waitForTransactionReceipt({hash:tx})).status,'success');
 assert.equal((await c.readContract({address:release.factory,abi,functionName:'vaults',args:[93n]})).toLowerCase(),predicted);
 const code=await c.getCode({address:predicted});let actual=code.slice(2),compiled=artifact.deployedBytecode.object.slice(2);const bindings=[];
 for(const refs of Object.values(artifact.deployedBytecode.immutableReferences)){
  const values=refs.map(({start,length})=>{assert.equal(length,32);return actual.slice(start*2,(start+length)*2)});assert.equal(new Set(values).size,1);bindings.push('0x'+values[0]);
  for(const {start,length} of refs){actual=actual.slice(0,start*2)+'0'.repeat(length*2)+actual.slice((start+length)*2);compiled=compiled.slice(0,start*2)+'0'.repeat(length*2)+compiled.slice((start+length)*2);}
 }
 assert.equal(actual,compiled);assert.deepEqual(bindings.sort(),[toHex(93),release.factory,recipient,release.adapter,release.adapterCodeHash].map(v=>pad(v)).sort());
 Object.assign(release,{owner,tokenId:'93',targetCollection:target,targetCollectionCodeHash:targetHash,recipient,vault:predicted,vaultCodeHash:keccak256(code),
  vaultDerivation:{anchor:String(anchor.number),hash:anchor.hash,compiledRuntimeAndImmutablesVerified:true,environment:'DISPOSABLE_FORK_ONLY',publicTransactions:0}});
 await writeFile(file,JSON.stringify(release,null,2)+'\n');console.log(JSON.stringify({status:'PASS',vault:predicted,vaultCodeHash:release.vaultCodeHash,priceWei:String(drop[0]),publicTransactions:0}));
}finally{if(child.exitCode===null)child.kill('SIGTERM');}
