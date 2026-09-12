// Navigation/review intents only. Chat text can never authorize a transaction.
export function punkChatAction(message) {
  const text = String(message ?? "").trim();
  if (/^(?:please\s+)?(?:open|show(?: me)?) (?:the |my )?(?:forge|skill forge|skills|loadout)[.!?]*$/i.test(text)) return { kind: 'FORGE' };
  if (/^(?:please\s+)?(?:check (?:my |your |the )?(?:gas|balance|mission|status|readiness)|(?:what(?:'s| is)|show me) (?:your |my |the )?(?:status|gas balance|mission status)|are you (?:out|minting|scanning)(?: right now)?)[?.!]*$/i.test(text)) {
    return { kind: "STATUS" };
  }
  if (/^(?:(?:ok|okay)[, ]+)?(?:please\s+)?(?:recall(?: (?:my |the )?(?:punk|mission|agent))?|call (?:my |the )?punk back|come back|return home|pause(?: (?:my |the )?(?:punk|mission|agent))?(?: for tonight)?|stop (?:the mission|minting|scouting))(?:,? please)?[.!]*$/i.test(text)) return { kind: "RECALL" };
  if (/^(?:please\s+)?(?:fund|top up|add to|check) (?:my |your |the |agent )?gas(?: fund)?[.!]*$/i.test(text)) return { kind: "GAS", amount: null, source: null };
  const funding = text.match(/^(?:please\s+)?(?:move|transfer|add|use)\s+((?:0|[1-9]\d*)(?:\.\d{1,18})?)\s+eth\s+(?:from\s+)?(?:my |the |this )?(punk wallet|connected wallet|holder wallet)(?:\s+eth)?\s+(?:to|for|into)\s+(?:my |the |its )?(?:agent )?gas(?: fund)?[.!]*$/i);
  if (funding) return { kind: "GAS", amount: funding[1], source: /punk/i.test(funding[2]) ? "PUNK" : "OWNER" };
  return null;
}

export function agentChatStatus(status) {
  if (!status || status.error || !status.runtime?.accountCreated) return "I couldn't verify my Agent Account. No funding or mission was authorized. Use Check Autonomous Readiness to retry.";
  const eth = value => {
    if (!/^\d+$/.test(String(value ?? ""))) return "unverified";
    const n = BigInt(value), fraction = (n % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
    return `${n / 10n ** 18n}${fraction ? `.${fraction}` : ""} ETH`;
  };
  const active = status.runtime.sessionActive === true && status.mission?.status === "ACTIVE";
  return `Agent ETH: ${eth(status.runtime.nativeBalance)}. EntryPoint gas: ${eth(status.runtime.entryPointDeposit)}. ${active
    ? `Mission authorized: ${status.mission.completedMints ?? 0}/${status.mission.totalLimit} confirmed mints. This does not mean a transaction is currently being submitted.`
    : "No verified active mission. Tell me your mint count, free-only rule, gas cap per mint and reserve; I'll show a review before you sign."}`;
}
