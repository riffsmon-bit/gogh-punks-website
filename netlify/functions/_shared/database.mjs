import { getDatabase } from "@netlify/database";
import { getCaptureConfig } from "./config.mjs";
import { ClaimDecision, decideClaim } from "./claim-policy.mjs";
import { hashToken, randomToken } from "./session.mjs";

const CAP_LOCK_ID = 4_663_200;

export class CaptureError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CaptureError";
    this.code = code;
  }
}

function pool() {
  return getDatabase().pool;
}

function abbreviateWallet(walletAddress) {
  if (!walletAddress) return null;
  return `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`;
}

async function audit(client, eventType, discordUserId, walletAddress, detail = {}) {
  await client.query(
    `INSERT INTO gtd_audit_events
      (event_type, discord_user_id, wallet_abbreviated, detail)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [
      eventType,
      discordUserId ?? null,
      abbreviateWallet(walletAddress),
      JSON.stringify(detail),
    ],
  );
}

export async function createDiscordSession(discordUser) {
  const { sessionMinutes } = getCaptureConfig();
  const token = randomToken();
  const sessionHash = hashToken(token);
  const expiresAt = new Date(Date.now() + sessionMinutes * 60_000);
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE gtd_verification_sessions
          SET status = 'EXPIRED'
        WHERE discord_user_id = $1
          AND status IN ('DISCORD_AUTHENTICATED', 'PREPARED')`,
      [discordUser.id],
    );
    await client.query(
      `INSERT INTO gtd_verification_sessions
        (session_hash, discord_user_id, discord_username, discord_display_name, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        sessionHash,
        discordUser.id,
        discordUser.username,
        discordUser.global_name ?? null,
        expiresAt,
      ],
    );
    await audit(client, "DISCORD_AUTHENTICATED", discordUser.id, null);
    await client.query("COMMIT");
    return { token, expiresAt };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getSession(token) {
  if (!token) return null;
  const result = await pool().query(
    `SELECT
       session.session_hash,
       session.discord_user_id,
       session.discord_username,
       session.discord_display_name,
       session.wallet_address,
       session.siwe_message,
       session.status,
       session.failed_attempts,
       session.expires_at,
       linked.wallet_address AS linked_wallet_address,
       linked.verified_at,
       linked.role_sync_state,
       linked.role_synced_at
     FROM gtd_verification_sessions AS session
     LEFT JOIN gtd_wallet_links AS linked USING (discord_user_id)
     WHERE session_hash = $1
       AND expires_at > NOW()`,
    [hashToken(token)],
  );
  return result.rows[0] ?? null;
}

export async function getCaptureStats() {
  const { cap } = getCaptureConfig();
  const result = await pool().query(
    "SELECT COUNT(*)::integer AS claimed FROM gtd_wallet_links",
  );
  const claimed = Number(result.rows[0]?.claimed ?? 0);
  return {
    claimed,
    cap,
    remaining: Math.max(0, cap - claimed),
    open: claimed < cap,
  };
}

export async function savePreparedMessage(token, { walletAddress, nonce, message }) {
  const { signatureMinutes } = getCaptureConfig();
  const result = await pool().query(
    `UPDATE gtd_verification_sessions
        SET wallet_address = $2,
            siwe_nonce = $3,
            siwe_message = $4,
            status = 'PREPARED',
            failed_attempts = 0,
            expires_at = LEAST(
              expires_at,
              NOW() + ($5::text || ' minutes')::interval
            )
      WHERE session_hash = $1
        AND expires_at > NOW()
        AND status IN ('DISCORD_AUTHENTICATED', 'PREPARED')
      RETURNING discord_user_id, expires_at`,
    [hashToken(token), walletAddress.toLowerCase(), nonce, message, signatureMinutes],
  );
  if (!result.rows[0]) {
    throw new CaptureError(
      "SESSION_INVALID",
      "Your Discord verification session expired. Connect Discord again.",
    );
  }
  return result.rows[0];
}

export async function recordSignatureFailure(token, expectedMessage) {
  await pool().query(
    `UPDATE gtd_verification_sessions
        SET failed_attempts = failed_attempts + 1,
            status = CASE WHEN failed_attempts + 1 >= 5 THEN 'REJECTED' ELSE status END
      WHERE session_hash = $1
        AND siwe_message = $2`,
    [hashToken(token), expectedMessage],
  );
}

export async function completeCapture(token, expectedMessage, expectedWalletAddress) {
  const { cap, allocationLimit, priceEth } = getCaptureConfig();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [CAP_LOCK_ID]);
    const sessionResult = await client.query(
      `SELECT *
         FROM gtd_verification_sessions
        WHERE session_hash = $1
        FOR UPDATE`,
      [hashToken(token)],
    );
    const session = sessionResult.rows[0];
    if (
      !session ||
      session.status !== "PREPARED" ||
      session.siwe_message !== expectedMessage ||
      session.wallet_address !== expectedWalletAddress.toLowerCase() ||
      new Date(session.expires_at).getTime() <= Date.now()
    ) {
      throw new CaptureError(
        "SESSION_INVALID",
        "Your verification session expired. Connect Discord again.",
      );
    }

    const existingResult = await client.query(
      `SELECT wallet_address, discord_user_id
         FROM gtd_wallet_links
        WHERE wallet_address = $1 OR discord_user_id = $2`,
      [session.wallet_address, session.discord_user_id],
    );
    const countResult = await client.query(
      "SELECT COUNT(*)::integer AS claimed FROM gtd_wallet_links",
    );
    const claimed = Number(countResult.rows[0]?.claimed ?? 0);
    const decision = decideClaim({
      existingRows: existingResult.rows,
      walletAddress: session.wallet_address,
      discordUserId: session.discord_user_id,
      count: claimed,
      cap,
    });

    if (decision === ClaimDecision.WALLET_LINKED) {
      throw new CaptureError(
        "WALLET_LINKED",
        "This wallet is already connected to another Discord account.",
      );
    }
    if (decision === ClaimDecision.DISCORD_LINKED) {
      throw new CaptureError(
        "DISCORD_LINKED",
        "This Discord account has already captured a spot with another wallet.",
      );
    }
    if (decision === ClaimDecision.CAP_REACHED) {
      throw new CaptureError(
        "CAP_REACHED",
        `All ${cap} GTD wallet spots have been claimed.`,
      );
    }

    if (decision === ClaimDecision.CREATE) {
      await client.query(
        `INSERT INTO gtd_wallet_links
          (wallet_address, discord_user_id, discord_username, discord_display_name,
           allocation_limit, price_eth)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.wallet_address,
          session.discord_user_id,
          session.discord_username,
          session.discord_display_name,
          allocationLimit,
          priceEth,
        ],
      );
    }

    await client.query(
      `UPDATE gtd_verification_sessions
          SET status = 'VERIFIED', consumed_at = NOW()
        WHERE session_hash = $1`,
      [session.session_hash],
    );
    await audit(
      client,
      decision === ClaimDecision.CREATE ? "GTD_WALLET_CAPTURED" : "GTD_CAPTURE_REUSED",
      session.discord_user_id,
      session.wallet_address,
      { allocationLimit, priceEth },
    );
    await client.query("COMMIT");
    return {
      created: decision === ClaimDecision.CREATE,
      walletAddress: session.wallet_address,
      discordUserId: session.discord_user_id,
      allocationLimit,
      priceEth,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markRoleSync(walletAddress, state, errorCode = null) {
  await pool().query(
    `UPDATE gtd_wallet_links
        SET role_sync_state = $2,
            role_synced_at = CASE WHEN $2 = 'SYNCED' THEN NOW() ELSE role_synced_at END,
            last_role_sync_attempt_at = NOW(),
            role_sync_attempts = role_sync_attempts + 1,
            role_sync_error = $3
      WHERE wallet_address = $1`,
    [walletAddress.toLowerCase(), state, errorCode?.slice(0, 180) ?? null],
  );
}

export async function listRoleSyncCandidates(limit = 50) {
  const result = await pool().query(
    `SELECT wallet_address, discord_user_id
       FROM gtd_wallet_links
      WHERE role_sync_state <> 'SYNCED'
         OR role_synced_at IS NULL
         OR role_synced_at < NOW() - INTERVAL '4 hours'
      ORDER BY role_synced_at NULLS FIRST, verified_at
      LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function listCaptures() {
  const result = await pool().query(
    `SELECT wallet_address, discord_user_id, discord_username,
            discord_display_name, allocation_limit, price_eth,
            verified_at, role_sync_state, role_synced_at
       FROM gtd_wallet_links
      ORDER BY verified_at, wallet_address`,
  );
  return result.rows;
}

export async function cleanupExpiredSessions() {
  const result = await pool().query(
    `UPDATE gtd_verification_sessions
        SET status = 'EXPIRED'
      WHERE expires_at <= NOW()
        AND status IN ('DISCORD_AUTHENTICATED', 'PREPARED')`,
  );
  return result.rowCount ?? 0;
}
