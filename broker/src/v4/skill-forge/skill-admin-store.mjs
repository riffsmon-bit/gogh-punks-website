import { randomUUID } from 'node:crypto';
const TABLE = 'public.broker_forge_skill_admin_reviews';
export async function verifySkillAdminDatabaseRole(pool) {
  const { rows: [row] } = await pool.query(`SELECT current_user AS role, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
    r.rolreplication, r.rolbypassrls, c.relrowsecurity, c.relforcerowsecurity, c.relpersistence,
    pg_get_userbyid(c.relowner) AS table_owner,
    (has_table_privilege(current_user, '${TABLE}', 'SELECT') AND has_table_privilege(current_user, '${TABLE}', 'INSERT')
      AND has_column_privilege(current_user,'${TABLE}','status','UPDATE')
      AND has_column_privilege(current_user,'${TABLE}','revision','UPDATE')
      AND has_column_privilege(current_user,'${TABLE}','transaction_hash','UPDATE')
      AND has_column_privilege(current_user,'${TABLE}','receipt','UPDATE')) AS may_use,
    (has_table_privilege(current_user, '${TABLE}', 'UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')
      OR has_column_privilege(current_user,'${TABLE}','preparation','UPDATE')
      OR has_column_privilege(current_user,'${TABLE}','review_hash','UPDATE')) AS excessive,
    current_setting('synchronous_commit') AS durable,
    (SELECT count(*)::int FROM pg_class other JOIN pg_namespace ns ON ns.oid=other.relnamespace
      WHERE ns.nspname NOT IN ('pg_catalog','information_schema') AND ns.nspname NOT LIKE 'pg_toast%'
      AND other.relkind IN ('r','p') AND other.oid <> c.oid
      AND has_table_privilege(current_user,other.oid,'INSERT,UPDATE,DELETE,TRUNCATE')) AS other_writable,
    (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships
    FROM pg_roles r JOIN pg_class c ON c.oid='${TABLE}'::regclass WHERE r.rolname=current_user`);
  if (!row || row.role !== 'gogh_forge_skill_admin_request' || row.rolsuper || row.rolcreatedb || row.rolcreaterole
    || row.rolreplication || row.rolbypassrls || !row.relrowsecurity || !row.relforcerowsecurity
    || row.relpersistence !== 'p' || row.table_owner === row.role || !row.may_use || row.excessive
    || !['on','remote_apply'].includes(row.durable) || row.other_writable !== 0 || row.memberships !== 0) {
    throw Error('SKILL_ADMIN_DATABASE_ROLE_UNSAFE');
  }
}
const view = row => row ? { id: row.id, administrator: row.administrator, registry: row.registry,
  key: row.skill_key, action: row.action, requestKey: row.request_key, preparation: row.preparation,
  reviewHash: row.review_hash, status: row.status, revision: row.revision,
  transactionHash: row.transaction_hash, receipt: row.receipt } : null;
export function createSkillAdminStore({ pool, registry }) {
  registry = registry.toLowerCase();
  async function get(administrator, id) {
    const { rows } = await pool.query(`SELECT * FROM ${TABLE} WHERE administrator=$1 AND registry=$2
      ${id ? 'AND id=$3' : "AND status IN ('PREPARED','WALLET_REQUESTED','SUBMITTED')"}
      ORDER BY created_at DESC LIMIT 1`, id ? [administrator,registry,id] : [administrator,registry]);
    return view(rows[0]);
  }
  return Object.freeze({ get,
    async prepare(administrator, requestKey, preparation, reviewHash) {
      const conn = await pool.connect();
      try {
        await conn.query('BEGIN'); await conn.query("SET LOCAL synchronous_commit='on'");
        await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`skill-admin:${registry}:${administrator}`]);
        const prior = await conn.query(`SELECT * FROM ${TABLE} WHERE administrator=$1 AND registry=$2
          AND (request_key=$3 OR status IN ('PREPARED','WALLET_REQUESTED','SUBMITTED')) ORDER BY created_at DESC LIMIT 1`, [administrator,registry,requestKey]);
        if (prior.rows[0]) { await conn.query('COMMIT'); return view(prior.rows[0]); }
        const result = await conn.query(`INSERT INTO ${TABLE}(id,administrator,chain_id,registry,skill_key,action,
          request_key,preparation,review_hash,status) VALUES($1,$2,4663,$3,$4,$5,$6,$7,$8,'PREPARED') RETURNING *`,
        [randomUUID(),administrator,registry,preparation.key,preparation.action,requestKey,preparation,reviewHash]);
        await conn.query('COMMIT'); return view(result.rows[0]);
      } catch (error) { await conn.query('ROLLBACK').catch(() => {}); throw error; }
      finally { conn.release(); }
    },
    async update(administrator, id, revision, from, to, { transactionHash = null, receipt = null } = {}) {
      const { rows } = await pool.query(`UPDATE ${TABLE} SET status=$5,revision=revision+1,
        transaction_hash=COALESCE($6,transaction_hash),receipt=COALESCE($7,receipt),updated_at=now()
        WHERE administrator=$1 AND registry=$2 AND id=$3 AND revision=$4 AND status=ANY($8::text[]) RETURNING *`,
      [administrator,registry,id,revision,to,transactionHash,receipt,from]);
      if (!rows[0]) throw Error('SKILL_ADMIN_REVIEW_CONFLICT'); return view(rows[0]);
    },
  });
}
