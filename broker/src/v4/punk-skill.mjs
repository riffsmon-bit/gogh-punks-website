import { createHash } from "node:crypto";

export const PUNK_SKILL_SCHEMA = "GOGH_PUNK_SKILL_V1";
export const PUNK_SKILL_CAPABILITIES = Object.freeze([
  "SCOUT_OPPORTUNITIES",
  "INSPECT_LINKS",
  "EXPLAIN_SCREENING",
  "RANK_POLICY_MATCHES",
  "REVIEW_COLLECTION",
  "EXPLAIN_FINDINGS",
]);

const CAPABILITIES = new Set(PUNK_SKILL_CAPABILITIES);
const OWNER = /^0x[0-9a-f]{40}$/;
const WALLET = /^0x[0-9a-f]{40}$/;
const TOKEN = /^(?:0|[1-9]\d{0,3})$/;
const TEACH = /^\s*teach\s+(?:(?:my\s+)?punk|yourself|you)\s+(?:to\s+|how\s+to\s+)?/i;
const UNSAFE = /\b(?:private\s*key|seed\s*phrase|recovery\s*phrase|arbitrary\s+(?:transaction|calldata)|sign\s+(?:(?:any|arbitrary)\s+transactions?|anything|transactions?)|send\s+(?:any|arbitrary)\s+transaction|withdraw\s+(?:(?:all|any)\s+assets?|anything|everything|assets?)|transfer\s+(?:(?:all|any)\s+assets?|anything|everything|assets?)|disable\s+(?:screening|simulation)|skip\s+(?:screening|simulation)|bypass\s+(?:policy|rules?|screening|simulation)|ignore\s+(?:policy|rules?|screening|simulation)|delegatecall|admin\s+withdraw)\b/i;

function clean(value, label, maximum) {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid`);
  const result = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!result || result.length > maximum) throw new TypeError(`${label} is invalid`);
  return result;
}

function exact(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((field) => !fields.includes(field))
    || fields.some((field) => !Object.hasOwn(value, field))) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function inferredCapabilities(description) {
  const text = description.toLowerCase();
  const result = [];
  if (/\b(?:find|hunt|discover|scout|spot|look for)\b/.test(text)) result.push("SCOUT_OPPORTUNITIES");
  if (/\b(?:link|url|website|opensea|explorer)\b/.test(text)) result.push("INSPECT_LINKS");
  if (/\b(?:safe|safety|risk|screen|screening|contract|scam)\b/.test(text)) result.push("EXPLAIN_SCREENING");
  if (/\b(?:rank|compare|best|prioriti[sz]e|match)\b/.test(text)) result.push("RANK_POLICY_MATCHES");
  if (/\b(?:collections?|gallery|holdings?|own)\b/.test(text)) result.push("REVIEW_COLLECTION");
  if (/\b(?:explain|summari[sz]e|tell|report|why)\b/.test(text)) result.push("EXPLAIN_FINDINGS");
  return result.length ? result : ["EXPLAIN_FINDINGS"];
}

function skillName(description) {
  const words = description.replace(/[^a-z0-9\s-]/gi, " ").replace(/\s+/g, " ").trim()
    .split(" ").filter(Boolean).slice(0, 6);
  return clean(words.join(" ").toUpperCase(), "skill name", 72);
}

export function isTeachPunkSkillMessage(value) {
  return typeof value === "string" && TEACH.test(value);
}

export function draftPunkSkillFromConversation({ message, punkTokenId, expectedOwner,
  punkWallet, now = new Date() }) {
  const owner = String(expectedOwner ?? "").toLowerCase();
  const wallet = String(punkWallet ?? "").toLowerCase();
  const tokenId = String(punkTokenId ?? "");
  const source = clean(message, "skill instruction", 1_200);
  if (!TEACH.test(source) || !OWNER.test(owner) || !WALLET.test(wallet) || !TOKEN.test(tokenId)) {
    throw new TypeError("skill draft identity is invalid");
  }
  const description = clean(source.replace(TEACH, ""), "skill description", 480);
  if (UNSAFE.test(description)) throw new TypeError("skill requests unsafe authority");
  const capabilities = inferredCapabilities(description);
  const identity = JSON.stringify({ tokenId, owner, wallet, description, capabilities });
  return normalizePunkSkill({ schema: PUNK_SKILL_SCHEMA, version: 1,
    skillId: `skill_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`,
    punkTokenId: tokenId, expectedOwner: owner, punkWallet: wallet,
    name: skillName(description), description, capabilities,
    authority: "READ_ONLY", policyEffect: "NONE", state: "DRAFT",
    createdAt: new Date(now).toISOString() });
}

export function normalizePunkSkill(value) {
  const source = exact(value, ["schema", "version", "skillId", "punkTokenId", "expectedOwner",
    "punkWallet", "name", "description", "capabilities", "authority", "policyEffect",
    "state", "createdAt"], "Punk skill");
  const expectedOwner = String(source.expectedOwner ?? "").toLowerCase();
  const punkWallet = String(source.punkWallet ?? "").toLowerCase();
  const punkTokenId = String(source.punkTokenId ?? "");
  const capabilities = source.capabilities;
  if (source.schema !== PUNK_SKILL_SCHEMA || source.version !== 1
    || !/^skill_[0-9a-f]{24}$/.test(String(source.skillId ?? ""))
    || !TOKEN.test(punkTokenId) || !OWNER.test(expectedOwner) || !WALLET.test(punkWallet)
    || !Array.isArray(capabilities) || capabilities.length < 1 || capabilities.length > 6
    || new Set(capabilities).size !== capabilities.length
    || capabilities.some((capability) => !CAPABILITIES.has(capability))
    || source.authority !== "READ_ONLY" || source.policyEffect !== "NONE"
    || !["DRAFT", "ACTIVE", "PAUSED"].includes(source.state)
    || Number.isNaN(new Date(source.createdAt).getTime())) {
    throw new TypeError("Punk skill is invalid");
  }
  const name = clean(source.name, "skill name", 72);
  const description = clean(source.description, "skill description", 480);
  if (UNSAFE.test(description)) throw new TypeError("Punk skill is invalid");
  return Object.freeze({ schema: source.schema, version: 1, skillId: source.skillId,
    punkTokenId, expectedOwner, punkWallet, name, description,
    capabilities: Object.freeze([...capabilities]), authority: "READ_ONLY", policyEffect: "NONE",
    state: source.state, createdAt: new Date(source.createdAt).toISOString() });
}

export function activatePunkSkill(value, selection) {
  const skill = normalizePunkSkill(value);
  const owner = String(selection?.owner ?? "").toLowerCase();
  const punkWallet = String(selection?.punkWallet ?? "").toLowerCase();
  const punkTokenId = String(selection?.punkTokenId ?? "");
  if (skill.state !== "DRAFT" || skill.expectedOwner !== owner
    || skill.punkWallet !== punkWallet || skill.punkTokenId !== punkTokenId) {
    throw new TypeError("Punk skill does not match the selected current owner");
  }
  return Object.freeze({ ...skill, state: "ACTIVE" });
}
