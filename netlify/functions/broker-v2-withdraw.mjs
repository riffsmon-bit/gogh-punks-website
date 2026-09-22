import { getDatabase } from "@netlify/database";
import { json } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { v2TokenIdFrom } from "./_shared/v2-route.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const pool = getDatabase().pool;
  try {
    const tokenId = v2TokenIdFrom(request, "/withdraw");
    const session = await requireV2Session(request, pool);
    const authority = await readV2PunkAuthority(tokenId, { expectedOwner: session.walletAddress });
    return json({ ok: true, tokenId, punkWallet: authority.punkWallet,
      currentOwner: authority.owner, requiresAI: false, requiresDiscovery: false,
      requiresExecutor: false, supported: ["NATIVE", "ERC721", "ERC1155", "CANONICAL_WETH", "ERC20"],
      tokenWithdrawal: { url: `/api/v2/punks/${tokenId}/erc20-withdraw`,
        wallets: ["V3", "AGENT"], destination: "CURRENT_OWNER", requiresExactTransferSimulation: true,
        unsupportedSemantics: ["FEE_ON_TRANSFER", "REBASING", "FALSE_RETURN", "NO_RETURN"],
        transactionPrepared: false },
      controlCenterUrl: `/broker/punk/${tokenId}?tab=assets`,
      agentRecovery: { controlCenterUrl: `/broker/v2/?tab=fund&tokenId=${tokenId}#agent-recovery`,
        supported: ["NATIVE", "ENTRY_POINT", "ERC721", "ERC1155"],
        requiresCurrentOwnerReview: true, transactionPrepared: false },
      transactionPrepared: false });
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/punks/:tokenId/withdraw", method: "GET", rateLimit: {
  action: "rate_limit", aggregateBy: ["ip"], windowLimit: 60, windowSize: 60,
} };
