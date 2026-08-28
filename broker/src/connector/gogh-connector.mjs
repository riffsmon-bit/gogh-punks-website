import { snapshotExactRecord } from "../control-center/strict-record.mjs";
import { evaluateScoutingSchedule, normalizeScoutingSchedule } from "./scouting-schedule.mjs";

const TOKEN_ID = /^(?:0|[1-9][0-9]{0,3})$/;
const INTENT_ID = /^mint_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const CONNECTOR_TOOL_DEFINITIONS = Object.freeze([
  { name: "list_my_punks", scope: "punk:read", description: "List the authenticated wallet's current Gogh Punks." },
  { name: "get_punk_status", scope: "punk:read", description: "Read one Punk's wallet, limits, usage, and agent status." },
  { name: "get_punk_wallet", scope: "punk:read", description: "Read one Punk's deterministic wallet address." },
  { name: "get_punk_portfolio", scope: "punk:read", description: "Read one Punk wallet's indexed portfolio summary." },
  { name: "get_agent_status", scope: "agent:read", description: "Read one Punk's heartbeat and scouting schedule." },
  { name: "send_agent_scouting", scope: "agent:scout", description: "Queue the existing bounded worker for one Punk." },
  { name: "inspect_opensea_mint", scope: "mint:inspect", description: "Read and validate a supported OpenSea drop." },
  { name: "prepare_directed_mint", scope: "mint:directed", description: "Create a short-lived, simulated mint intent." },
  { name: "execute_directed_mint", scope: "mint:directed", description: "Revalidate and simulate a stored mint intent." },
  { name: "pause_agent", scope: "agent:pause", description: "Pause a Punk's connector-controlled local schedule." },
  { name: "resume_agent", scope: "agent:pause", description: "Resume a Punk's connector-controlled local schedule." },
  { name: "set_scouting_schedule", scope: "agent:scout", description: "Set the exact UTC window in which scouting is allowed." },
]);

export class GoghConnectorError extends Error {
  constructor(code, message) { super(message); this.name = "GoghConnectorError"; this.code = code; }
}
function fail(code, message) { throw new GoghConnectorError(code, message); }
function tokenId(value) {
  if (typeof value !== "string" || !TOKEN_ID.test(value)) fail("INVALID_TOKEN_ID", "Choose a valid Punk.");
  return value;
}
function exact(value, keys, label) {
  try { return snapshotExactRecord(value, keys, label); }
  catch { fail("INVALID_ARGUMENTS", `${label} is invalid.`); }
}
function requireTool(name) {
  if (typeof name !== "string") fail("UNKNOWN_TOOL", "Connector tool is invalid.");
  const found = CONNECTOR_TOOL_DEFINITIONS.find((tool) => tool.name === name);
  if (!found) fail("UNKNOWN_TOOL", `Connector tool ${name} is not supported.`);
  return found;
}
export class GoghConnector {
  #auth;
  #store;
  #deps;
  #clock;
  #executionMode;

  constructor({ auth, store, dependencies, clock = () => Date.now(), executionMode = "simulate" }) {
    if (!auth || !store || !dependencies || typeof dependencies !== "object"
      || typeof clock !== "function" || !["simulate", "production"].includes(executionMode)) {
      throw new TypeError("connector dependencies are invalid");
    }
    this.#auth = auth;
    this.#store = store;
    this.#deps = dependencies;
    this.#clock = clock;
    this.#executionMode = executionMode;
  }

  async call({ accessToken, tool: rawTool, arguments: rawArguments, idempotencyKey = null }) {
    const tool = requireTool(rawTool);
    const args = rawArguments ?? {};
    const selectedTokenId = Object.hasOwn(args, "tokenId") ? tokenId(args.tokenId) : null;
    const principal = this.#auth.require(accessToken, tool.scope, selectedTokenId);
    this.#store.rateLimit(`${principal.wallet}:${rawTool}`, rawTool.includes("mint") ? 8 : 30);
    const operation = async () => {
      let result;
      try {
        result = await this.#dispatch(rawTool, args, principal);
        this.#store.recordAudit({ wallet: principal.wallet, tokenId: selectedTokenId,
          command: rawTool, result: "OK", intentId: result?.intentId ?? null,
          transactionHash: null, source: "Connector" });
      } catch (error) {
        this.#store.recordAudit({ wallet: principal.wallet, tokenId: selectedTokenId,
          command: rawTool, result: error?.code ?? "FAILED", intentId: null,
          transactionHash: null, source: "Connector" });
        throw error;
      }
      return Object.freeze({ ok: true, tool: rawTool, executionMode: this.#executionMode,
        message: result.message, result });
    };
    const mutating = ["send_agent_scouting", "prepare_directed_mint", "execute_directed_mint",
      "pause_agent", "resume_agent", "set_scouting_schedule"].includes(rawTool);
    return mutating ? this.#store.idempotent(idempotencyKey, operation) : operation();
  }

  async #dispatch(name, args, principal) {
    if (name === "list_my_punks") {
      exact(args, [], "list arguments");
      const punks = await this.#deps.listPunks(principal.wallet);
      return Object.freeze({ message: `Found ${punks.length} currently indexed Gogh Punks.`, punks });
    }
    if (name === "get_punk_status" || name === "get_punk_wallet"
      || name === "get_punk_portfolio" || name === "get_agent_status") {
      const { tokenId: id } = exact(args, ["tokenId"], "read arguments");
      const map = { get_punk_status: "getPunkStatus", get_punk_wallet: "getPunkWallet",
        get_punk_portfolio: "getPunkPortfolio", get_agent_status: "getAgentStatus" };
      const result = await this.#deps[map[name]](tokenId(id), principal.wallet);
      const schedule = name === "get_agent_status" ? this.#store.getSchedule(id) : undefined;
      return Object.freeze({ message: `Loaded ${name.replaceAll("_", " ")} for Punk #${id}.`,
        ...result, ...(schedule === undefined ? {} : { schedule }) });
    }
    if (name === "set_scouting_schedule") {
      const input = exact(args, ["tokenId", "startAt", "endAt", "timezone", "enabled"], "schedule arguments");
      await this.#deps.requireCurrentOwner(input.tokenId, principal.wallet);
      const schedule = normalizeScoutingSchedule({ schema: "GOGH_SCOUTING_SCHEDULE_V1", ...input });
      this.#store.setSchedule(input.tokenId, schedule);
      return Object.freeze({ message: schedule.enabled
        ? `Punk #${input.tokenId} may scout only inside the selected UTC window.`
        : `Punk #${input.tokenId}'s connector schedule is disabled.`, schedule });
    }
    if (name === "send_agent_scouting") {
      const input = exact(args, ["tokenId"], "scout arguments");
      await this.#deps.requireCurrentOwner(input.tokenId, principal.wallet);
      const schedule = this.#store.getSchedule(input.tokenId);
      if (schedule) {
        const decision = evaluateScoutingSchedule(schedule, this.#clock());
        if (!decision.allowed) fail("OUTSIDE_SCOUTING_WINDOW",
          `Punk #${input.tokenId} cannot scout now; schedule state is ${decision.state}.`);
      }
      const queued = await this.#deps.sendScout(input.tokenId, principal.wallet);
      return Object.freeze({ message: `Punk #${input.tokenId} scouting job queued.`, ...queued });
    }
    if (name === "inspect_opensea_mint") {
      const input = exact(args, ["tokenId", "url"], "inspect arguments");
      const review = await this.#deps.inspectMint(tokenId(input.tokenId), input.url, principal.wallet);
      return Object.freeze({ message: review.supported
        ? `OpenSea mint inspected for Punk #${input.tokenId}; no transaction was created.`
        : "This mint could not be safely verified.", review });
    }
    if (name === "prepare_directed_mint") {
      const input = exact(args, ["tokenId", "url", "quantity"], "prepare arguments");
      if (input.quantity !== 1) fail("UNSUPPORTED_QUANTITY", "Only quantity 1 is supported.");
      await this.#deps.requireCurrentOwner(input.tokenId, principal.wallet);
      const prepared = await this.#deps.prepareMint(tokenId(input.tokenId), input.url, principal.wallet);
      const intent = this.#store.createIntent({ tokenId: input.tokenId, wallet: principal.wallet,
        quantity: 1, prepared });
      return Object.freeze({ message: `Mint intent prepared for Punk #${input.tokenId}; nothing was broadcast.`,
        intentId: intent.intentId, expiresAt: intent.expiresAt, ...prepared });
    }
    if (name === "execute_directed_mint") {
      const input = exact(args, ["intentId"], "execute arguments");
      if (typeof input.intentId !== "string" || !INTENT_ID.test(input.intentId)) {
        fail("INVALID_INTENT", "Mint intent is invalid.");
      }
      const intent = this.#store.consumeIntent(input.intentId);
      if (!principal.punkIds.includes(intent.tokenId) || principal.wallet !== intent.wallet) {
        fail("INTENT_FORBIDDEN", "Mint intent does not belong to this connector session.");
      }
      await this.#deps.requireCurrentOwner(intent.tokenId, principal.wallet);
      const simulation = await this.#deps.executeMint(intent, { executionMode: this.#executionMode });
      if (this.#executionMode !== "simulate") {
        fail("PRODUCTION_EXECUTION_DISABLED", "Production paid connector execution is not enabled in this build.");
      }
      return Object.freeze({ message: `Simulation complete for Punk #${intent.tokenId}; nothing was broadcast.`,
        intentId: intent.intentId, simulation });
    }
    if (name === "pause_agent" || name === "resume_agent") {
      const input = exact(args, ["tokenId"], "agent arguments");
      await this.#deps.requireCurrentOwner(input.tokenId, principal.wallet);
      const result = await this.#deps[name === "pause_agent" ? "pauseAgent" : "resumeAgent"](
        input.tokenId, principal.wallet);
      return Object.freeze({ message: `Punk #${input.tokenId} ${name === "pause_agent" ? "paused" : "resumed"}.`,
        ...result });
    }
    fail("UNKNOWN_TOOL", "Connector tool is not supported.");
  }
}
