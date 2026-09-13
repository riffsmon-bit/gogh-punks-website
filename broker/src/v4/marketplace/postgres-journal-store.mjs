import { marketplaceAssert, marketplaceScope, marketplaceCas, marketplaceDigest,
  serializeMarketplaceJournal, MARKETPLACE_JOURNAL_STATUSES } from './durable-journal.mjs';

export function createMarketplaceStore(pool) {
  function decode(row) {
    if (!row) return null;
    const record = JSON.parse(row.review_json);
    marketplaceAssert(serializeMarketplaceJournal(record) === row.review_json && marketplaceDigest(row.review_json) === row.review_hash
      && record.intentId === row.intent_id && record.review.owner === row.owner_address && record.review.punkId === row.punk_id
      && row.chain_id === 4663 && Number(row.expires_at_ms) === record.review.expiresAt
      && MARKETPLACE_JOURNAL_STATUSES.includes(row.status) && Number.isSafeInteger(row.revision) && row.revision >= 0
      && (['COMPLETED', 'REVERTED'].includes(row.status) === (row.receipt !== null))
      && (!row.reported_hash || /^0x[0-9a-f]{64}$/.test(row.reported_hash))
      && (!['PREPARED', 'CANCELLED'].includes(row.status) || row.reported_hash === null)
      && (!row.receipt || (row.receipt.transactionHash === row.reported_hash && row.receipt.status === row.status)), 'MARKETPLACE_JOURNAL_CORRUPT');
    return { record, reviewHash: row.review_hash, revision: row.revision, status: row.status,
      reportedHash: row.reported_hash, receipt: row.receipt, reason: row.reason };
  }
  async function get(scope) {
    const { owner, punkId, chainId } = marketplaceScope(scope);
    marketplaceAssert(typeof scope.intentId === 'string' && /^[0-9a-f]{64}$/.test(scope.intentId), 'MARKETPLACE_INVALID_INTENT');
    return decode((await pool.query(`SELECT * FROM public.broker_marketplace_reviews
      WHERE intent_id=$1 AND owner_address=$2 AND punk_id=$3 AND chain_id=$4`, [scope.intentId, owner, punkId, chainId])).rows[0]);
  }
  async function current(scope) {
    const { owner, punkId, chainId } = marketplaceScope(scope);
    return decode((await pool.query(`SELECT * FROM public.broker_marketplace_reviews
      WHERE owner_address=$1 AND punk_id=$2 AND chain_id=$3
      ORDER BY (status IN ('PREPARED','WALLET_REQUESTED')) DESC,created_at DESC,intent_id DESC LIMIT 1`, [owner, punkId, chainId])).rows[0]);
  }
  async function save(record) {
    const serialized = serializeMarketplaceJournal(record), review = record.review;
    try {
      const row = (await pool.query(`INSERT INTO public.broker_marketplace_reviews
        (intent_id,owner_address,punk_id,chain_id,expires_at_ms,review_json,review_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(intent_id) DO NOTHING RETURNING *`,
      [record.intentId, review.owner, review.punkId, review.chainId, review.expiresAt, serialized, marketplaceDigest(serialized)])).rows[0];
      // A concurrent preparer may have won with a different anchor. Keep its exact bytes.
      return row ? decode(row) : get({ ...review, intentId: record.intentId });
    } catch (error) {
      if (error.code === '23505') throw Error('MARKETPLACE_UNRESOLVED_PURCHASE');
      throw error;
    }
  }
  async function update(scope, { status, reportedHash = null, receipt = null, reason = null }) {
    const s = marketplaceCas(scope);
    marketplaceAssert(MARKETPLACE_JOURNAL_STATUSES.includes(status)
      && (reportedHash === null || /^0x[0-9a-f]{64}$/.test(reportedHash))
      && (reason === null || /^[A-Z][A-Z0-9_]{0,95}$/.test(reason)), 'MARKETPLACE_INVALID_TRANSITION');
    // PostgreSQL acknowledges the autocommitted CAS before any caller gets a wallet transaction.
    // A lost acknowledgement throws. A retry reads WALLET_REQUESTED and cannot claim twice.
    return decode((await pool.query(`UPDATE public.broker_marketplace_reviews
      SET revision=revision+1,status=$7,reported_hash=$8,receipt=$9,reason=$10
      WHERE intent_id=$1 AND owner_address=$2 AND punk_id=$3 AND chain_id=$4 AND revision=$5 AND review_hash=$6
      RETURNING *`, [s.intentId, s.owner, s.punkId, s.chainId, s.revision, s.reviewHash, status, reportedHash, receipt, reason])).rows[0]);
  }
  return Object.freeze({ get, current, save, update });
}

// Release wiring must run this on a dedicated request-role pool, never an owner/service credential.
export async function verifyMarketplaceDatabaseRole(pool) {
  const row = (await pool.query(`SELECT c.relrowsecurity AS rls,
    pg_has_role(current_user,c.relowner,'USAGE') AS owns, r.rolsuper AS superuser,r.rolbypassrls AS bypass,
    has_table_privilege(current_user,c.oid,'DELETE') AS deletes,
    has_table_privilege(current_user,c.oid,'TRUNCATE') AS truncates,
    has_schema_privilege(current_user,'public','CREATE') AS schema_writes,
    has_table_privilege(current_user,'public.broker_marketplace_events','INSERT,UPDATE,DELETE,TRUNCATE') AS audit_writes,
    has_table_privilege(current_user,c.oid,'SELECT') AS reads,
    has_table_privilege(current_user,c.oid,'INSERT') AS inserts,
    has_column_privilege(current_user,c.oid,'status','UPDATE') AS updates,
    has_column_privilege(current_user,c.oid,'review_json','UPDATE') AS rewrites
    FROM pg_class c JOIN pg_roles r ON r.rolname=current_user WHERE c.oid='public.broker_marketplace_reviews'::regclass`)).rows[0];
  marketplaceAssert(row?.rls === true && row.owns === false && row.superuser === false && row.bypass === false
    && row.deletes === false && row.truncates === false && row.schema_writes === false && row.audit_writes === false && row.rewrites === false
    && row.reads === true && row.inserts === true && row.updates === true, 'MARKETPLACE_DATABASE_ROLE_INVALID');
}
