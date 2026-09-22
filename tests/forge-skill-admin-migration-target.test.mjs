import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('automatic Netlify migrations exclude the separately provisioned skill journal', async () => {
  const automatic = 'netlify/database/migrations';
  for (const name of await readdir(automatic)) {
    if (!name.endsWith('.sql')) continue;
    assert.doesNotMatch(await readFile(`${automatic}/${name}`, 'utf8'), /gogh_forge_skill_admin_request/,
      `${name} would provision the Supabase-only request role in the application database`);
  }
  const approved = {
    '20260914030000_forge_skill_admin_reviews.sql': 'a69194e6aafb639ef193190474acd7164264cc3f5d635d2a8f1cb57c64d74e5b',
    '20260914033000_forge_skill_admin_nonce_recovery.sql': 'c7198919cb55ad034bdd54bd28ac5a4417ca8d2bad1ac761d3950d01f1b00568',
  };
  for (const [name, hash] of Object.entries(approved)) {
    const sql = await readFile(`database/supabase/migrations/${name}`);
    assert.equal(createHash('sha256').update(sql).digest('hex'), hash,
      'Relocation must preserve the SQL already reviewed and applied');
  }
});
