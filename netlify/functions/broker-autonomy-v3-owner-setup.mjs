import { buildAutomatedSeaDropV3OwnerSetup } from
  "../../broker/src/recommendation/automated-seadrop-v3-owner-setup.mjs";
import { json } from "./_shared/http.mjs";
import { buildLiveOwnerSetupInput } from "./_shared/autonomy-v3-live.mjs";

function integerParam(params, name, fallback) {
  const value = params.get(name) ?? fallback;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new TypeError(`${name} is invalid`);
  return Number(value);
}

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const params = new URL(request.url).searchParams;
    const tokenId = params.get("tokenId") ?? "";
    const input = await buildLiveOwnerSetupInput(tokenId, {
      maxMintsPerUtcDay: integerParam(params, "cap", "1"),
      authorizationDays: integerParam(params, "days", "7"),
    });
    const artifact = buildAutomatedSeaDropV3OwnerSetup(input, {
      nowSeconds: Math.floor(Date.parse(input.checkedAt) / 1_000),
    });
    return json({ ok: true, artifact }, 200, {
      "cache-control": "no-store, max-age=0",
      "netlify-cdn-cache-control": "no-store",
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "AUTOMATION_V3_OWNER_SETUP_REJECTED", code: error?.code ?? "FAILED" }));
    return json({ ok: false, code: error?.code ?? "SETUP_UNAVAILABLE", message: "Live V3 setup is not ready or the selected Punk failed its owner/account checks." }, 409, {
      "cache-control": "no-store, max-age=0",
    });
  }
}

export const config = {
  path: "/api/broker/autonomy-v3-owner-setup",
  method: "GET",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip"], windowLimit: 20, windowSize: 60 },
};
