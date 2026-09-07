const CAPABILITIES = new Set([
  "SCOUT_OPPORTUNITIES", "INSPECT_LINKS", "EXPLAIN_SCREENING",
  "RANK_POLICY_MATCHES", "REVIEW_COLLECTION", "EXPLAIN_FINDINGS",
]);

const ADDRESS = /^0x[0-9a-f]{40}$/;
const TOKEN = /^(?:0|[1-9]\d{0,3})$/;

export function normalizeReviewSkill(value) {
  const owner = String(value?.expectedOwner ?? "").toLowerCase();
  const wallet = String(value?.punkWallet ?? "").toLowerCase();
  const tokenId = String(value?.punkTokenId ?? "");
  const capabilities = value?.capabilities;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schema !== "GOGH_PUNK_SKILL_V1" || value.version !== 1
    || !/^skill_[0-9a-f]{24}$/.test(String(value.skillId ?? ""))
    || !TOKEN.test(tokenId) || !ADDRESS.test(owner) || !ADDRESS.test(wallet)
    || typeof value.name !== "string" || !value.name.trim() || value.name.length > 72
    || typeof value.description !== "string" || !value.description.trim()
    || value.description.length > 480 || !Array.isArray(capabilities)
    || capabilities.length < 1 || capabilities.length > 6
    || new Set(capabilities).size !== capabilities.length
    || capabilities.some((capability) => !CAPABILITIES.has(capability))
    || value.authority !== "READ_ONLY" || value.policyEffect !== "NONE"
    || !["DRAFT", "ACTIVE", "PAUSED"].includes(value.state)
    || Number.isNaN(new Date(value.createdAt).getTime())) {
    throw new TypeError("Punk skill is invalid");
  }
  return Object.freeze({ ...value, punkTokenId: tokenId, expectedOwner: owner,
    punkWallet: wallet, name: value.name.trim(), description: value.description.trim(),
    capabilities: Object.freeze([...capabilities]) });
}

export function activateReviewSkill(value, selection) {
  const skill = normalizeReviewSkill(value);
  const owner = String(selection?.owner ?? "").toLowerCase();
  const punkWallet = String(selection?.punkWallet ?? "").toLowerCase();
  const punkTokenId = String(selection?.punkTokenId ?? "");
  if (skill.state !== "DRAFT" || skill.expectedOwner !== owner
    || skill.punkWallet !== punkWallet || skill.punkTokenId !== punkTokenId) {
    throw new TypeError("Punk skill does not match the selected current owner");
  }
  return Object.freeze({ ...skill, state: "ACTIVE" });
}
