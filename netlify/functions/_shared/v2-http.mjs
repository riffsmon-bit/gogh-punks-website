import { ArtBrokerProviderError } from "../../../broker/src/v4/ai/provider.mjs";
import { json, PublicError } from "./http.mjs";

export function v2Failure(error) {
  if (error instanceof PublicError) {
    return json({ ok: false, code: error.code, message: error.message }, error.status);
  }
  if (error instanceof ArtBrokerProviderError) {
    const status = error.code === "AI_QUOTA_EXCEEDED" ? 429 : 503;
    return json({ ok: false, code: error.code, message: error.message,
      policyState: "UNCHANGED" }, status);
  }
  console.error(JSON.stringify({ event: "ART_BROKER_V2_REQUEST_FAILED",
    type: error?.name ?? "Error", code: error?.code ?? null }));
  return json({ ok: false, code: "V2_SERVICE_UNAVAILABLE",
    message: "Art Broker V2 is temporarily unavailable. Existing rules and assets are unchanged." }, 503);
}
