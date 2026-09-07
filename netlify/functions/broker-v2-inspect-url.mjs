import { getDatabase } from "@netlify/database";
import { inspectArtBrokerLink } from "../../broker/src/v4/link-scanner.mjs";
import { PublicError, json, readJson, requireSameOrigin } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

export default async function handler(request) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const pool = getDatabase().pool;
  try {
    requireSameOrigin(request);
    const session = await requireV2Session(request, pool);
    const body = await readJson(request, 8_192);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 2 || !Object.hasOwn(body, "tokenId")
      || !Object.hasOwn(body, "url") || typeof body.tokenId !== "string") {
      throw new PublicError(400, "INVALID_REQUEST", "The link inspection request is invalid.");
    }
    await readV2PunkAuthority(body.tokenId, { expectedOwner: session.walletAddress });
    const inspection = await inspectArtBrokerLink(body.url);
    return json({ ok: true, inspection, message: inspection.status === "NEEDS_REVIEW"
      ? "Project identified. A trusted on-chain resolver is required before screening or simulation."
      : "Link inspection complete.", transactionPrepared: false, externalCalldataAccepted: false });
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/inspect-url", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 20, windowSize: 60,
} };
