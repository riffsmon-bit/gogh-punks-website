import { watchFail } from './persistent-domain.mjs';

const stale = () => watchFail('WATCH_VERSION_CHANGED', 'Your Punk settings changed. Refresh and review again.');
const iso = value => value ? new Date(value).toISOString() : null;
export const persistentWatchView = row => !row ? null : ({ tokenId: row.token_id, owner: row.owner_snapshot,
  version: Number(row.version), state: row.state, config: row.config,
  anchor: { tokenId: row.token_id, owner: row.owner_snapshot, blockNumber: String(row.checkpoint_block), blockHash: row.checkpoint_hash },
  activatedAt: iso(row.activated_at), updatedAt: iso(row.updated_at), lastCheckedAt: iso(row.last_checked_at) });

export function createPersistentWatchStore(pool) {
  const transaction = async run => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await run(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  };
  const get = async tokenId => persistentWatchView((await pool.query(
    'SELECT * FROM broker_v2_persistent_watches WHERE token_id=$1', [tokenId])).rows[0]);
  return {
    get,
    async saveDraft(draft) {
      await pool.query(`INSERT INTO broker_v2_persistent_watch_drafts
        (draft_id,token_id,owner_address,expected_version,config,anchor,expires_at)
        VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
        ON CONFLICT(token_id,owner_address) DO UPDATE SET draft_id=EXCLUDED.draft_id,
          expected_version=EXCLUDED.expected_version,config=EXCLUDED.config,anchor=EXCLUDED.anchor,
          expires_at=EXCLUDED.expires_at,used_at=NULL`, [draft.draftId, draft.tokenId, draft.owner,
        draft.expectedVersion, JSON.stringify(draft.config), JSON.stringify(draft.anchor), draft.expiresAt]);
    },
    async getDraft(id, tokenId, owner) {
      const row = (await pool.query(`SELECT * FROM broker_v2_persistent_watch_drafts
        WHERE draft_id=$1 AND token_id=$2 AND owner_address=$3`, [id, tokenId, owner])).rows[0];
      return !row ? null : { draftId: row.draft_id, tokenId, owner, expectedVersion: row.expected_version,
        config: row.config, anchor: row.anchor, expiresAt: iso(row.expires_at), used: row.used_at !== null };
    },
    async confirmDraft(draft, anchor) {
      return transaction(async client => {
        const saved = (await client.query(`SELECT used_at FROM broker_v2_persistent_watch_drafts
          WHERE draft_id=$1 AND owner_address=$2 AND token_id=$3 AND expires_at>now() FOR UPDATE`,
        [draft.draftId, draft.owner, draft.tokenId])).rows[0];
        if (!saved) watchFail('WATCH_DRAFT_EXPIRED', 'This review expired. Review your settings again.');
        if (saved.used_at) return { applied: false, watch: persistentWatchView((await client.query(
          'SELECT * FROM broker_v2_persistent_watches WHERE token_id=$1', [draft.tokenId])).rows[0]) };
        const changed = await client.query(`INSERT INTO broker_v2_persistent_watches
          (token_id,owner_snapshot,version,state,config,checkpoint_block,checkpoint_hash)
          SELECT $1,$2,1,'ACTIVE',$3::jsonb,$4::numeric,$5 WHERE $6=0
          ON CONFLICT(token_id) DO NOTHING RETURNING *`, [draft.tokenId, draft.owner,
          JSON.stringify(draft.config), anchor.blockNumber, anchor.blockHash, draft.expectedVersion]);
        let row = changed.rows[0];
        if (!row) row = (await client.query(`UPDATE broker_v2_persistent_watches SET owner_snapshot=$2,
          version=version+1,state='ACTIVE',config=$3::jsonb,checkpoint_block=$4::numeric,checkpoint_hash=$5,
          activated_at=now(),updated_at=now(),last_checked_at=NULL WHERE token_id=$1 AND version=$6 RETURNING *`,
        [draft.tokenId, draft.owner, JSON.stringify(draft.config), anchor.blockNumber, anchor.blockHash, draft.expectedVersion])).rows[0];
        if (!row) stale();
        await client.query('UPDATE broker_v2_persistent_watch_drafts SET used_at=now() WHERE draft_id=$1', [draft.draftId]);
        return { applied: true, watch: persistentWatchView(row) };
      });
    },
    async pause(tokenId, owner, version, state = 'PAUSED') {
      if (!['PAUSED', 'OWNER_ACTION_REQUIRED'].includes(state)) throw Error('WATCH_INVALID_PAUSE');
      const rows = await pool.query(`UPDATE broker_v2_persistent_watches SET state=$4,version=version+1,updated_at=now()
        WHERE token_id=$1 AND owner_snapshot=$2 AND version=$3 RETURNING *`, [tokenId, owner, version, state]);
      if (!rows.rows[0]) stale();
      return persistentWatchView(rows.rows[0]);
    },
    async checkpoint(watch, anchor) {
      const rows = await pool.query(`UPDATE broker_v2_persistent_watches SET checkpoint_block=$4::numeric,
        checkpoint_hash=$5,last_checked_at=now() WHERE token_id=$1 AND owner_snapshot=$2 AND version=$3
        AND checkpoint_block<=$4::numeric RETURNING *`, [watch.tokenId, watch.owner, watch.version, anchor.blockNumber, anchor.blockHash]);
      return persistentWatchView(rows.rows[0]);
    },
    async touch(watch) {
      await pool.query(`UPDATE broker_v2_persistent_watches SET last_checked_at=now()
        WHERE token_id=$1 AND version=$2`, [watch.tokenId, watch.version]);
    },
    async active(limit = 25) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw Error('WATCH_INVALID_BATCH');
      return (await pool.query(`SELECT * FROM broker_v2_persistent_watches WHERE state='ACTIVE'
        ORDER BY last_checked_at ASC NULLS FIRST,token_id LIMIT $1`, [limit])).rows.map(persistentWatchView);
    },
    async opportunities(ids = []) {
      return (await pool.query(`SELECT normalized FROM broker_v2_opportunities WHERE chain_id=4663
        AND (cardinality($1::text[])=0 OR opportunity_id=ANY($1::text[]))
        AND (expires_at IS NULL OR expires_at>now()) ORDER BY updated_at DESC LIMIT 25`, [ids])).rows.map(row => row.normalized);
    },
    async claim(watch, opportunityId, key, day) {
      return transaction(async client => {
        const live = (await client.query(`SELECT version FROM broker_v2_persistent_watches WHERE token_id=$1
          AND owner_snapshot=$2 AND version=$3 AND state='ACTIVE'
          AND (config->>'expiresAt' IS NULL OR (config->>'expiresAt')::timestamptz>now()) FOR UPDATE`, [watch.tokenId, watch.owner, watch.version])).rows[0];
        if (!live) return false;
        await client.query(`INSERT INTO broker_v2_persistent_watch_decisions
          (token_id,watch_version,observation_key,opportunity_id,utc_day,status)
          VALUES($1,$2,$3,$4,$5,'CLAIMED') ON CONFLICT DO NOTHING`, [watch.tokenId, watch.version, key, opportunityId, day]);
        return (await client.query(`SELECT status FROM broker_v2_persistent_watch_decisions
          WHERE token_id=$1 AND watch_version=$2 AND observation_key=$3`, [watch.tokenId, watch.version, key])).rows[0]?.status === 'CLAIMED';
      });
    },
    async finish(watch, key, result) {
      return transaction(async client => {
        const live = (await client.query(`SELECT version FROM broker_v2_persistent_watches WHERE token_id=$1
          AND owner_snapshot=$2 AND version=$3 AND state='ACTIVE'
          AND (config->>'expiresAt' IS NULL OR (config->>'expiresAt')::timestamptz>now()) FOR UPDATE`, [watch.tokenId, watch.owner, watch.version])).rows[0];
        const rows = await client.query(`UPDATE broker_v2_persistent_watch_decisions SET status=$4,result=$5::jsonb,completed_at=now()
          WHERE token_id=$1 AND watch_version=$2 AND observation_key=$3 AND status='CLAIMED' RETURNING observation_key`,
        [watch.tokenId, watch.version, key, live ? 'DONE' : 'CANCELLED', live ? JSON.stringify(result) : null]);
        return live && rows.rows.length === 1;
      });
    },
    async assertVersion({ tokenId, owner, watchVersion }) {
      const result = await pool.query(`SELECT version FROM broker_v2_persistent_watches WHERE token_id=$1
        AND owner_snapshot=$2 AND version=$3 AND state='ACTIVE'
        AND (config->>'expiresAt' IS NULL OR (config->>'expiresAt')::timestamptz>now())`, [tokenId, owner, watchVersion]);
      if (result.rows.length !== 1) stale();
      return true;
    },
    async history(tokenId) {
      const rows = await pool.query(`SELECT watch_version,status,result,created_at FROM broker_v2_persistent_watch_decisions
        WHERE token_id=$1 ORDER BY created_at DESC LIMIT 20`, [tokenId]);
      return rows.rows.map(row => ({ watchVersion: row.watch_version, status: row.status, result: row.result, createdAt: iso(row.created_at) }));
    },
    async summary(tokenId, day) {
      return (await pool.query(`SELECT COUNT(*) FILTER(WHERE status='DONE')::integer AS reviewed,
        COUNT(*) FILTER(WHERE result->>'matchesTaste'='true')::integer AS matched,
        COUNT(*) FILTER(WHERE result->>'matchesTaste'='false')::integer AS passed
        FROM broker_v2_persistent_watch_decisions WHERE token_id=$1 AND utc_day=$2`, [tokenId, day])).rows[0];
    },
  };
}

// Additional off-chain worker gate. It is never on-chain ownership or permission authority.
export async function assertPersistentWatchVersion({ pool, tokenId, owner, watchVersion }) {
  return createPersistentWatchStore(pool).assertVersion({ tokenId, owner, watchVersion });
}

// A filtered RLS result must never masquerade as an empty watch index.
export async function assertPersistentWatchStorageScope(pool) {
  const names = ['broker_v2_persistent_watches', 'broker_v2_persistent_watch_drafts', 'broker_v2_persistent_watch_decisions'];
  const result = await pool.query(`SELECT COUNT(*)::integer AS tables, bool_and(
    NOT row_security_active(name::regclass) AND has_table_privilege(current_user,name,'SELECT')
    AND has_table_privilege(current_user,name,'INSERT') AND has_table_privilege(current_user,name,'UPDATE')) AS complete
    FROM unnest($1::text[]) AS name`, [names]);
  if (result.rows.length !== 1 || result.rows[0].tables !== names.length || result.rows[0].complete !== true)
    watchFail('WATCH_STORAGE_UNAVAILABLE', 'Watching is temporarily unavailable. Saved taste and wallet permissions are unchanged.', 503);
  return true;
}
