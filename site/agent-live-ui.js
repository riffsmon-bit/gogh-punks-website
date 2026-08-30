const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/;
const TOKEN_ID = /^(?:0|[1-9][0-9]{0,3})$/;

const SCANNING_STATES = new Set([
  "SCANNING", "CANDIDATE_FOUND", "VERIFYING_CONTRACT", "CHECKING_PRICE",
  "CHECKING_ELIGIBILITY", "CHECKING_LIMITS", "SIMULATING", "READY",
]);
const MINTING_STATES = new Set(["SUBMITTING", "CONFIRMING"]);

export function agentVisualState(heartbeat, active = false) {
  const state = String(heartbeat?.state ?? heartbeat?.status ?? "");
  if (MINTING_STATES.has(state)) return "MINTING";
  if (SCANNING_STATES.has(state)) return "SCANNING";
  if (state === "QUEUED") return "QUEUED";
  if (state === "MINTED" || state === "MINT_CONFIRMED") return "MINTED";
  if (state === "PAUSED") return "PAUSED";
  if (state === "ERROR" || state === "FAILED") return "NEEDS_ATTENTION";
  return active ? "ACTIVE" : "INACTIVE";
}

export function confirmedMintHash(heartbeat) {
  const direct = heartbeat?.transactionHash;
  const retained = heartbeat?.lastSuccessfulMint;
  const value = typeof direct === "string" ? direct.toLowerCase()
    : typeof retained === "string" ? retained.toLowerCase() : null;
  return TRANSACTION_HASH.test(value ?? "") ? value : null;
}

export function showConfirmedMintToast({ documentObject, tokenId, transactionHash }) {
  if (!documentObject || !TOKEN_ID.test(String(tokenId))
    || !TRANSACTION_HASH.test(String(transactionHash).toLowerCase())) return null;
  documentObject.querySelector?.("[data-agent-mint-toast]")?.remove?.();
  const toast = documentObject.createElement("aside");
  toast.className = "agent-mint-toast";
  toast.dataset.agentMintToast = "";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  const mark = documentObject.createElement("span");
  mark.className = "agent-mint-toast-mark";
  mark.textContent = "✓";
  const copy = documentObject.createElement("div");
  const title = documentObject.createElement("strong");
  title.textContent = `Punk #${tokenId} collected an NFT`;
  const detail = documentObject.createElement("span");
  detail.textContent = "The mint is confirmed and its Punk Wallet is refreshing.";
  const link = documentObject.createElement("a");
  link.href = `https://robinhoodchain.blockscout.com/tx/${transactionHash}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "View transaction ↗";
  copy.append(title, detail, link);
  const close = documentObject.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss mint notification");
  close.textContent = "×";
  close.addEventListener("click", () => toast.remove());
  toast.append(mark, copy, close);
  documentObject.body?.append?.(toast);
  return toast;
}
