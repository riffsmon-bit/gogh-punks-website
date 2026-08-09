import { randomUUID } from "node:crypto";
import {
  CaptureError,
  completeCapture,
  getCaptureStats,
  getSession,
  markRoleSync,
  recordSignatureFailure,
  savePreparedMessage,
} from "./_shared/database.mjs";
import { DiscordError, syncGtdRoles } from "./_shared/discord.mjs";
import {
  json,
  PublicError,
  publicFailure,
  readJson,
  requireSameOrigin,
} from "./_shared/http.mjs";
import { parseCookies, SESSION_COOKIE } from "./_shared/session.mjs";
import {
  buildVerificationMessage,
  normalizeWalletAddress,
  verifyWalletSignature,
  WalletVerificationError,
} from "./_shared/verification.mjs";
import { getCaptureConfig } from "./_shared/config.mjs";

function sessionToken(request) {
  return parseCookies(request).get(SESSION_COOKIE) ?? null;
}

function abbreviated(walletAddress) {
  return walletAddress
    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
    : null;
}

function mapKnownError(error) {
  if (error instanceof CaptureError || error instanceof WalletVerificationError) {
    const status =
      error.code === "CAP_REACHED" ? 409 : error.code.endsWith("LINKED") ? 409 : 400;
    return new PublicError(status, error.code, error.message);
  }
  return error;
}

async function statusResponse(request) {
  const [stats, session] = await Promise.all([
    getCaptureStats(),
    getSession(sessionToken(request)),
  ]);
  return json({
    ok: true,
    capture: stats,
    discord: session
      ? {
          connected: true,
          username: session.discord_display_name || session.discord_username,
          claimed: Boolean(session.linked_wallet_address),
          wallet: abbreviated(session.linked_wallet_address),
          roleSyncState: session.role_sync_state ?? null,
        }
      : { connected: false, claimed: false },
  });
}

async function prepareResponse(request) {
  requireSameOrigin(request);
  const token = sessionToken(request);
  const session = await getSession(token);
  if (!session) {
    throw new PublicError(
      401,
      "DISCORD_REQUIRED",
      "Connect your Discord account before connecting a wallet.",
    );
  }
  if (session.linked_wallet_address) {
    throw new PublicError(409, "ALREADY_CLAIMED", "This Discord account already has GTD.");
  }
  const body = await readJson(request);
  const { chainId } = getCaptureConfig();
  if (Number(body.chainId) !== chainId) {
    throw new PublicError(
      400,
      "WRONG_CHAIN",
      `Switch your wallet to Robinhood Chain (chain ID ${chainId}).`,
    );
  }
  const walletAddress = normalizeWalletAddress(body.address);
  const verification = buildVerificationMessage({
    walletAddress,
    discordUserId: session.discord_user_id,
    requestId: randomUUID(),
  });
  await savePreparedMessage(token, {
    walletAddress,
    nonce: verification.nonce,
    message: verification.message,
  });
  return json({
    ok: true,
    message: verification.message,
    expiresAt: verification.expirationTime.toISOString(),
  });
}

async function completeResponse(request) {
  requireSameOrigin(request);
  const token = sessionToken(request);
  const session = await getSession(token);
  if (!session || session.status !== "PREPARED" || !session.siwe_message) {
    throw new PublicError(
      401,
      "SESSION_INVALID",
      "Prepare a fresh wallet verification request.",
    );
  }
  const body = await readJson(request);
  try {
    await verifyWalletSignature({
      walletAddress: session.wallet_address,
      message: session.siwe_message,
      signature: String(body.signature ?? ""),
    });
  } catch (error) {
    if (error instanceof WalletVerificationError) {
      await recordSignatureFailure(token, session.siwe_message);
    }
    throw error;
  }
  const capture = await completeCapture(
    token,
    session.siwe_message,
    session.wallet_address,
  );

  let roleSyncState = "SYNCED";
  try {
    await syncGtdRoles(capture.discordUserId);
    await markRoleSync(capture.walletAddress, "SYNCED");
  } catch (error) {
    roleSyncState = "PENDING";
    const state = error instanceof DiscordError && error.code === "NOT_MEMBER"
      ? "NOT_MEMBER"
      : "ERROR";
    await markRoleSync(capture.walletAddress, state, error?.code ?? "ROLE_SYNC_FAILED");
  }
  const stats = await getCaptureStats();
  return json({
    ok: true,
    captured: true,
    created: capture.created,
    wallet: abbreviated(capture.walletAddress),
    allocationLimit: capture.allocationLimit,
    priceEth: capture.priceEth,
    roleSyncState,
    capture: stats,
  });
}

export default async function handler(request) {
  try {
    const path = new URL(request.url).pathname;
    if (path === "/api/verification/status" && request.method === "GET") {
      return statusResponse(request);
    }
    if (path === "/api/verification/prepare" && request.method === "POST") {
      return prepareResponse(request);
    }
    if (path === "/api/verification/complete" && request.method === "POST") {
      return completeResponse(request);
    }
    throw new PublicError(404, "NOT_FOUND", "The verification route was not found.");
  } catch (error) {
    return publicFailure(mapKnownError(error));
  }
}

export const config = {
  path: [
    "/api/verification/status",
    "/api/verification/prepare",
    "/api/verification/complete",
  ],
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowLimit: 80,
    windowSize: 60,
  },
};
