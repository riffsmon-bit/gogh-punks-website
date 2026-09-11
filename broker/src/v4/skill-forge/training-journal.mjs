import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { openSync, closeSync, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const encode = entry => JSON.stringify({ review: entry.review, input: entry.input, state: entry.state,
  digest: entry.digest, expiresAt: entry.expiresAt, status: entry.status,
  transactionHash: entry.transactionHash, blockHash: entry.blockHash ?? null },
(_key, value) => typeof value === 'bigint' ? value.toString() : value);
const hash = value => createHash('sha256').update(value).digest('hex');
const statuses = ['PREPARED', 'CHECKING', 'AWAITING_WALLET', 'SUBMITTED', 'SUBMISSION_UNKNOWN', 'INVALIDATED', 'REJECTED', 'REVERTED', 'CONFIRMED'];

// Local durable test adapter, NOT a Netlify production database implementation.
// SQLite transactions/CAS make the pre-wallet claim durable and exclusive per test Punk.
export function openTrainingJournal({ path, deploymentIdentity }) {
  if (!isAbsolute(path) || typeof deploymentIdentity !== 'string' || !/^[0-9a-f]{64}$/.test(deploymentIdentity)) throw Error('INVALID_JOURNAL_CONFIGURATION');
  try { closeSync(openSync(path, 'wx', 0o600)); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw Error('INVALID_JOURNAL_FILE');
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS deployment (id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS training_intents (
        id TEXT PRIMARY KEY, token_id INTEGER NOT NULL, status TEXT NOT NULL,
        revision INTEGER NOT NULL, payload TEXT NOT NULL, checksum TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_unresolved_training_per_punk ON training_intents(token_id)
        WHERE status IN ('CHECKING','AWAITING_WALLET','SUBMITTED','SUBMISSION_UNKNOWN');`);
    db.exec('BEGIN IMMEDIATE');
    const current = db.prepare('SELECT identity FROM deployment WHERE id=1').get();
    if (current && current.identity !== deploymentIdentity) throw Error('JOURNAL_DEPLOYMENT_MISMATCH');
    if (!current) db.prepare('INSERT INTO deployment(id,identity) VALUES (1,?)').run(deploymentIdentity);
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} db.close(); throw error; }
  const list = db.prepare('SELECT id,token_id,status,revision,payload,checksum FROM training_intents ORDER BY rowid');
  const insert = db.prepare('INSERT INTO training_intents(id,token_id,status,revision,payload,checksum) VALUES (?,?,?,0,?,?)');
  const update = db.prepare('UPDATE training_intents SET status=?,revision=revision+1,payload=?,checksum=? WHERE id=? AND revision=?');
  return Object.freeze({
    loadAll() {
      return list.all().map(row => {
        if (hash(row.payload) !== row.checksum) throw Error('JOURNAL_CORRUPT');
        const entry = JSON.parse(row.payload);
        if (entry.review?.intentId !== row.id || entry.input?.tokenId !== row.token_id || entry.status !== row.status
          || !statuses.includes(row.status)) throw Error('JOURNAL_CORRUPT');
        return { ...entry, revision: row.revision };
      });
    },
    save(entry) {
      if (!statuses.includes(entry.status) || !/^[0-9a-f]{64}$/.test(entry.review?.intentId)) throw Error('INVALID_JOURNAL_ENTRY');
      const payload = encode(entry);
      if (entry.revision == null) { insert.run(entry.review.intentId, entry.input.tokenId, entry.status, payload, hash(payload)); entry.revision = 0; }
      else {
        const current = db.prepare('SELECT revision,payload FROM training_intents WHERE id=?').get(entry.review.intentId);
        // Status-only reads must not steal the revision of an in-flight wallet writer.
        if (current?.payload === payload) { entry.revision = current.revision; return; }
        const result = update.run(entry.status, payload, hash(payload), entry.review.intentId, entry.revision);
        if (Number(result.changes) !== 1) throw Error('JOURNAL_REVISION_CONFLICT');
        entry.revision++;
      }
    },
    close() { db.close(); },
  });
}
