import { getDatabase } from "@netlify/database";
import { draftStrategyFromConversation } from "../../broker/src/v4/intent-draft.mjs";
import { defaultAskIntent, normalizePunkCollectingIntent } from
  "../../broker/src/v4/collecting-intent.mjs";
import { answerPunkConversation, isPunkConversationMessage } from
  "../../broker/src/v4/ai/punk-chat.mjs";
import { PublicError, json, readJson } from "./_shared/http.mjs";
import { createDatabaseBackedGoghIntelligence } from "./_shared/v2-ai-runtime.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { requireV2DeployPreview } from "./_shared/v2-review.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

const TOKEN = /^(?:0|[1-9]\d{0,3})$/;
const OWNER = /^0x[0-9a-f]{40}$/;

function exactBody(value) {
  const fields = ["history", "inspection", "currentIntent", "message", "owner", "review", "tokenId"];
  const keys = value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value) : [];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["message", "owner", "tokenId"].every((field) => Object.hasOwn(value, field))
    || keys.some((field) => !fields.includes(field))) {
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
  const inspection = Object.hasOwn(value, "inspection") ? value.inspection : null;
  if (inspection !== null && (!inspection || typeof inspection !== "object"
    || Array.isArray(inspection) || Object.keys(inspection).length !== 2
    || !/^[A-Z][A-Z0-9_]{2,63}$/.test(String(inspection.kind ?? ""))
    || !["BLOCKED", "NEEDS_REVIEW"].includes(String(inspection.status ?? "")))) {
    throw new PublicError(400, "INVALID_REQUEST", "The link-review context is invalid.");
  }
  const history = Object.hasOwn(value, "history") ? value.history : [];
  if (!Array.isArray(history) || history.length > 8 || history.some((entry) => (
    !entry || typeof entry !== "object" || Array.isArray(entry)
    || Object.keys(entry).length !== 2 || !["OWNER", "PUNK"].includes(entry.role)
    || typeof entry.content !== "string" || !entry.content.trim()
    || Buffer.byteLength(entry.content, "utf8") > 1_200
  ))) throw new PublicError(400, "INVALID_REQUEST", "The recent chat context is invalid.");
  const review = Object.hasOwn(value, "review") ? value.review : null;
  const reviewFields = ["checkedCount", "eligibleCount", "leadingCollectionName", "leadingMatchScore"];
  if (review !== null && (!review || typeof review !== "object" || Array.isArray(review)
    || Object.keys(review).some((field) => !reviewFields.includes(field))
    || !reviewFields.every((field) => Object.hasOwn(review, field))
    || !Number.isInteger(review.checkedCount) || review.checkedCount < 0 || review.checkedCount > 100
    || !Number.isInteger(review.eligibleCount) || review.eligibleCount < 0
    || review.eligibleCount > review.checkedCount
    || (review.leadingCollectionName === null) !== (review.leadingMatchScore === null)
    || review.leadingCollectionName !== null && (typeof review.leadingCollectionName !== "string"
      || !review.leadingCollectionName.trim() || review.leadingCollectionName.length > 160)
    || review.leadingMatchScore !== null && (!Number.isInteger(review.leadingMatchScore)
      || review.leadingMatchScore < 0 || review.leadingMatchScore > 100))) {
    throw new PublicError(400, "INVALID_REQUEST", "The discovery-review context is invalid.");
  }
  return Object.freeze({ owner, tokenId, message, currentIntent, inspection,
    history: Object.freeze(history.map(({ role, content }) => Object.freeze({ role,
      content: content.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() }))),
    review });
}

function punkReply(confirmation) {
  const taste = confirmation.lookingFor.length
    ? confirmation.lookingFor.join(" + ").replaceAll("_", " ") : "OPEN TASTE";
  return `GOT IT. ${confirmation.mintPrice.toUpperCase()}. ${taste}. ${confirmation.dailyLimit} MAX PER DAY. ${confirmation.totalLimit} MAX FOR THIS STRATEGY. REVIEW THE RULES BEFORE THEY CHANGE.`;
}

async function conversationalReply(request, body, intent, authority, answerConversation, now) {
  let intelligence = answerConversation;
  if (!intelligence) {
    let router = null;
    if (process.env.GOGH_V2_REVIEW_AI_ENABLED === "true") {
      const pool = getDatabase().pool;
      const session = await requireV2Session(request, pool);
      if (session.walletAddress !== body.owner) {
        throw new PublicError(403, "SESSION_OWNER_MISMATCH", "Sign in with the current Punk owner.");
      }
      router = createDatabaseBackedGoghIntelligence(pool).router;
    }
    intelligence = (input) => answerPunkConversation({ ...input, router });
  }
  const conversation = await intelligence({ message: body.message,
    intent, inspection: body.inspection, history: body.history, review: body.review,
    punkTokenId: body.tokenId,
    punkState: authority.nativeBalanceWei === undefined ? null : {
      wallet: authority.punkWallet, nativeBalanceWei: authority.nativeBalanceWei,
      activated: authority.activated === true,
    },
    strategyStatus: body.currentIntent ? "ACTIVE" : "DEFAULT",
    context: { ownerFingerprint: body.owner, punkTokenId: body.tokenId }, now });
  return json({ ok: true, reviewMode: true, persistence: "NONE", tokenId: body.tokenId,
    responseKind: "CONVERSATION", reply: conversation.reply, draft: null,
    provider: { provider: conversation.provider, registryKey: conversation.registryKey },
    providerAvailable: conversation.providerAvailable, economicPermissionsActivated: false,
    transactionPrepared: false });
}

export async function handleV2ReviewChat(request, {
  readAuthority = readV2PunkAuthority, now = new Date(), answerConversation = null } = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    requireV2DeployPreview(request);
    const body = exactBody(await readJson(request, 20_000));
    const authority = await readAuthority(body.tokenId, { expectedOwner: body.owner });
    if (isPunkConversationMessage(body.message)) {
      let current;
      try {
        current = body.currentIntent ? normalizePunkCollectingIntent(body.currentIntent, now)
          : defaultAskIntent({ punkTokenId: body.tokenId, expectedOwner: body.owner,
            punkWallet: authority.punkWallet }, now);
      } catch {
        throw new PublicError(400, "INVALID_REQUEST", "The current review strategy is invalid.");
      }
      if (current.punkTokenId !== body.tokenId || current.expectedOwner !== body.owner
        || current.punkWallet !== authority.punkWallet) {
        throw new PublicError(400, "INVALID_REQUEST", "The current review strategy is invalid.");
      }
      return conversationalReply(request, body, current, authority, answerConversation, now);
    }
    let interpreted;
    try {
      interpreted = draftStrategyFromConversation({ message: body.message,
        punkTokenId: body.tokenId, expectedOwner: body.owner, punkWallet: authority.punkWallet,
        currentIntent: body.currentIntent }, now);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      throw new PublicError(400, "INVALID_REQUEST", "The review strategy could not be safely interpreted.");
    }
    if (interpreted.changes.length === 0 && interpreted.ambiguous.length === 0) {
      return conversationalReply(request, body, interpreted.intent, authority, answerConversation, now);
    }
    return json({ ok: true, reviewMode: true, persistence: "NONE", tokenId: body.tokenId,
      responseKind: "STRATEGY_DRAFT", reply: punkReply(interpreted.confirmation), draft: {
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
