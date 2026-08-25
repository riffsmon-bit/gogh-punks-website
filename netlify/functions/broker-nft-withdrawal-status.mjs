import automationManifest from "../../deployments/robinhood-automation-v3.json" with { type: "json" };
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { requireVerifiedManifestAdoption } from
  "../../broker/src/recommendation/source-verification-adoption.mjs";
import { json } from "./_shared/http.mjs";
import { readAutomationV3RecoveryState } from "./_shared/autonomy-v3-live.mjs";

const CONTRACT_NAMES = Object.freeze([
  "AutomatedSeaDropStudioFreeMintAdapter",
  "BrokerPolicyModuleV3",
  "GoghPunkAccountV3",
  "GoghPunkAccountRegistryV3",
]);

function address(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase() : null;
}

function hash(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)
    && !/^0x0{64}$/.test(value) ? value.toLowerCase() : null;
}

export function nftWithdrawalSurface(manifest = automationManifest) {
  try {
    requireVerifiedManifestAdoption(manifest, CONTRACT_NAMES);
  } catch {
    return Object.freeze({ capability: false, reason: "V3_SOURCE_ADOPTION_INVALID", bindings: null });
  }
  const implementation = manifest?.contracts?.GoghPunkAccountV3;
  const registry = manifest?.contracts?.GoghPunkAccountRegistryV3;
  const valid = manifest?.schema === "GOGH_AUTOMATED_SEADROP_V3_DEPLOYMENT_MANIFEST"
    && manifest?.version === 1 && manifest?.status === "DEPLOYED" && manifest?.chainId === 4663
    && implementation?.verificationStatus === "VERIFIED"
    && registry?.verificationStatus === "VERIFIED"
    && implementation?.receiptStatus === "SUCCESS" && registry?.receiptStatus === "SUCCESS"
    && address(implementation?.address) && hash(implementation?.runtimeBytecodeHash)
    && address(registry?.address) && hash(registry?.runtimeBytecodeHash);
  if (!valid) {
    return Object.freeze({ capability: false, reason: "V3_DEPLOYMENT_UNVERIFIED", bindings: null });
  }
  return Object.freeze({
    capability: true,
    reason: null,
    bindings: Object.freeze({
      chainId: 4663,
      punkCollection: address(ROBINHOOD.canonicalCollection),
      accountImplementation: address(implementation.address),
      accountRegistry: address(registry.address),
    }),
  });
}

export async function buildNftWithdrawalGate(
  tokenId,
  { manifest = automationManifest, readRecovery = readAutomationV3RecoveryState } = {},
) {
  const surface = nftWithdrawalSurface(manifest);
  if (!surface.capability) {
    return Object.freeze({
      status: "UNAVAILABLE", capability: false, reason: surface.reason, bindings: null,
    });
  }
  try {
    const live = await readRecovery(tokenId);
    if (!live.created) {
      return Object.freeze({
        status: "ACCOUNT_NOT_ACTIVATED", capability: false,
        reason: "V3_PUNK_ACCOUNT_NOT_ACTIVATED", bindings: null,
      });
    }
    return Object.freeze({
      status: "READY_FOR_LIVE_OWNER_CHECK",
      capability: true,
      reason: null,
      checkedAt: new Date().toISOString(),
      bindings: Object.freeze({
        ...surface.bindings,
        punkTokenId: live.tokenId,
        account: live.account,
        expectedOwner: live.owner,
        accountRuntimeCodeHash: live.accountRuntimeCodeHash,
        destination: live.owner,
        supportedStandards: Object.freeze(["ERC721", "ERC1155"]),
      }),
    });
  } catch {
    return Object.freeze({
      status: "LIVE_READ_UNAVAILABLE", capability: false,
      reason: "V3_RECOVERY_LIVE_READ_UNAVAILABLE", bindings: null,
    });
  }
}

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const tokenId = new URL(request.url).searchParams.get("tokenId");
  if (typeof tokenId !== "string" || !/^(?:0|[1-9][0-9]{0,3})$/.test(tokenId)) {
    return json({ ok: false, code: "INVALID_PUNK_TOKEN_ID" }, 400);
  }
  const recovery = await buildNftWithdrawalGate(tokenId);
  return json({ ok: true, recovery }, 200, {
    "cache-control": "no-store, max-age=0",
    "netlify-cdn-cache-control": "no-store",
  });
}

export const config = {
  path: "/api/broker/nft-withdrawal-status",
  method: "GET",
  rateLimit: {
    action: "rate_limit", aggregateBy: ["ip"], windowLimit: 90, windowSize: 60,
  },
};
