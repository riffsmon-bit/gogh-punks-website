import { getDatabase } from "@netlify/database";

const REVIEW_LOCK_ID = 4_663_1_797;
const MAX_ARTIFACT_BYTES = 2_000_000;

function rowValue(row, snake, camel) {
  return row?.[snake] ?? row?.[camel] ?? null;
}

export function executionReviewFromRow(row) {
  if (!row) return null;
  return Object.freeze({
    artifactSha256: String(rowValue(row, "artifact_sha256", "artifactSha256")),
    chainId: Number(rowValue(row, "chain_id", "chainId")),
    expectedOwner: String(rowValue(row, "expected_owner", "expectedOwner")),
    account: String(rowValue(row, "account_address", "account")),
    policyModule: String(rowValue(row, "policy_module", "policyModule")),
    punkCollection: String(rowValue(row, "punk_collection", "punkCollection")),
    punkTokenId: String(rowValue(row, "punk_token_id", "punkTokenId")),
    adapter: String(rowValue(row, "adapter_address", "adapter")),
    venue: String(rowValue(row, "venue_address", "venue")),
    collection: String(rowValue(row, "collection_address", "collection")),
    tokenId: String(rowValue(row, "output_token_id", "tokenId")),
    functionSelector: String(rowValue(row, "function_selector", "functionSelector")),
    mintSelector: String(rowValue(row, "mint_selector", "mintSelector")),
    value: String(rowValue(row, "transaction_value", "value")),
    dataKeccak256: String(rowValue(row, "data_keccak256", "dataKeccak256")),
    intentDigest: String(rowValue(row, "intent_digest", "intentDigest")),
    accountRuntimeCodeHash: String(rowValue(
      row,
      "account_runtime_code_hash",
      "accountRuntimeCodeHash",
    )),
    adapterRuntimeCodeHash: String(rowValue(
      row,
      "adapter_runtime_code_hash",
      "adapterRuntimeCodeHash",
    )),
    artRuntimeCodeHash: String(rowValue(row, "art_runtime_code_hash", "artRuntimeCodeHash")),
    coreManifestSha256: String(rowValue(row, "core_manifest_sha256", "coreManifestSha256")),
    canaryManifestSha256: String(rowValue(row, "canary_manifest_sha256", "canaryManifestSha256")),
    nonce: String(rowValue(row, "acquisition_nonce", "nonce")),
    policyVersion: String(rowValue(row, "policy_version", "policyVersion")),
    expiresAt: String(rowValue(row, "expires_at_seconds", "expiresAt")),
  });
}

export function executionArtifactFromRow(row) {
  const stored = rowValue(row, "execution_artifact_json", "executionArtifactJson");
  if (stored === null) return null;
  if (typeof stored !== "string" || Buffer.byteLength(stored, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new Error("stored canary execution artifact is malformed");
  }
  const artifact = JSON.parse(stored);
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error("stored canary execution artifact is not an object");
  }
  return artifact;
}

function serializedArtifact(artifact) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error("canary execution artifact must be an object");
  }
  const serialized = JSON.stringify(artifact);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= 0 || bytes > MAX_ARTIFACT_BYTES) {
    throw new Error("canary execution artifact exceeds its storage boundary");
  }
  return serialized;
}

export async function activateCanaryExecutionReview(review, policyModule, artifact) {
  const artifactJson = serializedArtifact(artifact);
  const client = await getDatabase().pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [REVIEW_LOCK_ID]);
    await client.query(
      `UPDATE broker_canary_execution_reviews
          SET revoked_at = NOW()
        WHERE revoked_at IS NULL`,
    );
    const result = await client.query(
      `INSERT INTO broker_canary_execution_reviews
        (artifact_sha256, chain_id, expected_owner, account_address, policy_module,
         punk_collection, punk_token_id, adapter_address, venue_address, collection_address,
         output_token_id, function_selector, mint_selector, transaction_value,
         data_keccak256, intent_digest, account_runtime_code_hash,
         adapter_runtime_code_hash, art_runtime_code_hash, core_manifest_sha256,
         canary_manifest_sha256, acquisition_nonce, policy_version, expires_at,
         execution_artifact_json)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10, $11::numeric, $12, $13,
         $14::numeric, $15, $16, $17, $18, $19, $20, $21, $22::numeric, $23,
         to_timestamp($24::numeric), $25)
       ON CONFLICT (artifact_sha256) DO UPDATE SET
         chain_id = EXCLUDED.chain_id,
         expected_owner = EXCLUDED.expected_owner,
         account_address = EXCLUDED.account_address,
         policy_module = EXCLUDED.policy_module,
         punk_collection = EXCLUDED.punk_collection,
         punk_token_id = EXCLUDED.punk_token_id,
         adapter_address = EXCLUDED.adapter_address,
         venue_address = EXCLUDED.venue_address,
         collection_address = EXCLUDED.collection_address,
         output_token_id = EXCLUDED.output_token_id,
         function_selector = EXCLUDED.function_selector,
         mint_selector = EXCLUDED.mint_selector,
         transaction_value = EXCLUDED.transaction_value,
         data_keccak256 = EXCLUDED.data_keccak256,
         intent_digest = EXCLUDED.intent_digest,
         account_runtime_code_hash = EXCLUDED.account_runtime_code_hash,
         adapter_runtime_code_hash = EXCLUDED.adapter_runtime_code_hash,
         art_runtime_code_hash = EXCLUDED.art_runtime_code_hash,
         core_manifest_sha256 = EXCLUDED.core_manifest_sha256,
         canary_manifest_sha256 = EXCLUDED.canary_manifest_sha256,
         acquisition_nonce = EXCLUDED.acquisition_nonce,
         policy_version = EXCLUDED.policy_version,
         expires_at = EXCLUDED.expires_at,
         execution_artifact_json = EXCLUDED.execution_artifact_json,
         reviewed_at = NOW(),
         revoked_at = NULL
       RETURNING *, FLOOR(EXTRACT(EPOCH FROM expires_at))::bigint::text AS expires_at_seconds`,
      [
        review.artifactSha256,
        review.chainId,
        review.expectedOwner,
        review.account,
        policyModule,
        review.punkCollection,
        review.punkTokenId,
        review.adapter,
        review.venue,
        review.collection,
        review.tokenId,
        review.functionSelector,
        review.mintSelector,
        review.value,
        review.dataKeccak256,
        review.intentDigest,
        review.accountRuntimeCodeHash,
        review.adapterRuntimeCodeHash,
        review.artRuntimeCodeHash,
        review.coreManifestSha256,
        review.canaryManifestSha256,
        review.nonce,
        review.policyVersion,
        review.expiresAt,
        artifactJson,
      ],
    );
    await client.query("COMMIT");
    return executionReviewFromRow(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getCurrentCanaryExecutionReview() {
  return (await getCurrentCanaryExecutionRecord())?.review ?? null;
}

export async function getCurrentCanaryExecutionRecord() {
  const result = await getDatabase().pool.query(
    `SELECT *, FLOOR(EXTRACT(EPOCH FROM expires_at))::bigint::text AS expires_at_seconds
       FROM broker_canary_execution_reviews
      WHERE revoked_at IS NULL
        AND expires_at >= NOW() + INTERVAL '30 seconds'
        AND execution_artifact_json IS NOT NULL
      ORDER BY reviewed_at DESC
      LIMIT 2`,
  );
  if (result.rows.length > 1) throw new Error("multiple active canary execution reviews");
  if (!result.rows[0]) return null;
  return Object.freeze({
    review: executionReviewFromRow(result.rows[0]),
    artifact: executionArtifactFromRow(result.rows[0]),
  });
}
