import { inspectArtBrokerLink } from "../../broker/src/v4/link-scanner.mjs";
import { PublicError, json, readJson } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { requireV2DeployPreview } from "./_shared/v2-review.mjs";

const TOKEN = /^(?:0|[1-9]\d{0,3})$/;
const OWNER = /^0x[0-9a-f]{40}$/;

export async function handleV2ReviewInspectUrl(request, { environment = process.env,
  readAuthority = readV2PunkAuthority, inspect = inspectArtBrokerLink } = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    requireV2DeployPreview(request, environment);
    const body = await readJson(request, 8_192);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 3
      || !["owner", "tokenId", "url"].every((field) => Object.hasOwn(body, field))) {
      throw new PublicError(400, "INVALID_REQUEST", "The review link request is invalid.");
    }
    const owner = typeof body.owner === "string" ? body.owner.toLowerCase() : "";
    const tokenId = String(body.tokenId ?? "");
    if (!OWNER.test(owner) || !TOKEN.test(tokenId) || typeof body.url !== "string") {
      throw new PublicError(400, "INVALID_REQUEST", "Choose an owned Punk and paste a valid link.");
    }
    await readAuthority(tokenId, { expectedOwner: owner });
    const inspection = await inspect(body.url);
    return json({ ok: true, reviewMode: true, persistence: "NONE", inspection,
      message: "Link normalized for review. No external transaction data was accepted.",
      transactionPrepared: false, externalCalldataAccepted: false });
  } catch (error) {
    return v2Failure(error);
  }
}

export default handleV2ReviewInspectUrl;

export const config = { path: "/api/v2/review/inspect-url", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 30, windowSize: 60,
} };
