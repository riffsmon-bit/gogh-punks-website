import { manifestHash } from './capability-resolver.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const fail = code => { throw Error(code); };
export function createSkillAdminCoordinator({ review, store, clients, now = Date.now }) {
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
  async function checkTransaction(client,row) {
    const expected = row.preparation.transaction;
      if (await client.getChainId() !== 4663) fail('SKILL_ADMIN_CHAIN_CHANGED');
      const tx = await client.getTransaction({ hash: row.transactionHash });
      if (!tx || tx.hash.toLowerCase() !== row.transactionHash || tx.from.toLowerCase() !== row.administrator
        || tx.to?.toLowerCase() !== expected.to.toLowerCase() || tx.input !== expected.data || tx.value !== 0n
        || tx.chainId !== 4663 || BigInt(tx.nonce) !== BigInt(expected.nonce)
        || typeof tx.gas !== 'bigint' || typeof tx.gasPrice !== 'bigint'
        || tx.gas > BigInt(expected.gas) || tx.gasPrice > BigInt(expected.gasPrice)) fail('SKILL_ADMIN_TRANSACTION_MISMATCH');
      return tx;
  }
  async function checkReceipt(row) {
    const expected = row.preparation.transaction;
    const proofs = await Promise.all(clients.map(async client => {
      const tx = await checkTransaction(client,row);
      let receipt;
      try { receipt = await client.getTransactionReceipt({ hash: row.transactionHash }); }
      catch (error) { if (error?.name === 'TransactionReceiptNotFoundError') return null; throw error; }
      if (!receipt) return null;
      if (receipt.transactionHash.toLowerCase() !== row.transactionHash || receipt.from.toLowerCase() !== row.administrator
        || receipt.to?.toLowerCase() !== expected.to.toLowerCase() || tx.blockHash !== receipt.blockHash
        || tx.blockNumber !== receipt.blockNumber || !['success','reverted'].includes(receipt.status)) fail('SKILL_ADMIN_RECEIPT_MISMATCH');
      const [block, latest] = await Promise.all([client.getBlock({ blockNumber: receipt.blockNumber }), client.getBlockNumber()]);
      if (block.hash !== receipt.blockHash) fail('SKILL_ADMIN_RECEIPT_REORG');
      if (latest < receipt.blockNumber + 11n) return null;
      if (await client.getChainId() !== 4663 || (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== block.hash) fail('SKILL_ADMIN_RECEIPT_REORG');
      return { transactionHash: row.transactionHash, blockHash: block.hash, blockNumber: String(receipt.blockNumber),
        status: receipt.status, minimumConfirmations: 12 };
    }));
    if (proofs.some(proof => !proof)) return null;
    if (manifestHash(proofs[0]) !== manifestHash(proofs[1])) fail('SKILL_ADMIN_PROVIDERS_DISAGREE');
    return proofs[0];
  }
  return Object.freeze({
    async get({ administrator, id }) {
      const snapshot = await authority(administrator);
      return { snapshot, record: id ? await record(administrator,id) : await store.get(administrator) };
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
    async recover({ administrator,id,transactionHash }) {
      await authority(administrator); let row = await record(administrator,id);
      if (transactionHash !== undefined && !HASH.test(transactionHash)) fail('SKILL_ADMIN_HASH_INVALID');
      transactionHash = transactionHash?.toLowerCase() ?? row.transactionHash;
      if (!transactionHash) return { record:row };
      if (row.transactionHash && row.transactionHash !== transactionHash) fail('SKILL_ADMIN_HASH_IMMUTABLE');
      if (row.status === 'WALLET_REQUESTED') {
        // A pasted unrelated or unavailable hash must not poison immutable recovery.
        await Promise.all(clients.map(client=>checkTransaction(client,{...row,transactionHash})));
        row = await store.update(administrator,id,row.revision,['WALLET_REQUESTED'],'SUBMITTED',{transactionHash});
      }
      if (!['SUBMITTED','CONFIRMED','REVERTED'].includes(row.status)) fail('SKILL_ADMIN_RECOVERY_REQUIRED');
      const proof = await checkReceipt(row);
      if (!proof) return { record:row };
      const current = await authority(administrator), skill = current.skills.find(item=>item.key===row.key);
      if (!skill || skill.manifestHash !== row.preparation.manifestHash || skill.instructionHash !== row.preparation.instructionHash) fail('SKILL_ADMIN_REGISTRY_DIVERGED');
      if (proof.status === 'success') {
        const minimumStatus = {REGISTER:0,MARK_TESTING:3,MARK_READY:4}[row.action];
        if (skill.registeredStatus < minimumStatus || skill.registeredStatus === null
          || row.action === 'MARK_READY' && (skill.registeredStatus !== 4 || !skill.available
            || skill.existingReviewEvidenceHash !== row.preparation.reviewEvidenceHash)) fail('SKILL_ADMIN_REGISTRY_DIVERGED');
      }
      const status = proof.status === 'success' ? 'CONFIRMED' : 'REVERTED';
      if (['CONFIRMED','REVERTED'].includes(row.status)) {
        if (row.status !== status || manifestHash(row.receipt) !== manifestHash(proof)) fail('SKILL_ADMIN_RECEIPT_REORG');
        return { record:row };
      }
      return { record:await store.update(administrator,id,row.revision,['SUBMITTED'],status,{receipt:proof}) };
    },
  });
}
