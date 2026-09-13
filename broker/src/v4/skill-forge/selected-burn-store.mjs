import { createHash } from 'node:crypto';

export const burnReviewDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const valid = value => { if (!value) throw Error('BURN_JOURNAL_CHANGED'); };
const hash = value => typeof value==='string' && /^[0-9a-f]{64}$/.test(value);
export function createSelectedBurnStore(pool, owner, sourceTokenId) {
  valid(/^0x[0-9a-f]{40}$/.test(owner) && /^[0-9]{1,4}$/.test(sourceTokenId));
  function decode(row) {
    if (!row) return null;
    const review=JSON.parse(row.review_json);
    valid(review.intentId===row.intent_id && review.state.owner.toLowerCase()===owner
      && review.state.sourceTokenId===sourceTokenId && burnReviewDigest(review)===row.review_hash);
    return {review,reviewHash:row.review_hash,revision:row.revision,status:row.status,
      reportedHash:row.reported_hash,receipt:row.receipt};
  }
  async function get(intentId) {
    valid(hash(intentId));
    return decode((await pool.query(`SELECT * FROM broker_selected_burn_reviews
      WHERE intent_id=$1 AND owner_address=$2 AND source_token_id=$3`,[intentId,owner,sourceTokenId])).rows[0]);
  }
  async function current() {
    return decode((await pool.query(`SELECT * FROM broker_selected_burn_reviews
      WHERE owner_address=$1 AND source_token_id=$2 ORDER BY created_at DESC,intent_id DESC LIMIT 1`,[owner,sourceTokenId])).rows[0]);
  }
  async function save(review) {
    valid(hash(review.intentId) && review.state.owner.toLowerCase()===owner && review.state.sourceTokenId===sourceTokenId);
    return decode((await pool.query(`INSERT INTO broker_selected_burn_reviews
      (intent_id,owner_address,source_token_id,review_json,review_hash) VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [review.intentId,owner,sourceTokenId,JSON.stringify(review),burnReviewDigest(review)])).rows[0]);
  }
  async function update(intentId,revision,status,reportedHash,receipt=null) {
    valid(hash(intentId) && Number.isSafeInteger(revision) && revision>=0
      && ['CANCELLED','DECLINED','WALLET_REQUESTED','CONFIRMED','REVERTED'].includes(status)
      && (reportedHash===null || /^0x[0-9a-f]{64}$/.test(reportedHash)));
    const result=await pool.query(`UPDATE broker_selected_burn_reviews SET revision=revision+1,status=$4,reported_hash=$5,receipt=$6
      WHERE intent_id=$1 AND owner_address=$2 AND source_token_id=$3 AND revision=$7 RETURNING *`,
    [intentId,owner,sourceTokenId,status,reportedHash,receipt,revision]);
    valid(result.rows.length===1);return decode(result.rows[0]);
  }
  return {get,current,save,update,reviewStore:{get:async id=>(await get(id))?.review,set:async(_id,review)=>save(review)}};
}
