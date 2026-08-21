import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const requiredDocs = [
  "GOGH_PUNK_ACCOUNTS.md",
  "ART_BROKER_ARCHITECTURE.md",
  "ROBINHOOD_INFRASTRUCTURE.md",
  "ART_MANDATE.md",
  "BROKER_POLICY.md",
  "AGENT_SECURITY.md",
  "NFT_DISCOVERY.md",
  "MARKETPLACE_ADAPTERS.md",
  "MINT_SECURITY.md",
  "AI_TRUST_BOUNDARY.md",
  "THREAT_MODEL.md",
  "CANARY.md",
  "DEPLOYMENT.md",
  "OWNER_GUIDE.md",
];

for (const name of requiredDocs) {
  const content = readFileSync(resolve(root, "docs", name), "utf8");
  if (content.trim().length < 100) throw new Error(`${name} is unexpectedly empty`);
}

const deployment = JSON.parse(
  readFileSync(resolve(root, "deployments/robinhood.json"), "utf8"),
);
if (deployment.status !== "NOT_DEPLOYED") throw new Error("deployment must remain NOT_DEPLOYED");
if (deployment.sourceVerificationAdoption !== null) {
  throw new Error("undeployed manifest must not contain a source-verification adoption");
}
if (deployment.chain.chainId !== 4663) throw new Error("wrong deployment chain");
if (deployment.canonicalCollection.toLowerCase()
  !== "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6") {
  throw new Error("wrong canonical collection");
}
const seaport = deployment.verifiedExternalInfrastructure?.seaport;
if (
  seaport?.address !== "0x0000000000000068f116a894984e2db1123eb395"
  || seaport?.deploymentBlock !== 605917
  || !/^0x[0-9a-f]{64}$/.test(seaport?.runtimeCodeHash ?? "")
  || seaport?.verificationStatus !== "VERIFIED_READ_ONLY_SCOUT"
  || seaport?.executionApproved !== false
) {
  throw new Error("Seaport read-only trust record is invalid");
}
for (const [name, record] of Object.entries(deployment.contracts)) {
  for (const field of [
    "address",
    "deploymentTransaction",
    "deploymentBlock",
    "deployer",
    "constructorArguments",
    "creationBytecodeHash",
    "runtimeBytecodeHash",
    "gitCommit",
    "verificationStatus",
  ]) {
    if (!Object.hasOwn(record, field)) throw new Error(`${name} manifest missing ${field}`);
  }
  if (record.address !== null) throw new Error(`${name} unexpectedly has a deployed address`);
}
for (const [name, enabled] of Object.entries(deployment.featureFlags)) {
  const expected = name === "ENABLE_SCOUT_MODE";
  if (enabled !== expected) throw new Error(`${name} violates production default`);
}

const brokerClient = readFileSync(resolve(root, "site/broker.js"), "utf8");
const walletClient = readFileSync(resolve(root, "site/wallet.js"), "utf8");
for (const requiredReadOnlyWalletAction of ["eth_requestAccounts", "eth_chainId"]) {
  if (!walletClient.includes(requiredReadOnlyWalletAction)) {
    throw new Error(`read-only wallet client is missing ${requiredReadOnlyWalletAction}`);
  }
}
for (const forbiddenWalletAction of [
  "eth_sendTransaction",
  "eth_sign",
  "personal_sign",
  "wallet_requestPermissions",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
]) {
  if (`${brokerClient}\n${walletClient}`.includes(forbiddenWalletAction)) {
    throw new Error(`undeployed broker client exposes ${forbiddenWalletAction}`);
  }
}

const migration = readFileSync(
  resolve(root, "netlify/database/migrations/20260817224000_create_art_broker_foundation.sql"),
  "utf8",
);
for (const table of [
  "broker_punks",
  "broker_art_mandates",
  "broker_agent_authorizations",
  "broker_opportunities",
  "broker_recommendations",
  "broker_proposals",
  "broker_acquisitions",
  "broker_decision_logs",
  "broker_owner_private_settings",
  "broker_indexer_checkpoints",
]) {
  if (!migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) {
    throw new Error(`migration missing ${table}`);
  }
}

const scoutProjectionMigration = readFileSync(
  resolve(
    root,
    "netlify/database/migrations/20260817224100_add_scout_source_provenance.sql",
  ),
  "utf8",
);
for (const requirement of [
  "source_block_number",
  "source_transaction_hash",
  "canonical BOOLEAN NOT NULL DEFAULT TRUE",
  "Historical Scout sale observations must store zero",
]) {
  if (!scoutProjectionMigration.includes(requirement)) {
    throw new Error(`Scout projection migration missing ${requirement}`);
  }
}

const analysisMigration = readFileSync(
  resolve(
    root,
    "netlify/database/migrations/20260817224200_add_collection_analysis_state.sql",
  ),
  "utf8",
);
for (const requirement of [
  "analysis_attempted_at",
  "analysis_failure JSONB NOT NULL DEFAULT '{}'",
  "analysis_block_hash CHAR(66)",
  "Never store provider secrets",
]) {
  if (!analysisMigration.includes(requirement)) {
    throw new Error(`Collection analysis migration missing ${requirement}`);
  }
}

const collectionSignalsMigration = readFileSync(
  resolve(
    root,
    "netlify/database/migrations/20260817224300_add_collection_signal_state.sql",
  ),
  "utf8",
);
for (const requirement of [
  "source_block_timestamp TIMESTAMPTZ",
  "broker_collection_signal_snapshots",
  "Never substitute index insertion time",
  "cannot authorize execution",
]) {
  if (!collectionSignalsMigration.includes(requirement)) {
    throw new Error(`Collection signal migration missing ${requirement}`);
  }
}

const metadataMigration = readFileSync(
  resolve(
    root,
    "netlify/database/migrations/20260820204500_create_broker_nft_metadata.sql",
  ),
  "utf8",
);
for (const requirement of [
  "CREATE TABLE IF NOT EXISTS broker_nft_metadata",
  "PRIMARY KEY (chain_id, collection_address, token_id)",
  "display_image_url LIKE 'https://i.seadn.io/%'",
  "Never authoritative for ownership, execution, price, or safety",
]) {
  if (!metadataMigration.includes(requirement)) {
    throw new Error(`NFT metadata migration missing ${requirement}`);
  }
}

const environmentExample = readFileSync(resolve(root, ".env.example"), "utf8");
for (const requirement of [
  "BROKER_INDEXER_ENABLED=false",
  "BROKER_ANALYZER_ENABLED=false",
  "BROKER_INDEX_FROM_BLOCK_GOGH_PUNK_TRANSFERS=31277277",
  "BROKER_INDEX_FROM_BLOCK_SEAPORT_ACTIVITY=605917",
  "BROKER_INDEX_MAX_BLOCKS_PER_RUN=10000",
  "BROKER_INDEX_STREAMS=gogh_punk_transfers,seaport_activity",
  "BROKER_ANALYSIS_ACTIVITY_LIMIT=200",
  "BROKER_METADATA_ENABLED=false",
  "BROKER_METADATA_BATCH_SIZE=12",
]) {
  if (!environmentExample.includes(requirement)) {
    throw new Error(`Art Broker environment defaults missing ${requirement}`);
  }
}

console.log(
  `PASS Art Broker manifest, ${requiredDocs.length} required docs, fail-closed flags, and database entities`,
);
