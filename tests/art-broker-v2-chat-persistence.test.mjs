import assert from "node:assert/strict";
import test from "node:test";
import { handleV2Chat, persistV2ChatDraft } from "../netlify/functions/broker-v2-chat.mjs";
import { defaultAskIntent } from "../broker/src/v4/collecting-intent.mjs";
import { PublicError } from "../netlify/functions/_shared/http.mjs";

const owner = `0x${"1".repeat(40)}`, punkWallet = `0x${"2".repeat(40)}`;
process.env.SITE_URL = "https://goghpunks.xyz";
const authority = { punkWallet, blockNumber: "100", activated: true };
const input = { tokenId: "93", owner, authority, draft: {
  confirmation: { intentHash: `0x${"a".repeat(64)}` },
  intent: { expiration: "2026-10-01T00:00:00Z" },
} };
for (const state of ["PENDING_OWNER_CONFIRMATION", "PAUSED"]) {
  test(`same ${state} review is reused without changing authority`, async () => {
    const queries = [];
    const client = { query: async (sql, args) => {
      queries.push(sql); assert.equal(args[2], "93"); assert.equal(args[3], input.draft.confirmation.intentHash);
      return { rows: [{ version: "6", state, configured_by: owner }] };
    } };
    assert.deepEqual(await persistV2ChatDraft(client, input), { version: 6, reused: true });
    assert.equal(queries.length, 1); assert.match(queries[0], /FOR UPDATE/);
  });
}
test("new review inserts once as pending, never active", async () => {
  const queries = [];
  const client = { query: async sql => {
    queries.push(sql); return { rows: sql.includes("MAX(version)") ? [{ version: "7" }] : [] };
  } };
  assert.deepEqual(await persistV2ChatDraft(client, input), { version: 7, reused: false });
  assert.equal(queries.length, 3); assert.match(queries[2], /'PENDING_OWNER_CONFIRMATION'/);
});
test("old-owner, active, and retired rows are not silently revived", async () => {
  for (const row of [{ state: "PAUSED", configured_by: punkWallet },
    ...["ACTIVE", "SUPERSEDED", "EXPIRED"].map(state => ({ state, configured_by: owner }))]) {
    let calls = 0;
    await assert.rejects(persistV2ChatDraft({ query: async () => { calls++; return { rows: [row] }; } }, input),
      error => ["STRATEGY_OWNER_CHANGED", "STRATEGY_ALREADY_RECORDED"].includes(error.code));
    assert.equal(calls, 1);
  }
});
for (const origin of ["https://goghpunks.xyz", "https://deploy-preview-47.preview.goghpunks.xyz", "https://deploy-preview-47--gogh-punks.netlify.app"])
for (const state of ["PAUSED", "PENDING_OWNER_CONFIRMATION"]) {
  test(`full chat handler on ${origin} returns HTTP 200 for duplicate ${state} mission`, async () => {
    const intent = { ...defaultAskIntent({ punkTokenId: "93", expectedOwner: owner, punkWallet }),
      operatingMode: "AUTONOMOUS", totalMintLimit: 1, dailyMintLimit: 1 };
    const queries = [];
    const client = { release() {}, query: async sql => {
      queries.push(sql);
      if (sql.includes("SELECT conversation_id")) return { rows: [{ conversation_id: "conversation" }] };
      if (sql.includes("SELECT version, state, configured_by")) return { rows: [{ version: "6", state, configured_by: owner }] };
      return { rows: [] };
    } };
    const response = await handleV2Chat(new Request(`${origin}/api/v2/punks/93/chat`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ message: "Find and mint one eligible free NFT." }),
    }), { pool: { connect: async () => client, query: async (sql, args) => {
      assert.match(sql, /configured_by = \$4/); assert.equal(args[3], owner); return { rows: [{ intent }] };
    } }, requireSession: async () => ({ walletAddress: owner }), readAuthority: async () => authority,
    checkAuthority: async value => { assert.equal(value, authority); queries.push('CONTINUITY_CHECKED'); },
    createIntelligence: () => ({ router: { run: async () => { throw Error("AI must not be needed"); } } }),
    });
    const body = await response.json(); assert.equal(response.status, 200);
    assert.equal(body.draft.version, 6); assert.equal(body.economicPermissionsActivated, false);
    assert.ok(queries.includes("COMMIT")); assert.ok(queries.some(q => q.includes("pg_advisory_xact_lock")));
    assert.ok(queries.indexOf('CONTINUITY_CHECKED') < queries.findIndex(q => q.includes('INSERT INTO broker_punks')));
    assert.equal(queries.some(q => q.includes("INSERT INTO broker_v2_strategies")), false);
  });
}

test('ownership change during chat rolls back before saving a reused mission or private conversation', async () => {
  const queries = [];
  const intent = { ...defaultAskIntent({ punkTokenId: '93', expectedOwner: owner, punkWallet }),
    operatingMode: 'AUTONOMOUS', totalMintLimit: 1, dailyMintLimit: 1 };
  const client = { release() {}, query: async sql => { queries.push(sql); return { rows: [] }; } };
  const response = await handleV2Chat(new Request('https://goghpunks.xyz/api/v2/punks/93/chat', {
    method: 'POST', headers: { origin: 'https://goghpunks.xyz', 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Find and mint one eligible free NFT.' }),
  }), { pool: { connect: async () => client, query: async () => ({ rows: [{ intent }] }) },
    requireSession: async () => ({ walletAddress: owner }), readAuthority: async () => authority,
    checkAuthority: async () => { throw new PublicError(409, 'CHAT_AUTHORITY_CHANGED', 'Punk transferred.'); },
    createIntelligence: () => ({ router: { run: async () => { throw Error('Unexpected AI call'); } } }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'CHAT_AUTHORITY_CHANGED');
  assert.ok(queries.includes('ROLLBACK'));
  assert.equal(queries.some(sql => /INSERT|UPDATE|COMMIT/.test(sql)), false);
});
