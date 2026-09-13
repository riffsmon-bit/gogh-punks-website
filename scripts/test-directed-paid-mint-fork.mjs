import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import {createPublicClient,createWalletClient,http,parseAbi,keccak256} from 'viem';
if(process.argv.length!==3 || process.argv[2]!=='--disposable-fork-only')throw Error('Requires --disposable-fork-only');
const root=fileURLToPath(new URL('..',import.meta.url));
const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const pub=createPublicClient({transport:http('https://rpc.mainnet.chain.robinhood.com',{timeout:12000,retryCount:0}),cacheTime:0});
const anchor=await pub.getBlock(),owner='0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6',worker='0x0000000000000000000000000000000000009999',collection='0xb73f1d1aee57410d537d87b656e98b9d3df5b213';
const child=spawn('anvil',['--silent','--host','127.0.0.1','--port',String(port),'--chain-id','4663','--fork-url','https://rpc.mainnet.chain.robinhood.com','--fork-block-number',String(anchor.number)],{stdio:'ignore'});
let startupError;child.once('error',e=>{startupError=e});
try {
 const transport=http(`http://127.0.0.1:${port}`,{timeout:20000,retryCount:0}),c=createPublicClient({transport,cacheTime:0});
 for(let i=0;i<80;i++){if(startupError || child.exitCode!==null)throw Error('OWNED_FORK_START_FAILED');try{if(await c.getChainId()===4663)break}catch{}await new Promise(r=>setTimeout(r,250));}
 assert.match(await c.request({method:'web3_clientVersion'}),/anvil/i);assert.equal((await c.getBlock({blockNumber:anchor.number})).hash,anchor.hash);
 for(const a of [owner,worker])await c.request({method:'anvil_impersonateAccount',params:[a]});
 await c.request({method:'anvil_setBalance',params:[worker,'0xde0b6b3a7640000']});
 const w=createWalletClient({transport,account:owner});
 const artifact=JSON.parse(await readFile(root+'/contracts/out/GoghPunkDirectedPaidMint.sol/GoghPunkDirectedPaidMintFactory.json'));
 const vaultArtifact=JSON.parse(await readFile(root+'/contracts/out/GoghPunkDirectedPaidMint.sol/GoghPunkDirectedPaidMint.json'));
 
 const registry='0x3253adc3bBd5B0010C1Bf9cE8def26b7e0DB5844';
 const r=async hash=>{const receipt=await c.waitForTransactionReceipt({hash});assert.equal(receipt.status,'success');return receipt};
 const deployed=await r(await w.deployContract({abi:artifact.abi,bytecode:artifact.bytecode.object,args:[registry,keccak256(await c.getCode({address:registry})),'0x53e4b9339cf624803c9a7d0195576cca5b917920813508d86b3eb93dcbabeb5c','0xda60742d810ae5de9c087af2e82b05fb84e9112cfade927fca0db6490ea52519','0x69e7a7158f30acb817dc83a4e21af19a216c3a2ae57db423599ca82f321e3041'],chain:null}));
 const drop=await c.readContract({address:'0x00005EA00Ac477B1030CE78506496e8C2dE24bf5',abi:parseAbi(['function getPublicDrop(address) view returns (uint80,uint48,uint48,uint16,uint16,bool)']),functionName:'getPublicDrop',args:[collection]});const price=drop[0],fee=20000000000000n;
 const authorization=await r(await w.writeContract({address:deployed.contractAddress,abi:artifact.abi,functionName:'authorize',args:[93n,worker,collection,keccak256(await c.getCode({address:collection})),price,fee,0n,(await c.getBlock()).timestamp+600n],value:price+fee,chain:null}));
 const vault=await c.readContract({address:deployed.contractAddress,abi:artifact.abi,functionName:'vaults',args:[93n]});
 const executed=await r(await createWalletClient({transport,account:worker}).writeContract({address:vault,abi:vaultArtifact.abi,functionName:'execute',args:[1n],chain:null}));
 const tokenAbi=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)','function ownerOf(uint256) view returns(address)']);
 const transfers=executed.logs.filter(l=>l.address.toLowerCase()===collection&&l.topics[0]==='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');assert.equal(transfers.length,2);
 const tokenId=BigInt(transfers[0].topics[3]);assert.equal((await c.readContract({address:collection,abi:tokenAbi,functionName:'ownerOf',args:[tokenId]})).toLowerCase(),'0xcadcfd37e715bc031cf0cec7fa2335091c878c83');
 assert.equal(await c.getBalance({address:vault}),0n);
 const result={status:'PASS',environment:'DISPOSABLE_FORK_ONLY',publicAnchor:{number:String(anchor.number),hash:anchor.hash},sourceCollection:collection,priceWei:String(price),executionFeeWei:String(fee),copiedPunkTokenId:'93',oneOwnerAuthorization:true,workerExecuted:true,receivedTokenId:String(tokenId),recipient:'0xcAdcFD37e715bC031cF0cEC7fA2335091c878C83',deploymentGas:String(deployed.gasUsed),firstAuthorizationGas:String(authorization.gasUsed),executionGas:String(executed.gasUsed),publicTransactions:0};await writeFile(root+'/docs/review/2026-09-12/atomic-forge/directed-paid-mint-fork.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}catch(e){console.log(JSON.stringify({status:'FAILED',errorType:e.name,shortMessage:e.shortMessage??null}));process.exitCode=1}finally{if(child.exitCode===null)child.kill('SIGTERM')}
