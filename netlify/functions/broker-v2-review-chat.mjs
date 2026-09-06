import { draftStrategyFromConversation } from "../../broker/src/v4/intent-draft.mjs";
import { PublicError, json, readJson } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { requireV2DeployPreview } from "./_shared/v2-review.mjs";

const TOKEN = /^(?:0|[1-9]\d{0,3})$/;
const OWNER = /^0x[0-9a-f]{40}$/;

function exactBody(value) {
  const fields = value && typeof value === "object" && !Array.isArray(value)
    && Object.hasOwn(value, "currentIntent")
    ? ["currentIntent", "message", "owner", "tokenId"] : ["message", "owner", "tokenId"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || !fields.every((field) => Object.hasOwn(value, field))) {
    throw new PublicError(400, "INVALID_REQUEST", "The review chat request is invalid.");
  }
  const owner = typeof value.owner === "string" ? value.owner.toLowerCase() : "";
  const tokenId = String(value.tokenId ?? "");
  const message = typeof value.message === "string"
    ? value.message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : "";
  if (!OWNER.test(owner) || !TOKEN.test(tokenId) || !message
    || Buffer.byteLength(message, "utf8") > 8_000) {
    throw new PublicError(400, "INVALID_REQUEST", "Choose an owned Punk and enter a valid message.");
  }
  const currentIntent = Object.hasOwn(value, "currentIntent") ? value.currentIntent : null;
  if (currentIntent !== null && (!currentIntent || typeof currentIntent !== "object"
    || Array.isArray(currentIntent))) {
    throw new PublicError(400, "INVALID_REQUEST", "The current review strategy is invalid.");
  }
  return Object.freeze({ owner, tokenId, message, currentIntent });
}

function punkReply(confirmation) {
  const taste = confirmation.lookingFor.length
    ? confirmation.lookingFor.join(" + ").replaceAll("_", " ") : "OPEN TASTE";
  return `GOT IT. ${confirmation.mintPrice.toUpperCase()}. ${taste}. ${confirmation.dailyLimit} MAX PER DAY. REVIEW THE RULES BEFORE THEY CHANGE.`;
}

export async function handleV2ReviewChat(request, {
  readAuthority = readV2PunkAuthority, now = new Date() } = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    requireV2DeployPreview(request);
    const body = exactBody(await readJson(request, 20_000));
    const authority = await readAuthority(body.tokenId, { expectedOwner: body.owner });
    let interpreted;
    try {
      interpreted = draftStrategyFromConversation({ message: body.message,
        punkTokenId: body.tokenId, expectedOwner: body.owner, punkWallet: authority.punkWallet,
        currentIntent: body.currentIntent }, now);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      throw new PublicError(400, "INVALID_REQUEST", "The review strategy could not be safely interpreted.");
    }
    return json({ ok: true, reviewMode: true, persistence: "NONE", tokenId: body.tokenId,
      reply: punkReply(interpreted.confirmation), draft: {
        version: null, state: interpreted.status, intent: interpreted.intent,
        intentHash: interpreted.confirmation.intentHash,
        confirmation: interpreted.confirmation,
        provider: { provider: "DETERMINISTIC_REVIEW_PARSER", modelId: null },
      }, economicPermissionsActivated: false, transactionPrepared: false });
  } catch (error) {
    return v2Failure(error);
  }
}

export default handleV2ReviewChat;

export const config = { path: "/api/v2/review/chat", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 30, windowSize: 60,
} };
