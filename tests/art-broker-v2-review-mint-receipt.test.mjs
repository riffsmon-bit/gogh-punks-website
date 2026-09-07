import assert from "node:assert/strict";
import test from "node:test";
import { encodeEventTopics, parseAbi } from "viem";

import { buildOwnerAssistedSeaDropTransaction,
  ownerAssistedTransactionEnvelopeHash } from
  "../broker/src/v4/owner-assisted-seadrop-mint.mjs";
import { handleV2ReviewMintReceipt } from
  "../netlify/functions/broker-v2-review-mint-receipt.mjs";

const OWNER = "0x1111111111111111111111111111111111111111";
const PUNK_WALLET = "0x2222222222222222222222222222222222222222";
const COLLECTION = "0x3333333333333333333333333333333333333333";
const ATTEMPT_ID = "123e4567-e89b-42d3-a456-426614174000";
const TRANSACTION_HASH = `0x${"ab".repeat(32)}`;
const TRANSFER_ABI = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
]);

function request(overrides = {}) {
  return new Request("https://deploy-preview-42.preview.goghpunks.xyz/api/v2/review/mint-receipt", {
    method: "POST", headers: { origin: "https://deploy-preview-42.preview.goghpunks.xyz",
      "content-type": "application/json" },
    body: JSON.stringify({ attemptId: ATTEMPT_ID, owner: OWNER, tokenId: "93",
      transactionHash: TRANSACTION_HASH, ...overrides }),
  });
}

function world({ transactionData = null, receiptMissing = false,
  attemptState = "OWNER_APPROVAL_PENDING" } = {}) {
  const expected = buildOwnerAssistedSeaDropTransaction({ owner: OWNER,
    punkWallet: PUNK_WALLET, collection: COLLECTION });
  const envelopeHash = ownerAssistedTransactionEnvelopeHash(expected);
  const queries = [];
  const db = { async query(sql, params = []) {
    queries.push([sql, params]);
    if (sql.includes("SELECT state, transaction_envelope_hash")) return { rows: [{
      state: attemptState, transaction_envelope_hash: envelopeHash,
      transaction_hash: null,
    }] };
    return { rows: [] };
  }, release() {} };
  const pool = { async query(sql) {
    queries.push([sql, []]);
    if (sql.includes("FROM broker_v2_execution_attempts attempt")) return { rows: [{
      attempt_id: ATTEMPT_ID, punk_account: PUNK_WALLET, owner_snapshot: OWNER,
      opportunity_id: "seadrop:test-collection:public", state: attemptState,
      transaction_envelope_hash: envelopeHash, transaction_hash: null,
      collection_contract: COLLECTION, normalized: {},
    }] };
    if (sql.includes("SET state = 'SUBMITTED'")) return { rows: [{ attempt_id: ATTEMPT_ID }] };
    return { rows: [] };
  }, async connect() { return db; } };
  const topics = encodeEventTopics({ abi: TRANSFER_ABI, eventName: "Transfer", args: {
    from: "0x0000000000000000000000000000000000000000", to: PUNK_WALLET, tokenId: 42n,
  } });
  const client = {
    async getTransaction() { return { hash: TRANSACTION_HASH, from: OWNER, to: PUNK_WALLET,
      value: 0n, input: transactionData ?? expected.data, chainId: 4663,
      blockNumber: 123n }; },
    async getTransactionReceipt() {
      if (receiptMissing) throw new Error("receipt is pending");
      return { transactionHash: TRANSACTION_HASH,
      from: OWNER, to: PUNK_WALLET, blockNumber: 123n, status: "success",
      logs: [{ address: COLLECTION, topics, data: "0x" }] };
    },
    async readContract() { return PUNK_WALLET; },
    async getBlock() { return { timestamp: 1_788_716_800n }; },
  };
  const readAuthority = async () => ({ owner: OWNER, punkWallet: PUNK_WALLET, activated: true });
  const requireSession = async () => ({ walletAddress: OWNER });
  return { pool, client, readAuthority, requireSession, queries };
}

test("receipt reconciliation requires the signed-in owner session", async () => {
  const fixture = world();
  fixture.requireSession = async () => ({
    walletAddress: "0x9999999999999999999999999999999999999999",
  });
  const response = await handleV2ReviewMintReceipt(request(), fixture);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "NOT_CURRENT_OWNER");
  assert.equal(fixture.queries.length, 0);
});

test("receipt reconciliation verifies the exact transaction and records one collected activity", async () => {
  const fixture = world();
  const response = await handleV2ReviewMintReceipt(request(), fixture);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.confirmed, true);
  assert.equal(payload.tokenId, "42");
  assert.equal(payload.punkWallet, PUNK_WALLET);
  assert.equal(fixture.queries.some(([sql]) => sql.includes("SET state = 'CONFIRMED'")), true);
  assert.equal(fixture.queries.some(([sql]) => sql.includes("'COLLECTED'")), true);
  assert.equal(fixture.queries.some(([sql]) => sql === "COMMIT"), true);
});

test("receipt reconciliation rejects calldata that differs from the reserved envelope", async () => {
  const fixture = world({ transactionData: "0x1234" });
  const response = await handleV2ReviewMintReceipt(request(), fixture);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "TRANSACTION_MISMATCH");
  assert.equal(fixture.queries.some(([sql]) => sql.includes("'COLLECTED'")), false);
});

test("an exact broadcast transaction remains reserved while its receipt is pending", async () => {
  const fixture = world({ receiptMissing: true });
  const response = await handleV2ReviewMintReceipt(request(), fixture);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, confirmed: false, state: "SUBMITTED",
    transactionHash: TRANSACTION_HASH });
  assert.equal(fixture.queries.some(([sql]) => sql.includes("SET state = 'SUBMITTED'")), true);
  assert.equal(fixture.queries.some(([sql]) => sql.includes("'COLLECTED'")), false);
});

test("receipt reconciliation cannot resurrect a terminal attempt", async () => {
  const fixture = world({ attemptState: "CANCELLED" });
  const response = await handleV2ReviewMintReceipt(request(), fixture);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "ATTEMPT_STATE_INVALID");
  assert.equal(fixture.queries.some(([sql]) => sql.includes("'COLLECTED'")), false);
});
