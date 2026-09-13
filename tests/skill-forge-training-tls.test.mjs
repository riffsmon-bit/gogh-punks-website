import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { trainingDatabaseTls } from '../netlify/functions/_shared/forge-training-runtime.mjs';

test('training storage trusts the pinned Supabase CA without relaxing certificate or hostname verification', async () => {
  const config = await trainingDatabaseTls('aws-0-us-east-1.pooler.supabase.com');
  assert.equal(config.rejectUnauthorized, true);
  assert.equal(new X509Certificate(config.ca).fingerprint256,
    '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
  assert.equal(config.checkServerIdentity, undefined);
  assert.ok(tls.checkServerIdentity('aws-0-us-east-1.pooler.supabase.com', {
    subjectaltname: 'DNS:unrelated.example',
  }));
});

test('other database hosts and suffix lookalikes retain the system trust store', async () => {
  for (const hostname of ['db.example.com', 'pooler.supabase.com.evil.example', 'evilpooler.supabase.com']) {
    assert.deepEqual(await trainingDatabaseTls(hostname), { rejectUnauthorized: true });
  }
});
