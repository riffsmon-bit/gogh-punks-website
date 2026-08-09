export const ClaimDecision = Object.freeze({
  CREATE: "CREATE",
  IDEMPOTENT: "IDEMPOTENT",
  WALLET_LINKED: "WALLET_LINKED",
  DISCORD_LINKED: "DISCORD_LINKED",
  CAP_REACHED: "CAP_REACHED",
});

export function decideClaim({ existingRows, walletAddress, discordUserId, count, cap }) {
  const normalizedWallet = walletAddress.toLowerCase();
  const exact = existingRows.find(
    (row) =>
      row.wallet_address === normalizedWallet &&
      row.discord_user_id === discordUserId,
  );
  if (exact) return ClaimDecision.IDEMPOTENT;
  if (existingRows.some((row) => row.wallet_address === normalizedWallet)) {
    return ClaimDecision.WALLET_LINKED;
  }
  if (existingRows.some((row) => row.discord_user_id === discordUserId)) {
    return ClaimDecision.DISCORD_LINKED;
  }
  if (count >= cap) return ClaimDecision.CAP_REACHED;
  return ClaimDecision.CREATE;
}
