import { burnReviewDigest } from './selected-burn-store.mjs';

const valid = v => { if (!v) throw Error('HOLDER_JOURNAL_CHANGED'); };
const hash = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
export function createHolderBurnStore(pool, selection) {
  const { owner, sourceTokenId, targetTokenId } = selection;
  const decode = row => {
    if (!row) return null;
    const review = JSON.parse(row.review_json);
    valid(review.intentId === row.intent_id && review.state.owner === owner && review.state.sourceTokenId === sourceTokenId
      && review.state.targetTokenId === targetTokenId && burnReviewDigest(review) === row.review_hash);
    return { review, reviewHash: row.review_hash, revision: row.revision, status: row.status,
      reportedHash: row.reported_hash, receipt: row.receipt };
  };
  const get = async id => {
    valid(hash(id));
    return decode((await pool.query(`SELECT * FROM broker_holder_burn_reviews WHERE intent_id=$1
      AND owner_address=$2 AND source_token_id=$3 AND target_token_id=$4`, [id, owner, sourceTokenId, targetTokenId])).rows[0]);
  };
  const current = async () => decode((await pool.query(`SELECT * FROM broker_holder_burn_reviews
    WHERE owner_address=$1 AND source_token_id=$2 AND target_token_id=$3
    ORDER BY (status IN ('PREPARED','WALLET_REQUESTED')) DESC,created_at DESC,intent_id DESC LIMIT 1`,
  [owner, sourceTokenId, targetTokenId])).rows[0]);
  const save = async review => {
    valid(hash(review.intentId) && review.state.owner === owner && review.state.sourceTokenId === sourceTokenId
      && review.state.targetTokenId === targetTokenId);
    return decode((await pool.query(`INSERT INTO broker_holder_burn_reviews
      (intent_id,owner_address,source_token_id,target_token_id,review_json,review_hash)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [review.intentId, owner, sourceTokenId, targetTokenId, JSON.stringify(review), burnReviewDigest(review)])).rows[0]);
  };
  const update = async (id, revision, status, reportedHash, receipt = null) => {
    valid(hash(id) && Number.isSafeInteger(revision) && revision >= 0
      && ['CANCELLED', 'WALLET_REQUESTED', 'CONFIRMED', 'REVERTED'].includes(status)
      && (reportedHash === null || /^0x[0-9a-f]{64}$/.test(reportedHash)));
    const rows = (await pool.query(`UPDATE broker_holder_burn_reviews SET revision=revision+1,status=$5,reported_hash=$6,receipt=$7
      WHERE intent_id=$1 AND owner_address=$2 AND source_token_id=$3 AND target_token_id=$4 AND revision=$8 RETURNING *`,
    [id, owner, sourceTokenId, targetTokenId, status, reportedHash, receipt, revision])).rows;
    valid(rows.length === 1); return decode(rows[0]);
  };
  return { get, current, save, update, reviewStore: { get: async id => (await get(id))?.review, set: async (_id, review) => save(review) } };
}

export function createHolderHistoryStore(pool) {
  const decode = row => row ? { identity: row.identity, cursor: String(row.cursor_block), anchorHash: row.anchor_hash,
    assets: row.assets, revision: row.revision, generation: row.generation } : null;
  return {
    load: async key => { valid(hash(key)); return decode((await pool.query('SELECT * FROM broker_holder_asset_history WHERE history_key=$1', [key])).rows[0]); },
    create: async value => {
      valid(hash(value.identity.key));
      await pool.query(`INSERT INTO broker_holder_asset_history(history_key,identity) VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [value.identity.key, value.identity]);
      return decode((await pool.query('SELECT * FROM broker_holder_asset_history WHERE history_key=$1', [value.identity.key])).rows[0]);
    },
    advance: async (key, revision, value) => {
      valid(hash(key) && Number.isSafeInteger(revision) && revision >= 0);
      const rows = (await pool.query(`UPDATE broker_holder_asset_history SET cursor_block=$3,anchor_hash=$4,assets=$5,
        revision=revision+1,updated_at=clock_timestamp() WHERE history_key=$1 AND revision=$2 RETURNING *`,
      [key, revision, value.cursor, value.anchorHash, JSON.stringify(value.assets)])).rows;
      valid(rows.length === 1); return decode(rows[0]);
    },
    reset: async (key, revision, proof) => {
      valid(hash(key) && Number.isSafeInteger(revision) && revision >= 0);
      const rows = (await pool.query(`UPDATE broker_holder_asset_history SET cursor_block=-1,anchor_hash=NULL,assets='[]'::jsonb,
        revision=revision+1,generation=generation+1,reorg_proof=$3,updated_at=clock_timestamp()
        WHERE history_key=$1 AND revision=$2 RETURNING *`, [key, revision, proof])).rows;
      valid(rows.length === 1); return decode(rows[0]);
    },
  };
}
