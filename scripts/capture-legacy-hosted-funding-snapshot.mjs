import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { createPublicClient, getAddress, http, parseAbi } from "viem";

import { resolveRobinhoodRpcPair } from
  "../broker/src/infrastructure/robinhood-rpc-endpoints.mjs";
import { publicAutomationV3AgentLanes } from
  "../netlify/functions/_shared/automation-v3-agent-pool.mjs";
import automationManifest from "../deployments/robinhood-automation-v3.json" with { type: "json" };

const COLLECTION = getAddress("0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6");
const OWNER_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);
const ACCOUNT_ABI = parseAbi(["function owner() view returns (address)"]);
const REGISTRY_ABI = parseAbi(["function account(uint256 tokenId) view returns (address)"]);
const ACCOUNT_REGISTRY = getAddress(
  automationManifest.contracts.GoghPunkAccountRegistryV3.address,
);

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

if (process.argv.includes("--broadcast") || process.argv.includes("--apply")) {
  throw new Error("This snapshot tool is read-only and has no broadcast mode.");
}
if (!/^postgres(?:ql)?:\/\//.test(process.env.SUPABASE_DATABASE_URL ?? "")) {
  throw new Error("SUPABASE_DATABASE_URL is required");
}
if (!/^postgres(?:ql)?:\/\//.test(process.env.NETLIFY_DATABASE_READONLY_URL ?? "")) {
  throw new Error("NETLIFY_DATABASE_READONLY_URL is required");
}

function rpcClient(url) {
  return createPublicClient({ transport: http(url, { retryCount: 2, retryDelay: 300,
    timeout: 12_000 }) });
}

const { primary, secondary } = resolveRobinhoodRpcPair(process.env);
const clients = [rpcClient(primary), rpcClient(secondary)];
const supabase = new pg.Pool({ connectionString: process.env.SUPABASE_DATABASE_URL, max: 1 });
const operational = new pg.Pool({ connectionString: process.env.NETLIFY_DATABASE_READONLY_URL,
  max: 1, ssl: { rejectUnauthorized: false } });

async function matching(read, label) {
  const values = await Promise.all(clients.map(read));
  if (JSON.stringify(values[0]) !== JSON.stringify(values[1])) {
    throw new Error(`${label} providers disagree`);
  }
  return values[0];
}

async function transactionEvidence(transactionHash) {
  return matching(async (client) => {
    const [transaction, receipt] = await Promise.all([
      client.getTransaction({ hash: transactionHash }),
      client.getTransactionReceipt({ hash: transactionHash }),
    ]);
    return {
      status: receipt.status === "success" ? "CONFIRMED" : "REVERTED",
      transactionHash: transaction.hash.toLowerCase(),
      from: transaction.from.toLowerCase(),
      to: transaction.to?.toLowerCase() ?? null,
      valueWei: transaction.value.toString(),
      input: transaction.input.toLowerCase(),
      blockNumber: transaction.blockNumber?.toString() ?? null,
      gasCostWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    };
  }, `transaction ${transactionHash}`);
}

try {
  const [depositsResult, accountsResult, usageResult, refundsResult] = await Promise.all([
    supabase.query(`SELECT transaction_hash, punk_token_id::text, owner_address,
      agent_address, amount_wei::text, confirmed_at
      FROM gogh_broker_punk_agent_gas_deposits ORDER BY confirmed_at, transaction_hash`),
    supabase.query(`SELECT punk_token_id::text, owner_snapshot, credited_wei::text,
      spent_wei::text FROM gogh_broker_punk_agent_gas_accounts ORDER BY punk_token_id`),
    supabase.query(`SELECT transaction_hash, punk_token_id::text, actual_cost_wei::text,
      charged_wei::text FROM gogh_broker_punk_agent_gas_usage
      ORDER BY occurred_at, transaction_hash`),
    supabase.query(`SELECT punk_token_id::text, requested_wei::text, state, transaction_hash
      FROM gogh_broker_punk_agent_gas_refunds ORDER BY created_at, refund_id`),
  ]);
  const tokenIds = accountsResult.rows.map(({ punk_token_id: value }) => value);
  const accounts = await operational.query(`SELECT token_id::text, account_address
    FROM broker_punks WHERE chain_id = 4663
      AND collection_address = $1 AND token_id = ANY($2::numeric[])`,
  [COLLECTION.toLowerCase(), tokenIds]);
  const heads = await Promise.all(clients.map((client) => client.getBlockNumber()));
  if (heads.some((head) => typeof head !== "bigint" || head < 3n)) {
    throw new Error("latest block is unavailable");
  }
  const [lowestHead, highestHead] = heads[0] <= heads[1]
    ? [heads[0], heads[1]] : [heads[1], heads[0]];
  if (highestHead - lowestHead > 120n) {
    throw new Error("latest block providers are too far apart");
  }
  // Provider heads routinely differ by a few blocks. Pin every ownership and balance read to
  // one block both providers already report, with a short confirmation margin, instead of
  // requiring their transient latest-head values to be identical.
  const snapshotBlock = lowestHead - 2n;
  const accountByPunk = new Map(accounts.rows.flatMap((row) => (
    typeof row.account_address === "string" && /^0x[0-9a-f]{40}$/i.test(row.account_address)
      ? [[row.token_id, getAddress(row.account_address)]] : []
  )));
  const currentOwners = {};
  const punkWallets = {};
  for (const selectedTokenId of tokenIds) {
    const indexedAccount = accountByPunk.get(selectedTokenId) ?? null;
    const resolved = await matching(async (client) => {
      const [punkOwner, account] = await Promise.all([
        client.readContract({ address: COLLECTION, abi: OWNER_ABI, functionName: "ownerOf",
          args: [BigInt(selectedTokenId)], blockNumber: snapshotBlock }),
        client.readContract({ address: ACCOUNT_REGISTRY, abi: REGISTRY_ABI,
          functionName: "account", args: [BigInt(selectedTokenId)], blockNumber: snapshotBlock }),
      ]);
      const [accountOwner, code] = await Promise.all([
        client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "owner",
          blockNumber: snapshotBlock }),
        client.getCode({ address: account, blockNumber: snapshotBlock }),
      ]);
      return { punkOwner: punkOwner.toLowerCase(), accountOwner: accountOwner.toLowerCase(),
        account: account.toLowerCase(),
        codePresent: typeof code === "string" && code !== "0x" };
    }, `Punk #${selectedTokenId} ownership`);
    const indexedAccountMatches = indexedAccount === null
      || indexedAccount.toLowerCase() === resolved.account;
    if (resolved.codePresent && resolved.punkOwner === resolved.accountOwner
      && indexedAccountMatches) {
      currentOwners[selectedTokenId] = resolved.punkOwner;
      punkWallets[selectedTokenId] = resolved.account;
    }
  }
  const depositEvidence = {};
  for (const row of depositsResult.rows) {
    depositEvidence[row.transaction_hash] = await transactionEvidence(row.transaction_hash);
  }
  const usageEvidence = {};
  for (const row of usageResult.rows) {
    usageEvidence[row.transaction_hash] = await transactionEvidence(row.transaction_hash);
  }
  const hostedWallets = [];
  for (const lane of publicAutomationV3AgentLanes(process.env)) {
    // PublicNode permits the pinned contract-state reads above but requires a paid token for
    // historical native-balance reads. Require both independent providers to return the exact
    // same latest balance instead; any concurrent spend or head-sensitive mismatch fails closed.
    const balanceWei = await matching((client) => client.getBalance({
      address: getAddress(lane.address),
    }).then(String), `lane ${lane.laneId} balance`);
    hostedWallets.push({ laneId: lane.laneId, address: lane.address, balanceWei });
  }
  const snapshot = {
    schema: "GOGH_LEGACY_HOSTED_FUNDING_SNAPSHOT_V1", version: 1,
    generatedAt: new Date().toISOString(), snapshotBlock: snapshotBlock.toString(),
    providerHeads: heads.map(String), hostedBalancesObservedAt: new Date().toISOString(),
    hostedHistoryComplete: false,
    historyBlocker: "COMPLETE_HOSTED_WALLET_TRANSACTION_INDEX_REQUIRED",
    deposits: depositsResult.rows,
    accounts: accountsResult.rows,
    usage: usageResult.rows,
    refunds: refundsResult.rows,
    currentOwners, punkWallets, depositEvidence, usageEvidence, hostedWallets,
  };
  const output = `${JSON.stringify(snapshot, null, 2)}\n`;
  const outputPath = option("--output");
  if (outputPath) {
    await writeFile(resolve(outputPath), output, { encoding: "utf8", flag: "wx", mode: 0o600 });
    process.stdout.write(JSON.stringify({ readOnly: true, output: resolve(outputPath),
      snapshotBlock: snapshot.snapshotBlock, deposits: snapshot.deposits.length,
      accounts: snapshot.accounts.length, usage: snapshot.usage.length,
      hostedHistoryComplete: false }, null, 2));
  } else {
    process.stdout.write(output);
  }
} finally {
  await Promise.all([supabase.end(), operational.end()]);
}
