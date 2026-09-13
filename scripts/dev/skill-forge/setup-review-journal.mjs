import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync, lstatSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const setupDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const valid = value => { if (!value) throw Error('SETUP_REVIEW_STATE_CHANGED'); };

// Persist the wallet claim before returning any transaction to the browser.
// A lost response remains claimed across refreshes/restarts; recovery cannot resend.
export function openSetupReviewJournal({ path, binding, migrateBinding }) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  valid(!existsSync(path) || lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
  const db = new DatabaseSync(path); chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS setup_reviews (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS setup_review_history (revision INTEGER PRIMARY KEY, data TEXT NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO setup_reviews VALUES (1,0,?)').run(JSON.stringify({ binding, records: [] }));
  // A build update may preserve already reviewed, byte-identical registration
  // steps. The caller must explicitly validate every record before rebinding.
  const initial = db.prepare('SELECT revision,data FROM setup_reviews WHERE id=1').get();
  const prior = JSON.parse(initial.data);
  if (prior.binding !== binding && typeof migrateBinding === 'function') {
    try { valid(prior.records.every(r => r.reviewHash === setupDigest(r.review)) && migrateBinding(prior)); }
    catch(error) { db.close(); throw error; }
    db.exec('BEGIN IMMEDIATE');
    try {
      const data = JSON.stringify({ ...prior, binding });
      valid(db.prepare('UPDATE setup_reviews SET revision=revision+1,data=? WHERE id=1 AND revision=?').run(data,initial.revision).changes===1);
      db.prepare('INSERT INTO setup_review_history VALUES (?,?)').run(initial.revision+1,data);
      db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  const snapshot = () => {
    const row = db.prepare('SELECT revision,data FROM setup_reviews WHERE id=1').get();
    const data = JSON.parse(row.data); valid(data.binding === binding);
    for (const r of data.records) valid(r.reviewHash === setupDigest(r.review));
    return { revision: row.revision, ...data };
  };
  function save(revision, update) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const state = snapshot(); valid(state.revision === revision); update(state);
      const { revision: oldRevision, ...data } = state, json = JSON.stringify(data);
      db.prepare('UPDATE setup_reviews SET revision=revision+1,data=? WHERE id=1').run(json);
      db.prepare('INSERT INTO setup_review_history VALUES (?,?)').run(oldRevision+1,json);
      db.exec('COMMIT'); return snapshot();
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  try { snapshot(); } catch (error) { db.close(); throw error; }
  return {
    snapshot,
    prepare(revision, review) {
      return save(revision, state => {
        const last = state.records.at(-1);
        valid(!last || ['PREPARED','DECLINED','INCLUDED','REVERTED'].includes(last.status));
        if (last?.status === 'PREPARED') last.status = 'CANCELLED_BEFORE_WALLET';
        state.records.push({ review, reviewHash: setupDigest(review), status: 'PREPARED', transactionHash: null, inclusion: null });
      });
    },
    claim(revision, reviewHash) {
      return save(revision, state => {
        const last = state.records.at(-1); valid(last?.status === 'PREPARED' && last.reviewHash === reviewHash);
        valid(Date.now() < last.review.expiresAt); last.status = 'WALLET_REQUESTED';
      });
    },
    decline(revision, reviewHash) {
      return save(revision, state => {
        const last=state.records.at(-1);
        valid(last?.status==='WALLET_REQUESTED' && !last.transactionHash && last.reviewHash===reviewHash);
        last.status='DECLINED';
      });
    },
    recover(revision, transactionHash) {
      return save(revision, state => {
        const last = state.records.at(-1);
        valid(last && ['WALLET_REQUESTED','SUBMITTED'].includes(last.status) && /^0x[0-9a-f]{64}$/i.test(transactionHash));
        valid(!last.transactionHash || last.transactionHash.toLowerCase() === transactionHash.toLowerCase());
        last.transactionHash = transactionHash.toLowerCase(); last.status = 'SUBMITTED';
      });
    },
    include(revision, inclusion) {
      return save(revision, state => {
        const last = state.records.at(-1); valid(last?.status === 'SUBMITTED');
        valid(inclusion.transactionHash === last.transactionHash && ['success','reverted'].includes(inclusion.status));
        last.inclusion = inclusion; last.status = inclusion.status === 'success' ? 'INCLUDED' : 'REVERTED';
      });
    },
    close: () => db.close(),
  };
}
