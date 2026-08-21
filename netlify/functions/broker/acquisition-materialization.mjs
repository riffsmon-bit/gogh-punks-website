import { ROBINHOOD, normalizeAddress } from "../../../broker/src/config.mjs";
import { projectBrokerAccountLog } from "../../../broker/src/indexer/account-event-projection.mjs";

const PENDING_BATCH_SIZE = 500;

export async function materializeBrokerAcquisition(query, acquisition) {
  if (typeof query !== "function") throw new TypeError("query must be a function");
  if (acquisition?.kind !== "ACCOUNT_ACQUISITION") {
    throw new TypeError("a decoded account acquisition is required");
  }
  return query(
    `INSERT INTO broker_acquisitions
      (chain_id, transaction_hash, log_index, punk_collection_address,
       punk_token_id, punk_account_address, nft_collection_address,
       nft_token_id, asset_amount, creator_address, currency_address, price,
       marketplace_address, acquisition_mode, agent_address, policy_version,
       scores, reasoning_hash, block_number, block_hash, acquired_at,
       opportunity_id, opportunity_type, asset_standard, adapter_address,
       executor_address, owner_approved, acquisition_nonce, state_sequence)
     SELECT
       $1, $2, $3, punk.collection_address, punk.token_id, $5, $6, $7, $8,
       NULL, $9, $10, $11, $12, $13, $14, '{}'::jsonb, $15, $16, $17,
       $18::timestamptz, $19, $20, $21, $22, $23, $24, $25, $26
       FROM broker_punks AS punk
      WHERE punk.chain_id = $1
        AND punk.collection_address = $4
        AND punk.account_address = $5
        AND punk.account_version = 1
     ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`,
    [
      ROBINHOOD.chainId,
      acquisition.transactionHash,
      acquisition.logIndex,
      ROBINHOOD.canonicalCollection,
      acquisition.account,
      acquisition.collection,
      acquisition.tokenId,
      acquisition.assetAmount,
      acquisition.currency,
      acquisition.price,
      acquisition.venue,
      acquisition.acquisitionMode,
      acquisition.agent,
      acquisition.policyVersion,
      acquisition.reasoningHash,
      acquisition.blockNumber,
      acquisition.blockHash,
      acquisition.occurredAt,
      acquisition.opportunityId,
      acquisition.opportunityType,
      acquisition.assetStandard,
      acquisition.adapter,
      acquisition.executor,
      acquisition.ownerApproved,
      acquisition.nonce,
      acquisition.state,
    ],
  );
}

export async function materializePendingAccountAcquisitions(
  query,
  chainId,
  accountAddress,
  { limit = PENDING_BATCH_SIZE } = {},
) {
  if (typeof query !== "function") throw new TypeError("query must be a function");
  if (BigInt(chainId) !== BigInt(ROBINHOOD.chainId)) {
    throw new TypeError("pending acquisition reconciliation requires Robinhood chain 4663");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PENDING_BATCH_SIZE) {
    throw new RangeError(`pending acquisition limit must be between 1 and ${PENDING_BATCH_SIZE}`);
  }
  const account = normalizeAddress(accountAddress, "Punk Account");
  const pending = await query(
    `SELECT raw.id, raw.address, raw.block_number::text AS block_number,
            raw.block_hash, raw.transaction_hash, raw.log_index::text AS log_index,
            raw.topics, raw.data,
            FLOOR(EXTRACT(EPOCH FROM raw.block_timestamp))::bigint::text AS block_timestamp
       FROM broker_indexed_logs AS raw
       LEFT JOIN broker_acquisitions AS acquisition
         ON acquisition.chain_id = raw.chain_id
        AND acquisition.transaction_hash = raw.transaction_hash
        AND acquisition.log_index = raw.log_index
      WHERE raw.chain_id = $1
        AND raw.stream = 'account_acquisitions'
        AND raw.address = $2
        AND raw.block_timestamp IS NOT NULL
        AND acquisition.transaction_hash IS NULL
      ORDER BY raw.block_number, raw.log_index
      LIMIT $3`,
    [ROBINHOOD.chainId, account, limit],
  );

  let materialized = 0;
  for (const row of pending.rows ?? []) {
    const projection = projectBrokerAccountLog({
      chainId: ROBINHOOD.chainId,
      stream: "account_acquisitions",
      record: {
        id: row.id,
        address: row.address,
        blockNumber: String(row.block_number),
        blockHash: row.block_hash,
        transactionHash: row.transaction_hash,
        logIndex: String(row.log_index),
        topics: row.topics,
        data: row.data,
        blockTimestamp: String(row.block_timestamp),
      },
    });
    if (!projection || projection.account !== account) continue;
    const result = await materializeBrokerAcquisition(query, projection);
    materialized += Number(result.rowCount ?? 0);
  }
  return materialized;
}
