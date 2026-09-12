// Examples fill the composer only. Sending, reviewing and signing remain separate.
const example = (id, group, title, prompt, note, status = "REVIEW FIRST", panel = null) =>
  Object.freeze({ id, group, title, prompt, note, status, panel });
const mintLimits = "Maximum one mint per day and one mint total. Max 0.0005 ETH gas per mint. Show me the mission for review.";

export const BROKER_PROMPTS = Object.freeze([
  example("free-pixel", "Mint missions", "Hunt a free pixel art mint",
    `Autonomously find and mint one free pixel art NFT. ${mintLimits}`,
    "Prefers pixel art. Review the gas cap, reserve, expiry and any retained collection restrictions before activating."),
  example("free-experimental", "Mint missions", "Hunt a free experimental mint",
    `Autonomously find and mint one free experimental NFT. No PFPs. ${mintLimits}`,
    "Prefers experimental art and avoids PFPs. Free minting still uses gas."),
  example("recommend", "Mint missions", "Scout and recommend",
    "Recommend only. Find free pixel art with a website or social profile. Maximum one mint per day and one mint total.",
    "Creates an ASK mission for review. ASK does not prepare a mint transaction."),
  example("assist", "Mint missions", "Prepare a free mint for me",
    `Assist me. Find one free pixel art NFT. ${mintLimits}`,
    "Creates an ASSIST draft. Review the exact available mint before approving it in your wallet."),
  example("directed-assist", "Mint missions", "Mint from an exact contract",
    `Mint one free NFT only from [collection contract]. Use Assist mode. ${mintLimits}`,
    "Replace [collection contract] with one Robinhood Chain collection address. Only supported, open free mints that pass screening and simulation can execute."),
  example("directed-auto", "Mint missions", "Send the agent to an exact mint",
    `Autonomously mint one free NFT only from [collection contract]. ${mintLimits}`,
    "Replace the contract placeholder. Review the exact collection, receiver and Agent Account authorization."),
  example("directed-link", "Mint missions", "Mint from an OpenSea collection link",
    `Mint one free NFT only from [OpenSea collection URL]. Use Assist mode. ${mintLimits}`,
    "Replace the URL placeholder. An unknown or ambiguous link needs the exact collection contract before a mission can be created."),
  example("taste", "Manage your agent", "Change collecting taste",
    "Prioritize pixel art and weird experimental art. Avoid PFPs.",
    "Updates the taste draft while retaining existing mission limits and collection restrictions."),
  example("limits", "Manage your agent", "Change mint and gas limits",
    "Maximum one mint per day and one mint total. Max 0.0005 ETH gas per mint. Show me the updated rules.",
    "These amounts are examples. Check your reserve and expiry in the review; the gas cap applies per mint."),
  example("recall", "Manage your agent", "Call my agent back",
    "ok recall please", "Send this to the selected Punk. Confirm session revocation in your wallet if requested, then wait for confirmed paused status."),
  example("status", "Manage your agent", "Check live gas and mission status",
    "Check my status", "Reads the selected Agent Account and mission status.", "READ ONLY"),
  example("activity", "Manage your agent", "See discoveries and receipts",
    "Show my activity", "Opens Activity with mission checks, discoveries and transaction results.", "READ ONLY", "activity"),
  example("strategy", "Manage your agent", "Review current collecting rules",
    "Show my strategy", "Opens the selected Punk's collecting rules and Agent Account readiness.", "READ ONLY", "strategy"),
  example("gas", "Wallet and funds", "Fund Agent gas",
    "Fund gas", "Choose the funding source and amount in the gas review before signing."),
  example("gas-punk", "Wallet and funds", "Use Punk Wallet ETH for gas",
    "Move 0.0005 ETH from my Punk Wallet to agent gas",
    "Opens a funding review with an example amount. The Punk Wallet's protected reserve still applies."),
  example("gas-owner", "Wallet and funds", "Use connected-wallet ETH for gas",
    "Add 0.0005 ETH from my connected wallet for gas",
    "Opens a funding review. Check the exact source, Agent destination and amount before signing."),
  example("wallet", "Wallet and funds", "Deposit or withdraw Punk Wallet ETH",
    "Open my wallet", "Opens Fund. Enter an amount in the deposit or withdrawal form and review the destination.", "OPEN CONTROLS", "fund"),
  example("wrap", "Wallet and funds", "Wrap ETH into WETH",
    "Open WETH controls", "In Fund → ETH ↔ WETH, choose WRAP and enter your amount. Wrapping does not create a bid.", "OPEN CONTROLS", "fund"),
  example("unwrap", "Wallet and funds", "Unwrap WETH into ETH",
    "Open WETH controls", "In Fund → ETH ↔ WETH, choose UNWRAP and review the amount before signing.", "OPEN CONTROLS", "fund"),
  example("collection", "Wallet and funds", "View or withdraw collected NFTs",
    "Show my collection", "Opens Collection. Select an NFT to review its withdrawal to your connected owner wallet.", "OPEN CONTROLS", "collection"),
  example("chat", "Research and skills", "Talk about collecting art",
    "What do you think about pixel art, and how does it fit my collecting strategy?",
    "Starts a conversation with your Punk without changing the mission.", "READ ONLY"),
  example("link", "Research and skills", "Inspect a collection or mint link",
    "Open link check", "Paste one supported collection or mint URL into the link checker.", "READ ONLY", "link"),
  example("playbook", "Research and skills", "Teach a scouting routine",
    "Teach yourself to rank small pixel collections and explain the screening result.",
    "Review a read-only playbook skill. Permanent Forge learning uses separate training credits."),
  example("contract-research", "Research and skills", "Inspect a contract in Forge",
    "Open the Forge", "Choose Contract Detective in the research lab and enter the contract. Lab access is checked when you sign in.", "RESEARCH LAB", "forge"),
  example("rarity", "Research and skills", "Compare rarity",
    "Open the Forge", "Choose Rarity Eye in the research lab. Check the collection and token IDs before running it.", "RESEARCH LAB", "forge"),
  example("market", "Research and skills", "Research floor listings",
    "Open the Forge", "Choose Market Scout to inspect listings. Research does not buy NFTs or publish bids.", "RESEARCH LAB", "forge"),
  example("burn", "Permanent training", "Burn a Punk for training credit",
    "Open the Forge", "Choose a source Punk and a different recipient when burn review is released. Burning permanently destroys the source NFT and can remove access to its wallets. The deployed Forge is paused; production burn and recovery integration is unfinished.", "NOT LIVE", "forge"),
  example("learn", "Permanent training", "Spend a credit to learn a skill",
    "Open my skills", "Permanent learning spends a Forge training credit. The deployed registry is paused and has no released skills.", "NOT LIVE", "forge"),
  example("loadout", "Permanent training", "Equip, unequip or unlock a slot",
    "Open my loadout", "View the Forge profile. Live equipment changes and credit-funded slot unlocks are not released yet.", "NOT LIVE", "forge"),
  example("paid", "Marketplace missions", "Mint a paid NFT",
    "Mint one NFT from [collection contract] for up to 0.001 ETH. Show me the exact price and gas before approval.",
    "Example request only. Paid-mint review and execution are not connected in this broker.", "NOT LIVE"),
  example("sweep", "Marketplace missions", "Sweep a collection floor",
    "Sweep the two cheapest NFTs in [collection contract]. Maximum 0.002 ETH total including marketplace fees. Show me the exact listings and gas before approval.",
    "Example request only. Floor purchases need listing review, purchase execution and receipt tracking before live testing.", "NOT LIVE"),
  example("bid", "Marketplace missions", "Make a WETH collection bid",
    "Place a collection bid for one NFT in [collection contract] at 0.001 WETH, expiring in one hour. Show me the offer before approval.",
    "Example request only. Bid review, signing, publishing, cancellation and settlement are not implemented yet. WETH wrapping is available separately.", "NOT LIVE"),
  example("settings", "Manage your agent", "Open agent settings",
    "Open settings", "Review the selected Punk's operating mode and preferences.", "OPEN CONTROLS", "settings"),
]);

export function mountBrokerPromptLibrary({ root, input, openPanel }) {
  const doc = root.ownerDocument;
  const select = root.querySelector("[data-prompt-choice]");
  const title = root.querySelector("[data-prompt-title]");
  const status = root.querySelector("[data-prompt-status]");
  const text = root.querySelector("[data-prompt-example]");
  const note = root.querySelector("[data-prompt-note]");
  const use = root.querySelector("[data-use-prompt]");
  const open = root.querySelector("[data-prompt-open-panel]");
  const groups = new Map();
  for (const item of BROKER_PROMPTS) {
    if (!groups.has(item.group)) {
      const group = doc.createElement("optgroup"); group.label = item.group;
      groups.set(item.group, group); select.append(group);
    }
    const option = doc.createElement("option"); option.value = item.id;
    option.textContent = `${item.title}${item.status === "NOT LIVE" ? " · Not live" : ""}`;
    groups.get(item.group).append(option);
  }
  const selected = () => BROKER_PROMPTS.find(item => item.id === select.value);
  const render = () => {
    const item = selected(); if (!item) return;
    root.querySelector("[data-prompt-feedback]").textContent = "";
    title.textContent = item.title; status.textContent = item.status;
    status.dataset.availability = item.status === "NOT LIVE" ? "unreleased" : "available";
    text.textContent = item.prompt; note.textContent = item.note;
    open.hidden = !item.panel;
    open.textContent = item.panel === "link" ? "OPEN LINK CHECK" : `OPEN ${item.panel?.toUpperCase() ?? "PANEL"}`;
  };
  select.addEventListener("change", render);
  use.addEventListener("click", () => {
    const item = selected(); if (!item) return;
    input.value = item.prompt;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    const placeholder = /\[[^\]]+\]/.exec(item.prompt);
    if (placeholder) input.setSelectionRange(placeholder.index, placeholder.index + placeholder[0].length);
    root.querySelector("[data-prompt-feedback]").textContent = placeholder
      ? "Example added. Replace the highlighted placeholder and review your amounts before sending."
      : "Example added to your message. Review it before sending.";
  });
  open.addEventListener("click", () => { const item = selected(); if (item?.panel) openPanel(item.panel); });
  select.value = "free-pixel"; render();
}
