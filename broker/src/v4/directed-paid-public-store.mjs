import {paidDigest} from './directed-paid-store.mjs';
import {paidAssert as check,paidJson} from './directed-paid-mint.mjs';
import {publicPaidIdentity} from './directed-paid-public.mjs';
// Every statement runs in a transaction with request-owner RLS context. The
// signing session, not browser parameters, supplies this identity.
export function createPublicPaidStore(pool,identity){
 publicPaidIdentity(identity.owner,identity.tokenId);
 async function query(sql,values=[]){const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('gogh.public_paid_owner',$1,true)",[identity.owner]);const result=await c.query(sql,values);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 function decode(row){if(!row)return null;const review=JSON.parse(row.review_json);check(review.owner===identity.owner&&review.tokenId===identity.tokenId&&review.intentId===row.intent_id&&paidDigest(review)===row.review_hash,'PAID_JOURNAL_CHANGED');return {review,reviewHash:row.review_hash,revision:row.revision,status:row.status,reportedHash:row.reported_hash,receipt:row.receipt};}
 const scope=[identity.owner,identity.tokenId];
 const get=async intentId=>{check(/^[0-9a-f]{64}$/.test(intentId),'PAID_JOURNAL_CHANGED');return decode((await query('SELECT * FROM broker_public_paid_reviews WHERE owner=$1 AND token_id=$2 AND intent_id=$3',[...scope,intentId])).rows[0]);};
 const current=async()=>decode((await query('SELECT * FROM broker_public_paid_reviews WHERE owner=$1 AND token_id=$2 ORDER BY created_at DESC,intent_id DESC LIMIT 1',scope)).rows[0]);
 const save=async review=>{check(review.owner===identity.owner&&review.tokenId===identity.tokenId,'PAID_JOURNAL_CHANGED');return decode((await query('INSERT INTO broker_public_paid_reviews(owner,token_id,intent_id,review_json,review_hash) VALUES($1,$2,$3,$4,$5) RETURNING *',[...scope,review.intentId,paidJson(review),paidDigest(review)])).rows[0]);};
 async function update(intentId,revision,status,hash,receipt=null){check(/^[0-9a-f]{64}$/.test(intentId)&&Number.isSafeInteger(revision),'PAID_JOURNAL_CHANGED');const row=(await query('UPDATE broker_public_paid_reviews SET revision=revision+1,status=$5,reported_hash=$6,receipt=$7 WHERE owner=$1 AND token_id=$2 AND intent_id=$3 AND revision=$4 RETURNING *',[...scope,intentId,revision,status,hash,receipt])).rows[0];check(row,'PAID_JOURNAL_CHANGED');return decode(row);}
 const history=async()=>(await query("SELECT * FROM broker_public_paid_reviews WHERE owner=$1 AND token_id=$2 AND status IN('CONFIRMED','REVERTED') ORDER BY created_at DESC LIMIT 25",scope)).rows.map(decode);
 const pendingPunk=async()=>(await query("SELECT token_id FROM broker_public_paid_reviews WHERE owner=$1 AND status IN('PREPARED','WALLET_REQUESTED') LIMIT 1",[identity.owner])).rows[0]?.token_id??null;
 return {get,current,save,update,history,pendingPunk};
}
