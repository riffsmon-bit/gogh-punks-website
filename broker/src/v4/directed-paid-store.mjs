import {createHash} from 'node:crypto';
import {paidAssert,paidJson,PAID_OWNER} from './directed-paid-mint.mjs';
export const paidDigest=value=>createHash('sha256').update(paidJson(value)).digest('hex');
const id=value=>paidAssert(typeof value==='string'&&/^[0-9a-f]{64}$/.test(value),'PAID_JOURNAL_CHANGED');
export function createPaidStore(pool) {
 function decode(row){if(!row)return null;const review=JSON.parse(row.review_json);
  paidAssert(review.intentId===row.intent_id&&review.owner===PAID_OWNER&&review.tokenId==='93'&&paidDigest(review)===row.review_hash,'PAID_JOURNAL_CHANGED');
  return {review,reviewHash:row.review_hash,revision:row.revision,status:row.status,reportedHash:row.reported_hash,receipt:row.receipt};}
 const get=async intentId=>{id(intentId);return decode((await pool.query('SELECT * FROM broker_selected_paid_reviews WHERE intent_id=$1',[intentId])).rows[0]);};
 const current=async()=>decode((await pool.query('SELECT * FROM broker_selected_paid_reviews ORDER BY created_at DESC,intent_id DESC LIMIT 1')).rows[0]);
 const save=async review=>decode((await pool.query(`INSERT INTO broker_selected_paid_reviews(intent_id,review_json,review_hash) VALUES($1,$2,$3) RETURNING *`,
  [review.intentId,paidJson(review),paidDigest(review)])).rows[0]);
 async function update(intentId,revision,status,reportedHash,receipt=null,{worker=false}={}){
  id(intentId);paidAssert(Number.isSafeInteger(revision),'PAID_JOURNAL_CHANGED');
  const values=worker?[intentId,revision,status,receipt]:[intentId,revision,status,reportedHash,receipt];
  const row=(await pool.query(worker?`UPDATE broker_selected_paid_reviews SET revision=revision+1,status=$3,receipt=$4 WHERE intent_id=$1 AND revision=$2 RETURNING *`:
   `UPDATE broker_selected_paid_reviews SET revision=revision+1,status=$3,reported_hash=$4,receipt=$5 WHERE intent_id=$1 AND revision=$2 RETURNING *`,values)).rows[0];
  paidAssert(row,'PAID_JOURNAL_CHANGED');return decode(row);
 }
 const execution=async()=>{const row=(await pool.query(`SELECT intent_id,revision,status,transaction_hash,receipt,reason,created_at FROM broker_selected_paid_executions ORDER BY created_at DESC LIMIT 1`)).rows[0];return row??null;};
 return {get,current,save,update,execution,pool};
}
