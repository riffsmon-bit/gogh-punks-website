import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, zeroAddress } from "viem";
import { ROBINHOOD } from "../src/config.mjs";
import {
  ACCOUNT_ACQUISITION_EVENT_ABI,
  ACCOUNT_ACQUISITION_TOPIC,
  ACCOUNT_ACTIVATION_EVENT_ABI,
  ACCOUNT_ACTIVATION_TOPIC,
  decodeAccountAcquisitionLog,
  decodeAccountActivationLog,
  projectBrokerAccountLog,
} from "../src/indexer/account-event-projection.mjs";
import { protocolStreams } from "../src/indexer/streams.mjs";
import { PostgresIndexerRepository } from "../../netlify/functions/broker/indexer-repository.mjs";
import { PostgresMetadataRepository } from "../../netlify/functions/broker/metadata-repository.mjs";
import { PostgresScoutRepository } from "../../netlify/functions/broker/scout-repository.mjs";

const REGISTRY = "0x1111111111111111111111111111111111111111";
const IMPLEMENTATION = "0x2222222222222222222222222222222222222222";
const POLICY = "0x3333333333333333333333333333333333333333";
const PUNK_ACCOUNT = "0x4444444444444444444444444444444444444444";
const OTHER_ACCOUNT = "0x5555555555555555555555555555555555555555";
const OWNER = "0x6666666666666666666666666666666666666666";
const AGENT = "0x7777777777777777777777777777777777777777";
const NFT_COLLECTION = "0x8888888888888888888888888888888888888888";
const ADAPTER = "0x9999999999999999999999999999999999999999";
const VENUE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CURRENCY = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OPPORTUNITY_ID = `0x${"12".repeat(32)}`;
const REASONING_HASH = `0x${"34".repeat(32)}`;
const TX_HASH = `0x${"56".repeat(32)}`;
const BLOCK_HASH = `0x${"78".repeat(32)}`;
const BLOCK_TIMESTAMP = "1787242530";

function nonIndexedInputs(abi) {
  return abi.inputs.filter((input) => !input.indexed);
}

function acquisitionLog({
  address = PUNK_ACCOUNT,
  executor = OWNER,
  opportunityId = OPPORTUNITY_ID,
  collection = NFT_COLLECTION,
  opportunityType = 2,
  assetStandard = 0,
  adapter = ADAPTER,
  venue = VENUE,
  tokenId = 901n,
  assetAmount = 1n,
  currency = zeroAddress,
  price = 0n,
  ownerApproved = true,
  reasoningHash = REASONING_HASH,
  policyVersion = 7n,
  nonce = 11n,
  state = 13n,
  transactionHash = TX_HASH,
  logIndex = "0x5",
} = {}) {
  const topics = encodeEventTopics({
    abi: [ACCOUNT_ACQUISITION_EVENT_ABI],
    eventName: "AcquisitionExecuted",
    args: { executor, opportunityId, collection },
  });
  const data = encodeAbiParameters(nonIndexedInputs(ACCOUNT_ACQUISITION_EVENT_ABI), [
    opportunityType,
    assetStandard,
    adapter,
    venue,
    tokenId,
    assetAmount,
    currency,
    price,
    ownerApproved,
    reasoningHash,
    policyVersion,
    nonce,
    state,
  ]);
  return {
    id: `${transactionHash}:${BigInt(logIndex).toString()}`,
    address,
    transactionHash,
    blockNumber: "0x1234",
    blockHash: BLOCK_HASH,
    blockTimestamp: BLOCK_TIMESTAMP,
    logIndex,
    topics,
    data,
  };
}

function activationLog({
  emitter = REGISTRY,
  account = PUNK_ACCOUNT,
  chainId = BigInt(ROBINHOOD.chainId),
  collection = ROBINHOOD.canonicalCollection,
  tokenId = 317n,
  owner = OWNER,
  implementation = IMPLEMENTATION,
  implementationVersion = 1n,
  transactionHash = `0x${"9a".repeat(32)}`,
  logIndex = "0x2",
} = {}) {
  const topics = encodeEventTopics({
    abi: [ACCOUNT_ACTIVATION_EVENT_ABI],
    eventName: "GoghPunkAccountActivated",
    args: { account, chainId, collection },
  });
  const data = encodeAbiParameters(nonIndexedInputs(ACCOUNT_ACTIVATION_EVENT_ABI), [
    tokenId,
    owner,
    implementation,
    implementationVersion,
  ]);
  return {
    id: `${transactionHash}:${BigInt(logIndex).toString()}`,
    address: emitter,
    transactionHash,
    blockNumber: "0x1235",
    blockHash: `0x${"ab".repeat(32)}`,
    blockTimestamp: String(BigInt(BLOCK_TIMESTAMP) + 12n),
    logIndex,
    topics,
    data,
  };
}

function replaceDataWord(data, index, word) {
  assert.match(word, /^[0-9a-f]{64}$/i);
  const offset = 2 + index * 64;
  return `${data.slice(0, offset)}${word}${data.slice(offset + 64)}`;
}

function uintWord(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

test("strict AcquisitionExecuted decoder preserves exact owner-approved provenance", () => {
  const decoded = decodeAccountAcquisitionLog(acquisitionLog());
  assert.deepEqual(decoded, {
    executor: OWNER,
    opportunityId: OPPORTUNITY_ID,
    collection: NFT_COLLECTION,
    opportunityType: "FREE_MINT",
    assetStandard: "ERC721",
    adapter: ADAPTER,
    venue: VENUE,
    tokenId: "901",
    assetAmount: "1",
    currency: zeroAddress,
    price: "0",
    ownerApproved: true,
    acquisitionMode: "OWNER_APPROVED",
    agent: null,
    reasoningHash: REASONING_HASH,
    policyVersion: "7",
    nonce: "11",
    state: "13",
  });

  const projected = projectBrokerAccountLog({
    chainId: ROBINHOOD.chainId,
    stream: "account_acquisitions",
    record: acquisitionLog(),
  });
  assert.equal(projected.kind, "ACCOUNT_ACQUISITION");
  assert.equal(projected.account, PUNK_ACCOUNT);
  assert.equal(projected.transactionHash, TX_HASH);
  assert.equal(projected.blockNumber, "4660");
  assert.equal(projected.logIndex, 5);
  assert.equal(projected.occurredAt, "2026-08-20T16:15:30.000Z");
});

test("strict AcquisitionExecuted decoder distinguishes autonomous ERC-1155 acquisitions", () => {
  const decoded = decodeAccountAcquisitionLog(acquisitionLog({
    executor: AGENT,
    opportunityType: 1,
    assetStandard: 1,
    tokenId: 42n,
    assetAmount: 3n,
    currency: CURRENCY,
    price: 123456n,
    ownerApproved: false,
    policyVersion: 9n,
    nonce: 99n,
    state: 101n,
  }));
  assert.deepEqual(decoded, {
    executor: AGENT,
    opportunityId: OPPORTUNITY_ID,
    collection: NFT_COLLECTION,
    opportunityType: "SECONDARY_BUY",
    assetStandard: "ERC1155",
    adapter: ADAPTER,
    venue: VENUE,
    tokenId: "42",
    assetAmount: "3",
    currency: CURRENCY,
    price: "123456",
    ownerApproved: false,
    acquisitionMode: "AUTONOMOUS",
    agent: AGENT,
    reasoningHash: REASONING_HASH,
    policyVersion: "9",
    nonce: "99",
    state: "101",
  });
});

test("strict AcquisitionExecuted decoder rejects malformed topics, data, enums, addresses, and bools", () => {
  const valid = acquisitionLog();
  assert.equal(decodeAccountAcquisitionLog({ ...valid, topics: valid.topics.slice(0, 3) }), null);
  assert.equal(decodeAccountAcquisitionLog({
    ...valid,
    topics: [...valid.topics, `0x${"00".repeat(32)}`],
  }), null);
  assert.equal(decodeAccountAcquisitionLog({ ...valid, data: valid.data.slice(0, -2) }), null);
  assert.equal(decodeAccountAcquisitionLog({ ...valid, data: `${valid.data}00` }), null);

  assert.equal(decodeAccountAcquisitionLog({
    ...valid,
    data: replaceDataWord(valid.data, 0, uintWord(8)),
  }), null);
  assert.equal(decodeAccountAcquisitionLog({
    ...valid,
    data: replaceDataWord(valid.data, 1, uintWord(2)),
  }), null);
  assert.equal(decodeAccountAcquisitionLog({
    ...valid,
    data: replaceDataWord(valid.data, 2, `01${"00".repeat(31)}`),
  }), null);
  assert.equal(decodeAccountAcquisitionLog({
    ...valid,
    data: replaceDataWord(valid.data, 8, uintWord(2)),
  }), null);

  const zeroExecutorTopics = [...valid.topics];
  zeroExecutorTopics[1] = `0x${"00".repeat(32)}`;
  assert.equal(decodeAccountAcquisitionLog({ ...valid, topics: zeroExecutorTopics }), null);
  assert.equal(decodeAccountAcquisitionLog(acquisitionLog({
    opportunityId: `0x${"00".repeat(32)}`,
  })), null);
  assert.equal(decodeAccountAcquisitionLog(acquisitionLog({
    reasoningHash: `0x${"00".repeat(32)}`,
  })), null);
});

test("activation decoding and projection pin canonical identity and implementation", () => {
  const decoded = decodeAccountActivationLog(activationLog());
  assert.deepEqual(decoded, {
    account: PUNK_ACCOUNT,
    chainId: "4663",
    collection: ROBINHOOD.canonicalCollection,
    tokenId: "317",
    owner: OWNER,
    implementation: IMPLEMENTATION,
    implementationVersion: "1",
  });

  const projection = projectBrokerAccountLog({
    chainId: ROBINHOOD.chainId,
    stream: "account_activations",
    record: activationLog(),
    expectedEmitter: REGISTRY,
    expectedImplementation: IMPLEMENTATION,
  });
  assert.equal(projection.kind, "ACCOUNT_ACTIVATION");
  assert.equal(projection.account, PUNK_ACCOUNT);
  assert.equal(projection.owner, OWNER);

  assert.equal(decodeAccountActivationLog(activationLog({ chainId: 1n })), null);
  assert.equal(decodeAccountActivationLog(activationLog({ collection: NFT_COLLECTION })), null);
  assert.equal(decodeAccountActivationLog(activationLog({ implementationVersion: 2n })), null);
  assert.equal(decodeAccountActivationLog(activationLog({
    implementation: zeroAddress,
  })), null);
  const malformedActivation = activationLog();
  assert.equal(decodeAccountActivationLog({
    ...malformedActivation,
    data: malformedActivation.data.slice(0, -2),
  }), null);
  assert.equal(decodeAccountActivationLog({
    ...malformedActivation,
    data: replaceDataWord(malformedActivation.data, 1, `01${"00".repeat(31)}`),
  }), null);
  assert.equal(projectBrokerAccountLog({
    chainId: ROBINHOOD.chainId,
    stream: "account_activations",
    record: activationLog({ emitter: OTHER_ACCOUNT }),
    expectedEmitter: REGISTRY,
    expectedImplementation: IMPLEMENTATION,
  }), null);
  assert.equal(projectBrokerAccountLog({
    chainId: ROBINHOOD.chainId,
    stream: "account_activations",
    record: activationLog(),
    expectedEmitter: REGISTRY,
    expectedImplementation: OTHER_ACCOUNT,
  }), null);
  assert.equal(projectBrokerAccountLog({
    chainId: 1,
    stream: "account_activations",
    record: activationLog(),
    expectedEmitter: REGISTRY,
    expectedImplementation: IMPLEMENTATION,
  }), null);
});

test("protocol streams expose account logs only for a complete deployed manifest", () => {
  const staged = protocolStreams({ status: "NOT_DEPLOYED", contracts: {} });
  assert.equal(Object.hasOwn(staged, "account_activations"), false);
  assert.equal(Object.hasOwn(staged, "account_acquisitions"), false);

  const deployed = protocolStreams({
    status: "DEPLOYED",
    contracts: {
      GoghPunkAccountRegistry: { address: REGISTRY },
      GoghPunkAccountV1: { address: IMPLEMENTATION },
      BrokerPolicyModule: { address: POLICY },
    },
  });
  assert.deepEqual(deployed.account_activations, {
    address: REGISTRY,
    implementation: IMPLEMENTATION,
    topics: [ACCOUNT_ACTIVATION_TOPIC],
  });
  assert.deepEqual(deployed.account_acquisitions, {
    topics: [ACCOUNT_ACQUISITION_TOPIC],
  });
  assert.equal(Object.hasOwn(deployed.account_acquisitions, "address"), false);
  assert.equal(Object.isFrozen(deployed.account_activations), true);
  assert.equal(Object.isFrozen(deployed.account_acquisitions), true);
});

class AccountIndexerDatabase {
  constructor() {
    this.rawLogs = new Map();
    this.punks = new Map();
    this.acquisitions = new Map();
    this.calls = [];
  }

  punkKey(chainId, collection, tokenId) {
    return `${chainId}:${collection}:${tokenId}`;
  }

  acquisitionKey(chainId, transactionHash, logIndex) {
    return `${chainId}:${transactionHash}:${logIndex}`;
  }

  async query(sql, values = []) {
    this.calls.push({ sql, values });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rowCount: 0, rows: [] };

    if (sql.includes("INSERT INTO broker_indexed_logs")) {
      const key = values[0];
      if (this.rawLogs.has(key)) return { rowCount: 0, rows: [] };
      this.rawLogs.set(key, {
        id: values[0],
        chain_id: values[1],
        stream: values[2],
        block_number: values[3],
        block_hash: values[4],
        transaction_hash: values[5],
        log_index: values[6],
        address: values[7],
        topics: JSON.parse(values[8]),
        data: values[9],
        block_timestamp: values[10],
      });
      return { rowCount: 1, rows: [] };
    }

    if (sql.includes("INSERT INTO broker_punks")) {
      const key = this.punkKey(values[0], values[1], values[2]);
      const existing = this.punks.get(key);
      if (existing && (
        (existing.account_address !== null && existing.account_address !== values[3])
        || (existing.account_version !== null
          && existing.account_version !== Number(values[4]))
      )) return { rowCount: 0, rows: [] };
      this.punks.set(key, {
        chain_id: values[0],
        collection_address: values[1],
        token_id: values[2],
        account_address: values[3],
        account_version: Number(values[4]),
        owner_snapshot: values[5],
      });
      return { rowCount: 1, rows: [{ account_address: values[3] }] };
    }

    if (sql.includes("SELECT raw.id") && sql.includes("account_acquisitions")) {
      const rows = [...this.rawLogs.values()]
        .filter((row) => row.chain_id === values[0])
        .filter((row) => row.stream === "account_acquisitions")
        .filter((row) => row.address === values[1])
        .filter((row) => !this.acquisitions.has(this.acquisitionKey(
          row.chain_id,
          row.transaction_hash,
          row.log_index,
        )))
        .slice(0, values[2]);
      return { rowCount: rows.length, rows };
    }

    if (sql.includes("INSERT INTO broker_acquisitions")) {
      const punk = [...this.punks.values()].find((candidate) => (
        candidate.chain_id === values[0]
        && candidate.collection_address === values[3]
        && candidate.account_address === values[4]
        && candidate.account_version === 1
      ));
      if (!punk) return { rowCount: 0, rows: [] };
      const key = this.acquisitionKey(values[0], values[1], values[2]);
      if (this.acquisitions.has(key)) return { rowCount: 0, rows: [] };
      this.acquisitions.set(key, {
        chain_id: values[0],
        transaction_hash: values[1],
        log_index: values[2],
        punk_collection_address: values[3],
        punk_token_id: punk.token_id,
        punk_account_address: values[4],
        nft_collection_address: values[5],
        nft_token_id: values[6],
        asset_amount: values[7],
        currency_address: values[8],
        price: values[9],
        marketplace_address: values[10],
        acquisition_mode: values[11],
        agent_address: values[12],
        policy_version: values[13],
        reasoning_hash: values[14],
        block_number: values[15],
        block_hash: values[16],
        acquired_at: values[17],
        opportunity_id: values[18],
        opportunity_type: values[19],
        asset_standard: values[20],
        adapter_address: values[21],
        executor_address: values[22],
        owner_approved: values[23],
        acquisition_nonce: values[24],
        state_sequence: values[25],
      });
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`unexpected test SQL: ${sql}`);
  }
}

test("repository materializes only a canonical version-1 Punk Account and remains idempotent", async () => {
  const database = new AccountIndexerDatabase();
  database.punks.set(
    database.punkKey(ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, "317"),
    {
      chain_id: ROBINHOOD.chainId,
      collection_address: ROBINHOOD.canonicalCollection,
      token_id: "317",
      account_address: PUNK_ACCOUNT,
      account_version: 1,
      owner_snapshot: OWNER,
    },
  );
  const repository = new PostgresIndexerRepository(database);
  const record = acquisitionLog();
  const streamDefinition = { topics: [ACCOUNT_ACQUISITION_TOPIC] };

  assert.equal(await repository.insertLogs(
    ROBINHOOD.chainId,
    "account_acquisitions",
    [record],
    { streamDefinition },
  ), 1);
  assert.equal(database.acquisitions.size, 1);
  const stored = [...database.acquisitions.values()][0];
  assert.equal(stored.punk_token_id, "317");
  assert.equal(stored.nft_collection_address, NFT_COLLECTION);
  assert.equal(stored.nft_token_id, "901");
  assert.equal(stored.marketplace_address, VENUE);
  assert.equal(stored.acquisition_mode, "OWNER_APPROVED");
  assert.equal(stored.agent_address, null);
  assert.equal(stored.opportunity_type, "FREE_MINT");
  assert.equal(stored.asset_standard, "ERC721");
  assert.equal(stored.adapter_address, ADAPTER);
  assert.equal(stored.executor_address, OWNER);
  assert.equal(stored.owner_approved, true);
  assert.equal(stored.acquisition_nonce, "11");
  assert.equal(stored.state_sequence, "13");

  assert.equal(await repository.insertLogs(
    ROBINHOOD.chainId,
    "account_acquisitions",
    [record],
    { streamDefinition },
  ), 0);
  assert.equal(database.rawLogs.size, 1);
  assert.equal(database.acquisitions.size, 1);

  const insertion = database.calls.find((call) => (
    call.sql.includes("INSERT INTO broker_acquisitions")
  ));
  assert.match(insertion.sql, /FROM broker_punks AS punk/);
  assert.match(insertion.sql, /punk\.chain_id = \$1/);
  assert.match(insertion.sql, /punk\.collection_address = \$4/);
  assert.match(insertion.sql, /punk\.account_address = \$5/);
  assert.match(insertion.sql, /punk\.account_version = 1/);
  assert.match(insertion.sql, /ON CONFLICT \(chain_id, transaction_hash, log_index\) DO NOTHING/);
});

test("repository retains spoof logs but ignores them until an exact Punk binding exists", async () => {
  const database = new AccountIndexerDatabase();
  database.punks.set(
    database.punkKey(ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, "317"),
    {
      chain_id: ROBINHOOD.chainId,
      collection_address: ROBINHOOD.canonicalCollection,
      token_id: "317",
      account_address: PUNK_ACCOUNT,
      account_version: 1,
      owner_snapshot: OWNER,
    },
  );
  const repository = new PostgresIndexerRepository(database);
  await repository.insertLogs(
    ROBINHOOD.chainId,
    "account_acquisitions",
    [acquisitionLog({ address: OTHER_ACCOUNT })],
    { streamDefinition: { topics: [ACCOUNT_ACQUISITION_TOPIC] } },
  );
  assert.equal(database.rawLogs.size, 1);
  assert.equal(database.acquisitions.size, 0);

  database.punks.set(
    database.punkKey(ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, "999"),
    {
      chain_id: ROBINHOOD.chainId,
      collection_address: ROBINHOOD.canonicalCollection,
      token_id: "999",
      account_address: OTHER_ACCOUNT,
      account_version: 2,
      owner_snapshot: OWNER,
    },
  );
  await repository.insertLogs(
    ROBINHOOD.chainId,
    "account_acquisitions",
    [acquisitionLog({
      address: OTHER_ACCOUNT,
      transactionHash: `0x${"cd".repeat(32)}`,
      logIndex: "0x6",
    })],
    { streamDefinition: { topics: [ACCOUNT_ACQUISITION_TOPIC] } },
  );
  assert.equal(database.rawLogs.size, 2);
  assert.equal(database.acquisitions.size, 0);
});

test("activation materializes its canonical Punk and backfills an earlier acquisition", async () => {
  const database = new AccountIndexerDatabase();
  const repository = new PostgresIndexerRepository(database);
  const acquisition = acquisitionLog();

  await repository.insertLogs(
    ROBINHOOD.chainId,
    "account_acquisitions",
    [acquisition],
    { streamDefinition: { topics: [ACCOUNT_ACQUISITION_TOPIC] } },
  );
  assert.equal(database.rawLogs.size, 1);
  assert.equal(database.acquisitions.size, 0);

  await repository.insertLogs(
    ROBINHOOD.chainId,
    "account_activations",
    [activationLog()],
    {
      streamDefinition: {
        address: REGISTRY,
        implementation: IMPLEMENTATION,
        topics: [ACCOUNT_ACTIVATION_TOPIC],
      },
    },
  );
  assert.equal(database.punks.size, 1);
  assert.equal(database.acquisitions.size, 1);
  assert.equal([...database.acquisitions.values()][0].transaction_hash, TX_HASH);

  await repository.insertLogs(
    ROBINHOOD.chainId,
    "account_activations",
    [activationLog()],
    {
      streamDefinition: {
        address: REGISTRY,
        implementation: IMPLEMENTATION,
        topics: [ACCOUNT_ACTIVATION_TOPIC],
      },
    },
  );
  assert.equal(database.punks.size, 1);
  assert.equal(database.acquisitions.size, 1);
});

test("confirmed Scout registry reconciliation backfills a pre-created account without activation", async () => {
  const database = new AccountIndexerDatabase();
  const acquisition = acquisitionLog();
  await new PostgresIndexerRepository(database).insertLogs(
    ROBINHOOD.chainId,
    "account_acquisitions",
    [acquisition],
    { streamDefinition: { topics: [ACCOUNT_ACQUISITION_TOPIC] } },
  );
  assert.equal(database.acquisitions.size, 0);

  await new PostgresScoutRepository(database).upsertPunk({
    tokenId: "317",
    owner: OWNER,
    ownerBlock: "4660",
    personaKey: "PIXEL_MAXI",
    accountAddress: PUNK_ACCOUNT,
    accountVersion: "1",
    accountObservedBlock: "4660",
    accountObservedBlockHash: BLOCK_HASH,
  });
  assert.equal(database.punks.size, 1);
  assert.equal(database.acquisitions.size, 1);
  assert.equal([...database.acquisitions.values()][0].transaction_hash, TX_HASH);
  const scoutUpsert = database.calls.find((call) => (
    call.sql.includes("INSERT INTO broker_punks")
    && call.values.includes("REGISTRY_RECONCILIATION")
  ));
  assert.match(scoutUpsert.sql, /owner_snapshot_block <= EXCLUDED\.owner_snapshot_block/);
  assert.match(scoutUpsert.sql, /indexed_through_block = GREATEST/);
  assert.match(scoutUpsert.sql, /account_observed_block_number\s+>=/);
});

test("repository rewind clears derived acquisitions, account authority snapshots, and raw state", async () => {
  const calls = [];
  const repository = new PostgresIndexerRepository({
    async query(sql, values = []) {
      calls.push({ sql, values });
      return { rowCount: 1, rows: [] };
    },
  });
  await repository.rewind(ROBINHOOD.chainId, "account_acquisitions", 4660n);

  const acquisitionDelete = calls.find((call) => (
    call.sql.includes("DELETE FROM broker_acquisitions")
  ));
  assert.match(acquisitionDelete.sql, /chain_id = \$1 AND block_number >= \$2/);

  const accountClear = calls.find((call) => (
    call.sql.includes("SET account_address = NULL")
  ));
  assert.match(accountClear.sql, /account_version = NULL/);
  assert.match(accountClear.sql, /account_observation_source = NULL/);
  assert.match(accountClear.sql, /account_observed_block_hash = NULL/);
  assert.match(accountClear.sql, /account_activation_transaction_hash = NULL/);
  assert.match(accountClear.sql, /account_observed_block_number >= \$2/);

  const ownerClear = calls.find((call) => (
    call.sql.includes("SET owner_snapshot = NULL")
  ));
  assert.match(ownerClear.sql, /owner_snapshot_block = NULL/);
  assert.match(ownerClear.sql, /owner_snapshot_block >= \$2/);

  const rawDelete = calls.find((call) => (
    call.sql.includes("DELETE FROM broker_indexed_logs")
  ));
  assert.match(rawDelete.sql, /chain_id = \$1 AND block_number >= \$2/);
  const checkpointDelete = calls.find((call) => (
    call.sql.includes("DELETE FROM broker_indexer_checkpoints")
  ));
  assert.match(checkpointDelete.sql, /WHERE chain_id = \$1/);
  for (const call of [
    acquisitionDelete,
    accountClear,
    ownerClear,
    rawDelete,
  ]) assert.deepEqual(call.values, [ROBINHOOD.chainId, "4660"]);
  assert.deepEqual(checkpointDelete.values, [ROBINHOOD.chainId]);
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls.at(-1).sql, "COMMIT");
});

test("ordered migrations constrain acquisition provenance and account observations", async () => {
  const [acquisitionMigration, accountMigration] = await Promise.all([
    readFile(new URL(
      "../../netlify/database/migrations/20260820204800_add_acquisition_provenance.sql",
      import.meta.url,
    ), "utf8"),
    readFile(new URL(
      "../../netlify/database/migrations/20260820204900_add_punk_account_observation.sql",
      import.meta.url,
    ), "utf8"),
  ]);
  for (const column of [
    "opportunity_id",
    "opportunity_type",
    "asset_standard",
    "adapter_address",
    "executor_address",
    "owner_approved",
    "acquisition_nonce",
    "state_sequence",
  ]) assert.match(acquisitionMigration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  assert.match(acquisitionMigration, /opportunity_id = LOWER\(opportunity_id\)/);
  assert.match(acquisitionMigration, /adapter_address = LOWER\(adapter_address\)/);
  assert.match(acquisitionMigration, /executor_address = LOWER\(executor_address\)/);
  assert.match(acquisitionMigration, /opportunity_type IN/);
  assert.match(acquisitionMigration, /asset_standard IN \('ERC721', 'ERC1155'\)/);
  assert.match(acquisitionMigration, /acquisition_nonce IS NULL OR acquisition_nonce >= 0/);
  assert.match(acquisitionMigration, /state_sequence IS NULL OR state_sequence >= 0/);
  assert.match(acquisitionMigration, /broker_acquisitions_punk_time_idx/);
  assert.match(acquisitionMigration, /broker_punks_chain_account_identity_idx/);
  assert.match(acquisitionMigration, /ON broker_punks \(chain_id, account_address\)/);
  assert.match(acquisitionMigration, /WHERE account_address IS NOT NULL/);
  assert.match(acquisitionMigration, /broker_acquisitions_reasoning_hash_nonzero/);
  assert.match(acquisitionMigration, /reasoning_hash <>/);
  assert.match(acquisitionMigration, /opportunity_id <>/);

  assert.match(accountMigration, /account_observation_source/);
  assert.match(accountMigration, /'ACTIVATION_EVENT', 'REGISTRY_RECONCILIATION'/);
  assert.match(accountMigration, /broker_indexed_logs_account_emitter_idx/);
  assert.match(accountMigration, /WHERE stream = 'account_acquisitions'/);
});

test("materialized acquisition identities are eligible for the metadata queue", async () => {
  const database = new AccountIndexerDatabase();
  database.punks.set(
    database.punkKey(ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, "317"),
    {
      chain_id: ROBINHOOD.chainId,
      collection_address: ROBINHOOD.canonicalCollection,
      token_id: "317",
      account_address: PUNK_ACCOUNT,
      account_version: 1,
      owner_snapshot: OWNER,
    },
  );
  await new PostgresIndexerRepository(database).insertLogs(
    ROBINHOOD.chainId,
    "account_acquisitions",
    [acquisitionLog()],
    { streamDefinition: { topics: [ACCOUNT_ACQUISITION_TOPIC] } },
  );
  const stored = [...database.acquisitions.values()][0];
  const metadataCalls = [];
  const metadata = new PostgresMetadataRepository({
    async query(sql, values) {
      metadataCalls.push({ sql, values });
      return {
        rows: [{
          chain_id: stored.chain_id,
          collection_address: stored.nft_collection_address,
          token_id: stored.nft_token_id,
          priority: 1,
        }],
      };
    },
  });
  const candidates = await metadata.pendingCandidates(ROBINHOOD.chainId, { limit: 12 });
  assert.deepEqual(candidates, [{
    chainId: ROBINHOOD.chainId,
    collection: NFT_COLLECTION,
    tokenId: "901",
    priority: 1,
  }]);
  assert.match(metadataCalls[0].sql, /FROM broker_acquisitions AS acquisition/);
  assert.match(metadataCalls[0].sql, /acquisition\.nft_collection_address/);
  assert.match(metadataCalls[0].sql, /acquisition\.nft_token_id/);
  assert.match(metadataCalls[0].sql, /1 AS priority/);
});
