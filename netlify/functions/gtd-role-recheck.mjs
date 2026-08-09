import {
  cleanupExpiredSessions,
  listRoleSyncCandidates,
  markRoleSync,
} from "./_shared/database.mjs";
import { DiscordError, syncGtdRoles } from "./_shared/discord.mjs";

export default async function handler() {
  const candidates = await listRoleSyncCandidates(25);
  let synced = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      await syncGtdRoles(candidate.discord_user_id);
      await markRoleSync(candidate.wallet_address, "SYNCED");
      synced += 1;
    } catch (error) {
      const state = error instanceof DiscordError && error.code === "NOT_MEMBER"
        ? "NOT_MEMBER"
        : "ERROR";
      await markRoleSync(
        candidate.wallet_address,
        state,
        error?.code ?? "ROLE_SYNC_FAILED",
      );
      failed += 1;
    }
  }
  const expiredSessions = await cleanupExpiredSessions();
  console.log(
    JSON.stringify({ event: "GTD_ROLE_RECHECK", checked: candidates.length, synced, failed, expiredSessions }),
  );
}

export const config = { schedule: "@hourly" };
