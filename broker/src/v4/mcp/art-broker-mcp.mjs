const TOKEN_ID = /^(?:0|[1-9][0-9]{0,3})$/;
const OPPORTUNITY_ID = /^[a-zA-Z0-9:_-]{8,256}$/;
const CONTRACT = /^0x[0-9a-fA-F]{40}$/;

const stringProperty = (pattern, description) => Object.freeze({ type: "string", pattern, description });
const INPUT_SCHEMAS = Object.freeze({
  get_my_punks: Object.freeze({}),
  get_punk: Object.freeze({ tokenId: stringProperty(TOKEN_ID.source, "Gogh Punk token ID") }),
  get_punk_wallet: Object.freeze({ tokenId: stringProperty(TOKEN_ID.source, "Gogh Punk token ID") }),
  get_punk_balance: Object.freeze({ tokenId: stringProperty(TOKEN_ID.source, "Gogh Punk token ID") }),
  get_punk_collection: Object.freeze({ tokenId: stringProperty(TOKEN_ID.source, "Gogh Punk token ID") }),
  get_punk_activity: Object.freeze({ tokenId: stringProperty(TOKEN_ID.source, "Gogh Punk token ID") }),
  get_punk_strategy: Object.freeze({ tokenId: stringProperty(TOKEN_ID.source, "Gogh Punk token ID") }),
  get_punk_skills: Object.freeze({ tokenId: stringProperty(TOKEN_ID.source, "Gogh Punk token ID") }),
  get_opportunities: Object.freeze({ tokenId: stringProperty(TOKEN_ID.source, "Gogh Punk token ID") }),
  get_opportunity: Object.freeze({ opportunityId: stringProperty(OPPORTUNITY_ID.source, "Normalized opportunity ID") }),
  explain_opportunity: Object.freeze({ opportunityId: stringProperty(OPPORTUNITY_ID.source, "Normalized opportunity ID") }),
  inspect_collection: Object.freeze({ collectionContract: stringProperty(CONTRACT.source, "Collection contract") }),
  classify_collection: Object.freeze({ collectionContract: stringProperty(CONTRACT.source, "Collection contract") }),
  inspect_mint_link: Object.freeze({ url: Object.freeze({ type: "string", format: "uri", maxLength: 2048 }) }),
  estimate_mint_cost: Object.freeze({ tokenId: stringProperty(TOKEN_ID.source, "Gogh Punk token ID"),
    opportunityId: stringProperty(OPPORTUNITY_ID.source, "Normalized opportunity ID") }),
  simulate_mint: Object.freeze({ tokenId: stringProperty(TOKEN_ID.source, "Gogh Punk token ID"),
    opportunityId: stringProperty(OPPORTUNITY_ID.source, "Normalized opportunity ID") }),
  prepare_mint: Object.freeze({ tokenId: stringProperty(TOKEN_ID.source, "Gogh Punk token ID"),
    opportunityId: stringProperty(OPPORTUNITY_ID.source, "Normalized opportunity ID") }),
  draft_strategy: Object.freeze({ tokenId: stringProperty(TOKEN_ID.source, "Gogh Punk token ID"),
    message: Object.freeze({ type: "string", minLength: 1, maxLength: 8000 }) }),
  validate_strategy: Object.freeze({ tokenId: stringProperty(TOKEN_ID.source, "Gogh Punk token ID"),
    intent: Object.freeze({ type: "object" }) }),
  prepare_strategy_update: Object.freeze({ tokenId: stringProperty(TOKEN_ID.source, "Gogh Punk token ID"),
    intentHash: stringProperty("^0x[0-9a-f]{64}$", "Canonical strategy hash") }),
  prepare_strategy_activation: Object.freeze({ tokenId: stringProperty(TOKEN_ID.source, "Gogh Punk token ID"),
    intentHash: stringProperty("^0x[0-9a-f]{64}$", "Canonical strategy hash") }),
});

export const ART_BROKER_MCP_TOOLS = Object.freeze([
  ["get_my_punks", "punk:read", "List the authenticated owner's current Gogh Punks."],
  ["get_punk", "punk:read", "Read one Gogh Punk profile."],
  ["get_punk_wallet", "punk:read", "Resolve one canonical Punk Wallet."],
  ["get_punk_balance", "punk:read", "Read one Punk Wallet balance."],
  ["get_punk_collection", "punk:read", "Read one Punk's acquisition history; current NFT holdings are not verified."],
  ["get_punk_activity", "punk:read", "Read one Punk's V1 and V2 activity."],
  ["get_punk_strategy", "strategy:read", "Read one Punk's active structured strategy."],
  ["get_punk_skills", "punk:read", "Read verified learned skills, equipped slots and training credits, or explicit unavailability."],
  ["get_opportunities", "opportunity:read", "List normalized screened opportunities."],
  ["get_opportunity", "opportunity:read", "Read one normalized opportunity."],
  ["inspect_collection", "analysis:read", "Read cached collection inspection without authorizing it."],
  ["inspect_mint_link", "analysis:read", "Inspect a mint link without accepting its transaction data."],
  ["estimate_mint_cost", "simulation:read", "Read cached mint value and gas estimates; freshness is not guaranteed."],
  ["simulate_mint", "simulation:read", "Read the latest stored mint simulation; does not run a fresh simulation."],
  ["draft_strategy", "strategy:draft", "Translate words into a strategy draft."],
  ["validate_strategy", "strategy:draft", "Validate a structured strategy draft."],
  ["prepare_strategy_update", "strategy:prepare", "Prepare an owner-confirmed strategy update."],
  ["classify_collection", "analysis:read", "Read cached art classification; does not grant a learned skill."],
  ["explain_opportunity", "analysis:read", "Explain an opportunity using normalized evidence."],
  ["prepare_mint", "mint:prepare", "Report requirements for owner-approved mint preparation; does not construct or submit a transaction."],
  ["prepare_strategy_activation", "strategy:prepare", "Prepare explicit strategy activation without activating it."],
].map(([name, scope, description]) => {
  const properties = INPUT_SCHEMAS[name];
  return Object.freeze({ name, scope, description, inputSchema: Object.freeze({ type: "object",
    properties, required: Object.freeze(Object.keys(properties)), additionalProperties: false }) });
}));

// These are real native research implementations, distinct from basic owner
// diagnostics. Only a fresh server-derived capability result can expose them.
export const ART_BROKER_MCP_RESEARCH_TOOLS = Object.freeze([
  ["inspect_contract", "Inspect the reviewed Gogh collection with an equipped Contract Detective skill.", false],
  ["get_metadata", "Read inline metadata for three selected Punks with an equipped Rarity Eye skill.", true],
  ["rank_trait_sample", "Compare traits within three selected Punks with an equipped Rarity Eye skill; not collection-wide rarity.", true],
  ["get_market_listings", "Read up to five Gogh listings with an equipped Market Scout skill; no bids or purchases.", false],
  ["skill_inspect_mint_link", "Inspect a Robinhood mint link using equipped Link Sniper; no wallet requests.", 'url'],
  ["skill_inspect_mint", "Check one shared free-mint opportunity against the equipped Mint Hunter and current Punk rules.", 'opportunity'],
  ["skill_simulate_mint", "Run an exact free-mint call check with equipped Mint Hunter; no transaction submission.", 'opportunity'],
  ["skill_prepare_mint", "Prepare a Mint Hunter recommendation requiring a separate owner review; no signing bytes.", 'opportunity'],
  ["skill_rank_observed_listings", "Compare prices within up to five observed Gogh listings using equipped Floor Hunter; not a verified collection floor or purchase.", false],
  ["skill_research_collection", "Summarize declared metadata for three selected Punks using equipped Collection Researcher; no external website requests.", true],
  ["skill_classify_collection", "Read declared art-style metadata in three selected Punks using equipped Art Curator; does not analyze images or change collecting rules.", true],
].map(([name, description, sample]) => {
  const properties = Object.freeze({ tokenId: stringProperty(TOKEN_ID.source, "The authenticated owner's selected Punk"),
    ...(sample === true ? { sampleTokenIds: Object.freeze({ type: "array", minItems: 3, maxItems: 3, uniqueItems: true,
      items: stringProperty("^[1-9][0-9]{0,3}$", "Punk ID; the sample must include the selected Punk") }) } : {}),
    ...(sample === 'url' ? { url: Object.freeze({ type: "string", format: "uri", maxLength: 2048 }) } : {}),
    ...(sample === 'opportunity' ? { opportunityId: stringProperty(OPPORTUNITY_ID.source, "Shared opportunity ID") } : {}) });
  return Object.freeze({ name, scope: "analysis:read", description, inputSchema: Object.freeze({ type: "object",
    properties, required: Object.freeze(Object.keys(properties)), additionalProperties: false }) });
}));

// Baseline diagnostics retain their names and semantics. Only these explicit
// aliases enter the learned/equipped package gate; clients cannot supply a map.
const RESEARCH_INTERNAL_NAMES = Object.freeze({
  skill_inspect_mint_link: 'inspect_mint_link', skill_inspect_mint: 'inspect_mint',
  skill_simulate_mint: 'simulate_mint', skill_prepare_mint: 'prepare_mint',
  skill_rank_observed_listings: 'rank_observed_listings', skill_research_collection: 'research_collection',
  skill_classify_collection: 'classify_collection',
});
const researchName = name => RESEARCH_INTERNAL_NAMES[name] ?? name;

export const FORBIDDEN_ART_BROKER_MCP_TOOLS = Object.freeze([
  "send_arbitrary_transaction", "sign_arbitrary_transaction", "execute_arbitrary_calldata",
  "get_private_key", "transfer_any_asset", "admin_withdraw",
]);

export class ArtBrokerMcpError extends Error {
  constructor(code, message) { super(message); this.name = "ArtBrokerMcpError"; this.code = code; }
}
function fail(code, message) { throw new ArtBrokerMcpError(code, message); }

function record(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).some((key) => !allowed.includes(key))
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(item => !Object.hasOwn(item, "value"))) {
    fail("INVALID_ARGUMENTS", `${label} is invalid.`);
  }
  return value;
}
function tokenId(value) {
  if (typeof value !== "string" || !TOKEN_ID.test(value)) fail("INVALID_TOKEN_ID", "Choose a valid Punk.");
  return value;
}
function opportunityId(value) {
  if (typeof value !== "string" || !OPPORTUNITY_ID.test(value)) {
    fail("INVALID_OPPORTUNITY_ID", "Choose a valid opportunity.");
  }
  return value;
}
function contractAddress(value) {
  if (typeof value !== "string" || !CONTRACT.test(value)) {
    fail("INVALID_CONTRACT", "Choose a valid collection contract.");
  }
  return value.toLowerCase();
}

export class GoghArtBrokerMcpServer {
  #auth; #deps;
  constructor({ authenticate, dependencies }) {
    if (typeof authenticate !== "function" || !dependencies || typeof dependencies !== "object") {
      throw new TypeError("MCP dependencies are invalid");
    }
    this.#auth = authenticate; this.#deps = dependencies;
  }

  listTools({ accessToken, tokenId: selectedTokenId } = {}) {
    if (selectedTokenId === undefined) return ART_BROKER_MCP_TOOLS;
    return this.#selectedTools(accessToken, selectedTokenId);
  }

  async #selectedTools(accessToken, selectedTokenId) {
    const id = tokenId(selectedTokenId);
    const principal = await this.#auth(accessToken, "punk:read");
    if (!principal || typeof principal.owner !== "string") fail("UNAUTHORIZED", "Authentication is required.");
    await this.#deps.requireCurrentOwner(id, principal.owner);
    if (!this.#deps.research) return ART_BROKER_MCP_TOOLS;
    const capabilities = await this.#deps.research.resolve({ tokenId: id, owner: principal.owner });
    // The injected runtime is server-owned. No HTTP/LLM capability object enters
    // this path; the canonical resolver enforces package, owner and slot state.
    return [...ART_BROKER_MCP_TOOLS, ...ART_BROKER_MCP_RESEARCH_TOOLS.filter(tool =>
      capabilities?.effectiveMcpTools.includes(researchName(tool.name)))];
  }

  async call({ accessToken, name, arguments: rawArguments = {} }) {
    const tool = [...ART_BROKER_MCP_TOOLS, ...ART_BROKER_MCP_RESEARCH_TOOLS].find((value) => value.name === name);
    if (!tool) fail("UNKNOWN_TOOL", "This capability is not exposed by Gogh Art Broker.");
    const principal = await this.#auth(accessToken, tool.scope);
    if (!principal || typeof principal.owner !== "string") fail("UNAUTHORIZED", "Authentication is required.");
    const args = rawArguments ?? {};
    const punkRead = new Set(["get_punk", "get_punk_wallet", "get_punk_balance",
      "get_punk_collection", "get_punk_activity", "get_punk_strategy", "get_punk_skills"]);
    const researchTool = ART_BROKER_MCP_RESEARCH_TOOLS.find(value => value.name === name);
    if (researchTool) {
      const input = record(args, Object.keys(researchTool.inputSchema.properties), "research request");
      const id = tokenId(input.tokenId);
      await this.#deps.requireCurrentOwner(id, principal.owner);
      if (!this.#deps.research) fail("RESEARCH_UNAVAILABLE", "Equipped research is unavailable.");
      return this.#deps.research.call({ tokenId: id, owner: principal.owner, name: researchName(name),
        arguments: Object.fromEntries(Object.entries(input).filter(([key]) => key !== "tokenId")) });
    }
    if (name === "get_my_punks") {
      record(args, [], "Punk list request");
      return this.#deps.getMyPunks(principal.owner);
    }
    if (punkRead.has(name)) {
      const input = record(args, ["tokenId"], "Punk read request");
      const id = tokenId(input.tokenId);
      await this.#deps.requireCurrentOwner(id, principal.owner);
      return this.#deps[name](id, principal.owner);
    }
    if (name === "get_opportunities") {
      const input = record(args, ["tokenId"], "opportunity list request");
      const id = tokenId(input.tokenId);
      await this.#deps.requireCurrentOwner(id, principal.owner);
      return this.#deps.getOpportunities(id, principal.owner);
    }
    if (["get_opportunity", "explain_opportunity"].includes(name)) {
      const input = record(args, ["opportunityId"], "opportunity request");
      const id = opportunityId(input.opportunityId);
      return this.#deps[name](id, principal.owner);
    }
    if (["inspect_collection", "classify_collection"].includes(name)) {
      const input = record(args, ["collectionContract"], "collection request");
      return this.#deps[name](contractAddress(input.collectionContract), principal.owner);
    }
    if (name === "inspect_mint_link") {
      const input = record(args, ["url"], "link inspection request");
      return this.#deps.inspect_mint_link(input.url, principal.owner);
    }
    if (["estimate_mint_cost", "simulate_mint", "prepare_mint"].includes(name)) {
      const input = record(args, ["tokenId", "opportunityId"], "mint preparation request");
      const id = tokenId(input.tokenId);
      await this.#deps.requireCurrentOwner(id, principal.owner);
      return this.#deps[name](id, opportunityId(input.opportunityId), principal.owner);
    }
    if (name === "draft_strategy") {
      const input = record(args, ["tokenId", "message"], "strategy draft request");
      const id = tokenId(input.tokenId);
      await this.#deps.requireCurrentOwner(id, principal.owner);
      return this.#deps.draft_strategy(id, input.message, principal.owner);
    }
    if (name === "validate_strategy") {
      const input = record(args, ["tokenId", "intent"], "strategy validation request");
      const id = tokenId(input.tokenId);
      await this.#deps.requireCurrentOwner(id, principal.owner);
      return this.#deps.validate_strategy(id, input.intent, principal.owner);
    }
    if (["prepare_strategy_update", "prepare_strategy_activation"].includes(name)) {
      const input = record(args, ["tokenId", "intentHash"], "strategy preparation request");
      const id = tokenId(input.tokenId);
      await this.#deps.requireCurrentOwner(id, principal.owner);
      return this.#deps[name](id, input.intentHash, principal.owner);
    }
    fail("UNKNOWN_TOOL", "This capability is not exposed by Gogh Art Broker.");
  }
}

function rpcFailure(id, error) {
  // Dependency/RPC/provider errors can contain authenticated URLs and response
  // bodies. Only this module's deliberately public messages cross JSON-RPC.
  const publicError = error instanceof ArtBrokerMcpError;
  return { jsonrpc: "2.0", id, error: { code: -32000,
    message: publicError ? error.message : "The requested Punk state or tool result could not be verified. Recheck shortly.",
    data: { code: publicError ? error.code : "TOOL_CALL_FAILED" } } };
}

export async function handleArtBrokerMcpJsonRpc(server, request, accessToken = null) {
  if (!request || request.jsonrpc !== "2.0" || !["number", "string"].includes(typeof request.id)) {
    return { jsonrpc: "2.0", id: request?.id ?? null,
      error: { code: -32600, message: "Invalid JSON-RPC request" } };
  }
  if (request.method === "initialize") return { jsonrpc: "2.0", id: request.id, result: {
    protocolVersion: "2025-06-18", capabilities: { tools: {} },
    serverInfo: { name: "gogh-art-broker", version: "2.0.0" } } };
  if (request.method === "tools/list") {
    try {
      const params = record(request.params ?? {}, ["tokenId"], "tool list request");
      const tools = await server.listTools({ accessToken, ...params });
      return { jsonrpc: "2.0", id: request.id,
        result: { tools: tools.map(({ scope: _scope, ...tool }) => tool) } };
    } catch (error) { return rpcFailure(request.id, error); }
  }
  if (request.method === "tools/call") {
    try {
      const output = await server.call({ accessToken, name: request.params?.name,
        arguments: request.params?.arguments ?? {} });
      return { jsonrpc: "2.0", id: request.id, result: { content: [
        { type: "text", text: JSON.stringify(output) }], structuredContent: output } };
    } catch (error) {
      return rpcFailure(request.id, error);
    }
  }
  return { jsonrpc: "2.0", id: request.id,
    error: { code: -32601, message: "Method not found" } };
}
