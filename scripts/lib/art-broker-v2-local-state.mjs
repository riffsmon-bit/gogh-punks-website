import { createHash } from "node:crypto";
import { draftStrategyFromConversation } from "../../broker/src/v4/intent-draft.mjs";
import { inspectArtBrokerLink } from "../../broker/src/v4/link-scanner.mjs";
import { punkCollectingIntentHash } from "../../broker/src/v4/collecting-intent.mjs";

const OWNER = "0x1111111111111111111111111111111111111111";
const PUNKS = Object.freeze({
  "119": Object.freeze({ punkTokenId: "119", punkWallet: "0x1190119011901190119011901190119011901190" }),
  "546": Object.freeze({ punkTokenId: "546", punkWallet: "0x5460546054605460546054605460546054605460" }),
  "810": Object.freeze({ punkTokenId: "810", punkWallet: "0x8100810081008100810081008100810081008100" }),
});

function exact(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== fields.length
    || fields.some((field) => !Object.hasOwn(value, field))) throw new TypeError(`${label} is invalid`);
  return value;
}
function punk(value) {
  const output = PUNKS[String(value ?? "")];
  if (!output) throw new TypeError("local preview Punk is invalid");
  return output;
}

export class ArtBrokerV2LocalState {
  #drafts = new Map();
  #strategies = new Map();
  #conversations = new Map();
  #usage = [];

  session(tokenId) {
    const selected = punk(tokenId);
    return Object.freeze({ owner: OWNER, ...selected,
      strategy: this.#strategies.get(selected.punkTokenId) ?? null,
      messages: Object.freeze([...(this.#conversations.get(selected.punkTokenId) ?? [])]),
      localOnly: true, productionSubmissionEnabled: false });
  }

  chat(input, now = new Date()) {
    const { tokenId, message } = exact(input, ["tokenId", "message"], "local chat request");
    const selected = punk(tokenId);
    const current = this.#strategies.get(selected.punkTokenId)?.intent ?? null;
    const draft = draftStrategyFromConversation({ message, punkTokenId: selected.punkTokenId,
      expectedOwner: OWNER, punkWallet: selected.punkWallet, currentIntent: current }, now);
    const hash = punkCollectingIntentHash(draft.intent, now);
    this.#drafts.set(hash, Object.freeze({ ...draft, hash, tokenId: selected.punkTokenId }));
    const messages = this.#conversations.get(selected.punkTokenId) ?? [];
    messages.push(Object.freeze({ role: "OWNER", content: String(message), createdAt: new Date(now).toISOString() }),
      Object.freeze({ role: "PUNK", content: "Strategy draft ready for owner review.", createdAt: new Date(now).toISOString() }));
    this.#conversations.set(selected.punkTokenId, messages.slice(-40));
    this.#usage.push(Object.freeze({ task: "INTERPRET_INTENT", provider: "LOCAL_DETERMINISTIC",
      punkTokenId: selected.punkTokenId, cacheHit: false, occurredAt: new Date(now).toISOString() }));
    return Object.freeze({ ...draft, intentHash: hash, localOnly: true });
  }

  activate(input, now = new Date()) {
    const { tokenId, intentHash } = exact(input, ["tokenId", "intentHash"], "local activation request");
    const selected = punk(tokenId); const draft = this.#drafts.get(intentHash);
    if (!draft || draft.tokenId !== selected.punkTokenId) throw new TypeError("strategy draft is unavailable");
    if (draft.intent.operatingMode === "AUTONOMOUS") {
      const error = new Error("Autonomous submission is unavailable with the deployed Punk Wallet boundary.");
      error.code = "SELF_FUNDED_AUTONOMOUS_GAS_UNSUPPORTED_BY_DEPLOYED_ACCOUNT"; throw error;
    }
    const strategy = Object.freeze({ state: "LOCAL_PREVIEW_ACTIVE", version: 1,
      intentHash, intent: draft.intent, activatedAt: new Date(now).toISOString(),
      ownerAuthorization: "LOCAL_PREVIEW_ONLY", productionAuthorized: false });
    this.#strategies.set(selected.punkTokenId, strategy);
    return strategy;
  }

  async inspect(input) {
    const { tokenId, url } = exact(input, ["tokenId", "url"], "local link request");
    punk(tokenId);
    const result = await inspectArtBrokerLink(url);
    return Object.freeze({ ...result, localOnly: true });
  }

  admin() {
    return Object.freeze({ localOnly: true, productionAuthorized: false,
      activeStrategies: this.#strategies.size, pendingStrategyDrafts: this.#drafts.size,
      conversations: this.#conversations.size, providerUsage: this.#usage.length,
      opportunitiesDiscovered: 0, opportunitiesScreened: 0, opportunitiesBlocked: 0,
      executionAttempts: 0, successfulMints: 0, failedAttempts: 0,
      aiProviderHealth: Object.freeze({ OPENAI: "NOT_CONFIGURED", ANTHROPIC: "NOT_CONFIGURED",
        XAI: "NOT_CONFIGURED", BANKR: "NOT_CONFIGURED" }),
      services: Object.freeze({ DISCOVERY: "LOCAL_READY", SCREENING: "LOCAL_READY",
        SIMULATION: "LOCAL_READY", DATABASE: "NOT_CONNECTED", RPC: "NOT_USED",
        EXECUTOR: "DISABLED" }),
      cacheUtilization: null, estimatedInfrastructureCostMicrousd: 0,
      snapshotHash: createHash("sha256").update(JSON.stringify(this.#usage)).digest("hex"),
    });
  }
}
