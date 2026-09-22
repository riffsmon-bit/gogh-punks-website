import { manifestHash } from './capability-resolver.mjs';
import { createSkillAdminCancellationReview,verifySkillAdminSelfCallCode } from './skill-admin-cancellation.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const TERMINAL=['CONFIRMED','REVERTED','REPLACED'];
const fail = code => { throw Error(code); };
export function createSkillAdminCoordinator({ review, store, clients, now = Date.now,
  cancellationReview=createSkillAdminCancellationReview({clients,now}) }) {
  if (!Array.isArray(clients) || clients.length !== 2 || clients[0] === clients[1]) fail('SKILL_ADMIN_TWO_PROVIDERS_REQUIRED');
  async function authority(administrator) {
    if (typeof administrator !== 'string' || !/^0x[0-9a-f]{40}$/.test(administrator)) fail('SKILL_ADMIN_IDENTITY_INVALID');
    const snapshot = await review.inspect();
    if (snapshot.administrator.toLowerCase() !== administrator) fail('SKILL_ADMIN_NOT_ADMINISTRATOR');
    return snapshot;
  }
  async function record(administrator, id) {
    if (!UUID.test(id ?? '')) fail('SKILL_ADMIN_IDENTITY_INVALID');
    const row = await store.get(administrator,id);
    if (!row || row.administrator !== administrator || manifestHash(row.preparation) !== row.reviewHash) fail('SKILL_ADMIN_REVIEW_NOT_FOUND');
    return row;
  }
  async function cancellation(row,id) {
    if(id!==undefined&&!UUID.test(id??''))fail('SKILL_ADMIN_IDENTITY_INVALID');
    const saved=await store.getCancellation(row.administrator,row.id,id);
    if(saved&&(saved.administrator!==row.administrator||saved.parentId!==row.id||manifestHash(saved.preparation)!==saved.reviewHash))fail('SKILL_ADMIN_REVIEW_NOT_FOUND');
    return saved;
  }
  async function checkTransaction(client,row,hash) {
    const expected = row.preparation.transaction;
    if (await client.getChainId() !== 4663) fail('SKILL_ADMIN_CHAIN_CHANGED');
    const tx = await client.getTransaction({ hash });
    if (!tx || tx.hash?.toLowerCase() !== hash || tx.from?.toLowerCase() !== row.administrator
      || tx.chainId !== 4663 || BigInt(tx.nonce) !== BigInt(expected.nonce)
      || typeof tx.value!=='bigint'||tx.value<0n||typeof tx.input!=='string'||!/^0x(?:[0-9a-f]{2})*$/i.test(tx.input)
      || typeof tx.gas !== 'bigint' || typeof tx.gasPrice !== 'bigint' || tx.gas<=0n||tx.gasPrice<=0n) fail('SKILL_ADMIN_TRANSACTION_MISMATCH');
    // Fees may have been changed by the administrator's wallet. An exact original call is
    // always recognized as ORIGINAL, never disguised as a cancellation because fees differ.
    const kind=tx.to?.toLowerCase()===expected.to.toLowerCase()&&tx.input.toLowerCase()===expected.data.toLowerCase()&&tx.value===0n?'ORIGINAL':'REPLACEMENT';
    return{tx,kind};
  }
  async function checkReceipt(row,hash) {
    const proofs = await Promise.all(clients.map(async client => {
      const {tx,kind} = await checkTransaction(client,row,hash);
      let receipt;
      try { receipt = await client.getTransactionReceipt({ hash }); }
      catch (error) { if (error?.name === 'TransactionReceiptNotFoundError') return null; throw error; }
      if (!receipt) return null;
      if (receipt.transactionHash.toLowerCase() !== hash || receipt.from.toLowerCase() !== row.administrator
        || (receipt.to?.toLowerCase()??null)!==(tx.to?.toLowerCase()??null) || tx.blockHash !== receipt.blockHash
        || tx.blockNumber !== receipt.blockNumber || !['success','reverted'].includes(receipt.status)) fail('SKILL_ADMIN_RECEIPT_MISMATCH');
      const [block, latest] = await Promise.all([client.getBlock({ blockNumber: receipt.blockNumber }), client.getBlockNumber()]);
      if (block.hash !== receipt.blockHash) fail('SKILL_ADMIN_RECEIPT_REORG');
      if (latest < receipt.blockNumber + 11n) return null;
      let selfAccountCode;
      let assetMovement=kind==='ORIGINAL'||receipt.status==='reverted'?'NONE_EXCEPT_NETWORK_FEE':'OWNER_REPLACEMENT_REVIEW_WALLET_ACTIVITY';
      if(kind==='REPLACEMENT'&&tx.to?.toLowerCase()===row.administrator&&tx.value===0n&&tx.input==='0x'){
        const code=await client.getCode({address:row.administrator,blockNumber:receipt.blockNumber});
        selfAccountCode=await verifySkillAdminSelfCallCode(client,code,receipt.blockNumber);assetMovement='NONE_EXCEPT_NETWORK_FEE';
      }
      if (await client.getChainId() !== 4663 || (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== block.hash) fail('SKILL_ADMIN_RECEIPT_REORG');
      return { transactionHash: hash, blockHash: block.hash, blockNumber: String(receipt.blockNumber),
        status: receipt.status, minimumConfirmations: 12,kind,valueWei:String(tx.value),assetMovement,
        ...(selfAccountCode?{selfAccountCode}:{}),
        registryActionConfirmed:kind==='ORIGINAL'&&receipt.status==='success',
        gasLimit:String(tx.gas),gasPriceWei:String(tx.gasPrice),
        feeWithinOriginalReview:tx.gas<=BigInt(row.preparation.transaction.gas)&&tx.gasPrice<=BigInt(row.preparation.transaction.gasPrice) };
    }));
    if (proofs.some(proof => !proof)) return null;
    if (manifestHash(proofs[0]) !== manifestHash(proofs[1])) fail('SKILL_ADMIN_PROVIDERS_DISAGREE');
    return proofs[0];
  }
  return Object.freeze({
    async get({ administrator, id }) {
      const snapshot = await authority(administrator),row=id?await record(administrator,id):await store.get(administrator);
      return { snapshot, record:row,cancellation:row&&!TERMINAL.includes(row.status)&&row.status!=='CANCELLED'?await cancellation(row):null };
    },
    async prepare({ administrator, key, requestKey }) {
      await authority(administrator);
      if (!HASH.test(key ?? '') || !UUID.test(requestKey ?? '')) fail('SKILL_ADMIN_IDENTITY_INVALID');
      const active = await store.get(administrator);
      if (active) return { record: active };
      const preparation = await review.prepareNext({ key, administrator });
      return { record: await store.prepare(administrator,requestKey,preparation,manifestHash(preparation)) };
    },
    async claim({ administrator, id, revision, reviewHash }) {
      await authority(administrator); const row = await record(administrator,id);
      if (row.status !== 'PREPARED' || row.revision !== revision || row.reviewHash !== reviewHash) fail('SKILL_ADMIN_REVIEW_CONFLICT');
      if (now() >= row.preparation.expiresAt) fail('SKILL_ADMIN_REVIEW_EXPIRED');
      const fresh = await review.prepareNext({ key:row.key, administrator });
      // Older saved reviews predate these fields. New reviews also bind the
      // exact observed capability pause so a changed mask requires a new review.
      if (Object.hasOwn(row.preparation, 'disabledCapabilities')
        && (fresh.disabledCapabilities !== row.preparation.disabledCapabilities
          || fresh.capabilityPaused !== row.preparation.capabilityPaused)) fail('SKILL_ADMIN_REVIEW_CHANGED');
      for (const field of ['from','to','data','value','chainId','nonce']) {
        if (fresh.transaction[field] !== row.preparation.transaction[field]) fail('SKILL_ADMIN_REVIEW_CHANGED');
      }
      if (BigInt(fresh.maximumNetworkFeeWei) > BigInt(row.preparation.maximumNetworkFeeWei)) fail('SKILL_ADMIN_FEE_CHANGED');
      const claimed = await store.update(administrator,id,revision,['PREPARED'],'WALLET_REQUESTED');
      return { record:claimed,transaction:structuredClone(row.preparation.transaction) };
    },
    async cancel({ administrator,id,revision }) {
      await authority(administrator); const row = await record(administrator,id);
      if (row.status !== 'PREPARED' || row.revision !== revision) fail('SKILL_ADMIN_RECOVERY_REQUIRED');
      return { record:await store.update(administrator,id,revision,['PREPARED'],'CANCELLED') };
    },
    async prepareCancellation({administrator,id,requestKey}){
      await authority(administrator);const row=await record(administrator,id);
      if(!UUID.test(requestKey??''))fail('SKILL_ADMIN_IDENTITY_INVALID');
      const prior=await cancellation(row);
      if(prior?.requestKey===requestKey)return{record:row,cancellation:prior};
      const preparation=await cancellationReview.prepare({row,previousGasPrice:prior?.preparation.transaction.gasPrice??'0x0'});
      return{record:row,cancellation:await store.prepareCancellation(administrator,id,requestKey,preparation,manifestHash(preparation))};
    },
    async claimCancellation({administrator,id,cancellationId,revision,reviewHash}){
      await authority(administrator);const row=await record(administrator,id),saved=await cancellation(row,cancellationId);
      if(!saved||saved.status!=='PREPARED'||saved.revision!==revision||saved.reviewHash!==reviewHash)fail('SKILL_ADMIN_REVIEW_CONFLICT');
      if(now()>=saved.preparation.expiresAt)fail('SKILL_ADMIN_REVIEW_EXPIRED');
      const fresh=await cancellationReview.prepare({row,previousGasPrice:saved.preparation.replacementBaseGasPrice});
      for(const field of ['from','to','data','value','chainId','nonce'])if(fresh.transaction[field]!==saved.preparation.transaction[field])fail('SKILL_ADMIN_REVIEW_CHANGED');
      if(fresh.accountCode!==saved.preparation.accountCode||BigInt(fresh.maximumNetworkFeeWei)>BigInt(saved.preparation.maximumNetworkFeeWei))fail('SKILL_ADMIN_FEE_CHANGED');
      return{record:row,cancellation:await store.claimCancellation(administrator,id,saved.id,revision),transaction:structuredClone(saved.preparation.transaction)};
    },
    async recover({ administrator,id,transactionHash }) {
      await authority(administrator); let row = await record(administrator,id);
      if (transactionHash !== undefined && !HASH.test(transactionHash)) fail('SKILL_ADMIN_HASH_INVALID');
      transactionHash = transactionHash?.toLowerCase() ?? row.recoveryHash ?? row.transactionHash;
      if (!transactionHash) return { record:row };
      if (!['WALLET_REQUESTED','SUBMITTED',...TERMINAL].includes(row.status)) fail('SKILL_ADMIN_RECOVERY_REQUIRED');
      const observations=await Promise.all(clients.map(client=>checkTransaction(client,row,transactionHash)));
      const identity=({tx,kind})=>({kind,to:tx.to?.toLowerCase()??null,input:tx.input,value:String(tx.value),gas:String(tx.gas),gasPrice:String(tx.gasPrice)});
      if(manifestHash(identity(observations[0]))!==manifestHash(identity(observations[1])))fail('SKILL_ADMIN_PROVIDERS_DISAGREE');
      const kind=observations[0].kind;
      if(!TERMINAL.includes(row.status)){
        if(kind==='ORIGINAL'&&row.transactionHash&&row.transactionHash!==transactionHash){
          // An administrator may speed up the exact same call. Original immutable hash is
          // retained; only canonical proof below may resolve this replacement as ORIGINAL.
        }else if(kind==='ORIGINAL'&&row.status==='WALLET_REQUESTED'){
          row=await store.update(administrator,id,row.revision,['WALLET_REQUESTED'],'SUBMITTED',{transactionHash,recoveryHash:transactionHash});
        }
        if(row.recoveryHash!==transactionHash)row=await store.update(administrator,id,row.revision,[row.status],row.status,{recoveryHash:transactionHash});
      }
      const proof = await checkReceipt(row,transactionHash);
      if (!proof) return { record:row };
      const current=await authority(administrator);
      if(proof.kind==='ORIGINAL'){
        const skill=current.skills.find(item=>item.key===row.key);
        if (!skill || skill.manifestHash !== row.preparation.manifestHash || skill.instructionHash !== row.preparation.instructionHash) fail('SKILL_ADMIN_REGISTRY_DIVERGED');
        if (proof.status === 'success') {
          const minimumStatus = {REGISTER:0,MARK_TESTING:3,MARK_READY:4}[row.action];
          // A later pause, disable or deprecation can remove availability while
          // the exact confirmed READY attestation remains intact. Settlement
          // records that historical action; prepareNext still blocks new claims.
          if (skill.registeredStatus < minimumStatus || skill.registeredStatus === null
            || row.action === 'MARK_READY' && (skill.registeredStatus !== 4
              || skill.existingReviewEvidenceHash !== row.preparation.reviewEvidenceHash)) fail('SKILL_ADMIN_REGISTRY_DIVERGED');
        }
      }
      const status=proof.kind==='REPLACEMENT'?'REPLACED':proof.status==='success'?'CONFIRMED':'REVERTED';
      if(TERMINAL.includes(row.status)){
        if(row.status!==status||manifestHash(row.receipt)!==manifestHash(proof))fail('SKILL_ADMIN_RECEIPT_REORG');
        return{record:row};
      }
      return { record:await store.update(administrator,id,row.revision,[row.status],status,{receipt:proof,recoveryHash:transactionHash}) };
    },
  });
}
