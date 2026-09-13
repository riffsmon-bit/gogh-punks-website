import { getDatabase } from "@netlify/database";
import { ArtBrokerLinkError, inspectArtBrokerLink } from "../../broker/src/v4/link-scanner.mjs";
import { PublicError, json, readJson, requireSameOrigin } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

const LINK_INPUT_ERRORS = new Set([
  "INVALID_URL", "PRIVATE_URL_BLOCKED", "UNSUPPORTED_URL", "UNSUPPORTED_CHAIN",
]);

export async function handleV2InspectUrl(request, { pool,
  requireSession = requireV2Session, readAuthority = readV2PunkAuthority,
  inspect = inspectArtBrokerLink } = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const databasePool = pool ?? getDatabase().pool;
  try {
    requireSameOrigin(request);
    const session = await requireSession(request, databasePool);
    const body = await readJson(request, 8_192);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 2 || !Object.hasOwn(body, "tokenId")
      || !Object.hasOwn(body, "url") || typeof body.tokenId !== "string") {
      throw new PublicError(400, "INVALID_REQUEST", "The link inspection request is invalid.");
    }
    await readAuthority(body.tokenId, { expectedOwner: session.walletAddress });
    const inspection = await inspect(body.url);
    return json({ ok: true, inspection, message: inspection.status === "NEEDS_REVIEW"
      ? "Project identified. A trusted on-chain resolver is required before screening or simulation."
      : "Link inspection complete.", transactionPrepared: false, externalCalldataAccepted: false });
  } catch (error) {
    if (error instanceof ArtBrokerLinkError && LINK_INPUT_ERRORS.has(error.code)) {
      return json({ ok: false, code: error.code, message: error.message }, 400);
    }
    return v2Failure(error);
  }
}

export default async function handler(request) {
  return handleV2InspectUrl(request);
}

export const config = { path: "/api/v2/inspect-url", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 20, windowSize: 60,
} };
