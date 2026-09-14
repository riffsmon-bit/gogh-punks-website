import {keccak256} from 'viem';
const DELEGATION='0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b';
const IMPLEMENTATION='0x63c0c19a282a1b52b07dd5a65b58948a07dae32b';
const CODE_HASH='0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0';
const fail=code=>{throw Error(code);};
export async function verifySkillAdminSelfCallCode(client,code,blockNumber){
  // Viem represents an RPC "0x" bytecode result as undefined. No other falsy
  // result establishes an empty account; malformed provider data fails closed.
  if(code===undefined||code==='0x')return '0x';
  if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code)||code.toLowerCase()!==DELEGATION)
    fail('SKILL_ADMIN_SELF_CALL_NOT_REVIEWED');
  const implementation=await client.getCode({address:IMPLEMENTATION,blockNumber});
  if(typeof implementation!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(implementation)||keccak256(implementation)!==CODE_HASH)
    fail('SKILL_ADMIN_SELF_CALL_NOT_REVIEWED');
  return DELEGATION;
}
// Only empty-data, zero-value self transactions at the already-reserved nonce.
// The pinned MetaMask implementation has an empty receive() function; other code is not assumed inert.
export function createSkillAdminCancellationReview({clients,now=Date.now}) {
  if(!Array.isArray(clients)||clients.length!==2||clients[0]===clients[1])fail('SKILL_ADMIN_TWO_PROVIDERS_REQUIRED');
  return Object.freeze({async prepare({row,previousGasPrice='0x0'}){
    if(!['WALLET_REQUESTED','SUBMITTED'].includes(row.status))fail('SKILL_ADMIN_CANCELLATION_NOT_NEEDED');
    const owner=row.administrator,nonce=BigInt(row.preparation.transaction.nonce);
    const anchor=await clients[1].getBlock({blockTag:'latest'}),started=now();
    if(typeof anchor.number!=='bigint'||typeof anchor.timestamp!=='bigint'||!/^0x[0-9a-f]{64}$/i.test(anchor.hash)
      ||!Number.isSafeInteger(started)||Math.abs(started-Number(anchor.timestamp)*1000)>30000)fail('SKILL_ADMIN_CANCELLATION_STALE');
    const observations=await Promise.all(clients.map(async client=>{
      if(await client.getChainId()!==4663)fail('SKILL_ADMIN_CHAIN_CHANGED');
      const[block,latest,code]=await Promise.all([client.getBlock({blockNumber:anchor.number}),
        client.getTransactionCount({address:owner,blockTag:'latest'}),client.getCode({address:owner,blockNumber:anchor.number})]);
      if(block.hash!==anchor.hash)fail('SKILL_ADMIN_RECEIPT_REORG');
      if(BigInt(latest)!==nonce)fail('SKILL_ADMIN_NONCE_ALREADY_CONSUMED');
      return{accountCode:await verifySkillAdminSelfCallCode(client,code,anchor.number)};
    }));
    if(observations[0].accountCode!==observations[1].accountCode)fail('SKILL_ADMIN_PROVIDERS_DISAGREE');
    const base={account:owner,to:owner,data:'0x',value:0n,nonce:Number(nonce)};
    if(!Number.isSafeInteger(base.nonce)||base.nonce<0)fail('SKILL_ADMIN_NONCE_INVALID');
    await clients[1].call({...base,blockNumber:anchor.number});
    const[estimate,networkPrice,balance]=await Promise.all([clients[1].estimateGas({...base,blockTag:'latest'}),
      clients[1].getGasPrice(),clients[1].getBalance({address:owner,blockTag:'latest'})]);
    if(typeof estimate!=='bigint'||estimate<=0n||estimate>100000n||typeof networkPrice!=='bigint'||networkPrice<=0n)fail('SKILL_ADMIN_CANCELLATION_FEE_UNAVAILABLE');
    const original=BigInt(row.preparation.transaction.gasPrice),previous=BigInt(previousGasPrice),known=original>previous?original:previous;
    const bumped=known*9n/8n+1n,market=networkPrice*9n/8n+1n,price=bumped>market?bumped:market,gas=(estimate*6n+4n)/5n;
    if(gas*price>100000000000000n||balance<gas*price)fail('SKILL_ADMIN_CANCELLATION_FEE_CEILING');
    for(const client of clients){
      if(await client.getChainId()!==4663||BigInt(await client.getTransactionCount({address:owner,blockTag:'latest'}))!==nonce
        ||(await client.getBlock({blockNumber:anchor.number})).hash!==anchor.hash)fail('SKILL_ADMIN_CANCELLATION_CHANGED');
    }
    const hex=n=>`0x${BigInt(n).toString(16)}`;
    return{schema:'GOGH_SKILL_ADMIN_NONCE_CANCELLATION_V1',parentId:row.id,administrator:owner,chainId:4663,
      registry:row.registry,originalNonce:hex(nonce),replacementBaseGasPrice:hex(known),expiresAt:now()+60000,maximumNetworkFeeWei:String(gas*price),
      transaction:{from:owner,to:owner,value:'0x0',data:'0x',chainId:'0x1237',nonce:hex(nonce),gas:hex(gas),gasPrice:hex(price)},
      accountCode:observations[0].accountCode,anchor:{number:String(anchor.number),hash:anchor.hash,timestamp:String(anchor.timestamp)},
      walletConfirmationRequired:true,registryActionRepeated:false,assetValueWei:'0',
      warning:'This uses the reserved transaction nonce with a zero-value self transaction. It costs a network fee. The original registry step may win the race; only a confirmed receipt determines the outcome.'};
  }});
}
