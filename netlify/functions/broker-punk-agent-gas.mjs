import { createPublicClient, getAddress, http } from "viem";

import { resolveRobinhoodRpcPair } from
  "../../broker/src/infrastructure/robinhood-rpc-endpoints.mjs";
import { json, PublicError, readJson } from "./_shared/http.mjs";
import {
  AUTOMATION_V3_AGENT, readAutomationV3PunkState,
} from "./_shared/autonomy-v3-live.mjs";
import {
  requireAutomationV3RunOrigin, runSelectedAutomationV3,
} from "./broker-autonomy-v3-run.mjs";
import {
  forwardProductionAutomationV3Run, isDeployPreview,
} from "./_shared/automation-v3-production-bridge.mjs";
import {
  getPrepaidPunkAgentGasBalance, prepaidPunkAgentGasConfiguration,
  recordPrepaidPunkAgentGasCredit,
} from "./_shared/supabase-operational-store.mjs";

const MINIMUM_WEI = 100_000_000_000_000n; // 0.0001 ETH
const MAXIMUM_WEI = 50_000_000_000_000_000n; // 0.05 ETH
const RECOMMENDED_WEI = "500000000000000"; // 0.0005 ETH

function tokenId(value) {
  const normalized = String(value ?? "");
  if (!/^(?:0|[1-9][0-9]{0,3})$/.test(normalized)) {
    throw new PublicError(400, "INVALID_PUNK", "Choose a valid Gogh Punk.");
  }
  return normalized;
}

function address(value, name) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new PublicError(400, "INVALID_REQUEST", `${name} is invalid.`);
  }
  return value.toLowerCase();
}

function hash(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new PublicError(400, "INVALID_TRANSACTION", "The funding transaction is invalid.");
  }
  return value.toLowerCase();
}

function amount(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,76}$/.test(value)) {
    throw new PublicError(400, "INVALID_AMOUNT", "Choose a valid prepaid gas amount.");
  }
  const selected = BigInt(value);
  if (selected < MINIMUM_WEI || selected > MAXIMUM_WEI) {
    throw new PublicError(400, "INVALID_AMOUNT", "Prepaid gas must be between 0.0001 and 0.05 ETH.");
  }
  return selected;
}

function ensureConfiguration(environment) {
  const configuration = prepaidPunkAgentGasConfiguration(environment);
  if (!configuration.configured
    || configuration.agentAddress !== AUTOMATION_V3_AGENT) {
    throw new PublicError(
      503,
      "PREPAID_GAS_UNAVAILABLE",
      "Per-Punk prepaid agent gas is temporarily unavailable. No funding transaction was requested.",
    );
  }
}

async function activePunk(selectedTokenId, expectedOwner, readPunk) {
  const punk = await readPunk(selectedTokenId);
  if (punk?.tokenId !== selectedTokenId || punk?.created !== true || punk?.active !== true) {
    throw new PublicError(409, "PUNK_AUTOMATION_INACTIVE",
      `Punk #${selectedTokenId} must be activated before its agent can be prepaid.`);
  }
  if (punk.owner !== expectedOwner) {
    throw new PublicError(409, "OWNER_CHANGED", "Control of this Punk changed. Refresh before funding.");
  }
  return punk;
}

function client(rpcUrl) {
  return createPublicClient({ transport: http(rpcUrl, {
    retryCount: 1, retryDelay: 500, timeout: 10_000,
  }) });
}

function normalizeEvidence(transaction, receipt) {
  if (receipt?.status !== "success" || transaction?.blockNumber == null
    || receipt.blockNumber !== transaction.blockNumber) {
    throw new PublicError(409, "TRANSACTION_UNCONFIRMED",
      "The prepaid gas transaction is not confirmed successfully yet.");
  }
  return Object.freeze({
    from: getAddress(transaction.from).toLowerCase(),
    to: transaction.to == null ? null : getAddress(transaction.to).toLowerCase(),
    value: BigInt(transaction.value).toString(),
    input: String(transaction.input ?? "0x").toLowerCase(),
    blockNumber: BigInt(transaction.blockNumber).toString(),
  });
}

async function readTransactionEvidence(transactionHash, environment) {
  const { primary, secondary } = resolveRobinhoodRpcPair(environment);
  const evidence = await Promise.all([primary, secondary].map(async (rpcUrl) => {
    const rpc = client(rpcUrl);
    const [transaction, receipt] = await Promise.all([
      rpc.getTransaction({ hash: transactionHash }),
      rpc.getTransactionReceipt({ hash: transactionHash }),
    ]);
    return normalizeEvidence(transaction, receipt);
  }));
  if (JSON.stringify(evidence[0]) !== JSON.stringify(evidence[1])) {
    throw new PublicError(503, "RPC_DISAGREEMENT",
      "Robinhood RPC providers have not agreed on this funding transaction yet. Try again shortly.");
  }
  return evidence[0];
}

export async function prepaidAgentGasStatus(selectedTokenId, expectedOwner, dependencies = {}) {
  const environment = dependencies.environment ?? process.env;
  ensureConfiguration(environment);
  const normalizedTokenId = tokenId(selectedTokenId);
  const owner = address(expectedOwner, "Punk owner");
  const readPunk = dependencies.readPunk ?? ((id) => readAutomationV3PunkState(id, environment));
  await activePunk(normalizedTokenId, owner, readPunk);
  const balance = await (dependencies.getBalance ?? getPrepaidPunkAgentGasBalance)(
    normalizedTokenId, { environment, database: dependencies.database },
  );
  if (balance.available !== true) {
    throw new PublicError(503, "PREPAID_GAS_UNAVAILABLE", "Per-Punk agent gas balance is unavailable.");
  }
  return Object.freeze({
    tokenId: normalizedTokenId,
    owner,
    agent: AUTOMATION_V3_AGENT,
    recommendedWei: RECOMMENDED_WEI,
    minimumWei: MINIMUM_WEI.toString(),
    maximumWei: MAXIMUM_WEI.toString(),
    availableWei: balance.availableWei,
    updatedAt: balance.updatedAt,
  });
}

export async function confirmPrepaidAgentGas(body, dependencies = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).sort().join(",") !== "amountWei,owner,tokenId,transactionHash") {
    throw new PublicError(400, "INVALID_REQUEST", "The prepaid gas confirmation is invalid.");
  }
  const environment = dependencies.environment ?? process.env;
  ensureConfiguration(environment);
  const selectedTokenId = tokenId(body.tokenId);
  const owner = address(body.owner, "Punk owner");
  const amountWei = amount(body.amountWei);
  const transactionHash = hash(body.transactionHash);
  const readPunk = dependencies.readPunk ?? ((id) => readAutomationV3PunkState(id, environment));
  await activePunk(selectedTokenId, owner, readPunk);
  const evidence = await (dependencies.readTransaction ?? readTransactionEvidence)(
    transactionHash, environment,
  );
  if (evidence.from !== owner || evidence.to !== AUTOMATION_V3_AGENT
    || evidence.value !== amountWei.toString() || evidence.input !== "0x") {
    throw new PublicError(409, "FUNDING_MISMATCH",
      "The confirmed transaction does not exactly fund this Punk's fixed hosted agent.");
  }
  // Ownership is checked again after receipt verification so a transfer during confirmation
  // cannot credit or queue an agent for the previous holder.
  await activePunk(selectedTokenId, owner, readPunk);
  const credit = await (dependencies.recordCredit ?? recordPrepaidPunkAgentGasCredit)({
    tokenId: selectedTokenId,
    owner,
    agent: AUTOMATION_V3_AGENT,
    amountWei: amountWei.toString(),
    transactionHash,
    blockNumber: evidence.blockNumber,
    confirmedAt: new Date().toISOString(),
  }, { environment, database: dependencies.database });
  let run;
  try {
    run = await (dependencies.runNow ?? runSelectedAutomationV3)({ tokenId: selectedTokenId }, {
      readPunk,
      ...(dependencies.runOnce ? { runOnce: dependencies.runOnce } : {}),
      ...(dependencies.enroll ? { enroll: dependencies.enroll } : {}),
    });
  } catch {
    run = Object.freeze({ tokenId: selectedTokenId, status: "QUEUED", submitted: 0,
      collection: null, transactionHash: null });
  }
  return Object.freeze({ tokenId: selectedTokenId, credit, run });
}

export default async function handler(request) {
  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const status = await prepaidAgentGasStatus(
        url.searchParams.get("tokenId"), url.searchParams.get("owner"),
      );
      return json({ ok: true, prepaidAgentGas: status }, 200, {
        "netlify-cdn-cache-control": "no-store",
      });
    }
    if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
    requireAutomationV3RunOrigin(request, process.env);
    const preview = isDeployPreview(process.env, request.url);
    const result = await confirmPrepaidAgentGas(await readJson(request, 2_048), preview ? {
      runNow: async (body) => {
        const forwarded = await forwardProductionAutomationV3Run(body);
        if (!forwarded.ok) {
          throw new PublicError(forwarded.status, forwarded.code, forwarded.message);
        }
        return forwarded.run;
      },
    } : {});
    return json({ ok: true, prepaidAgentGas: result },
      result.run?.status === "RUN_IN_PROGRESS" || result.run?.status === "QUEUED" ? 202 : 200,
      { "netlify-cdn-cache-control": "no-store" });
  } catch (error) {
    if (error instanceof PublicError) {
      return json({ ok: false, code: error.code, message: error.message }, error.status);
    }
    console.error(JSON.stringify({
      event: "PUNK_AGENT_GAS_FAILED",
      code: typeof error?.code === "string" ? error.code : "FAILED",
    }));
    return json({ ok: false, code: "PREPAID_GAS_FAILED",
      message: "Per-Punk prepaid agent gas stopped safely. No new transaction was requested." }, 503);
  }
}

export const config = {
  path: "/api/broker/punk-agent-gas",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip"], windowLimit: 8, windowSize: 60 },
};
