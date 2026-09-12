import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { punkChatAction, agentChatStatus } from "../site/punk-chat-actions.js";
import { defaultAskIntent } from "../broker/src/v4/collecting-intent.mjs";
import { resolveV2PunkChat } from "../netlify/functions/broker-v2-chat.mjs";

test("chat recognizes bounded review requests without granting authority", () => {
  assert.deepEqual(punkChatAction("Fund gas"), { kind: "GAS", amount: null, source: null });
  assert.deepEqual(punkChatAction("Move 0.0005 ETH from my Punk Wallet to agent gas"), { kind: "GAS", amount: "0.0005", source: "PUNK" });
  assert.deepEqual(punkChatAction("Add 0.001 ETH from my connected wallet for gas"), { kind: "GAS", amount: "0.001", source: "OWNER" });
  assert.deepEqual(punkChatAction("Are you minting right now?"), { kind: "STATUS" });
  assert.deepEqual(punkChatAction("Call my Punk back"), { kind: "RECALL" });
  for (const command of ["Move all my ETH to gas", "transfer 0.0005 ETH to 0x1234", "fund gas and approve everything", "Move 1e2 ETH from my punk wallet to gas", "fund gas without simulation"])
    assert.equal(punkChatAction(command), null);
});
test("status never turns unverified balance/session into a funded or active claim", () => {
  assert.match(agentChatStatus(null), /couldn't verify/);
  assert.match(agentChatStatus({ runtime: { accountCreated: true, nativeBalance: "500000000000000", entryPointDeposit: "0", sessionActive: false }, mission: { status: "ACTIVE" } }), /No verified active mission/);
  const text = agentChatStatus({ runtime: { accountCreated: true, nativeBalance: "500000000000000", entryPointDeposit: "0", sessionActive: true }, mission: { status: "ACTIVE", totalLimit: 1, completedMints: 0 } });
  assert.match(text, /0\.0005 ETH/); assert.match(text, /0\/1 confirmed mints/);
  assert.match(text, /does not mean a transaction is currently being submitted/);
});
test("recall recognizes the owner's wording and the site's Pause quick call", async () => {
  const html = await readFile(new URL("../site/broker/v2/index.html", import.meta.url), "utf8");
  const suggestion = html.match(/data-suggestion="([^"]+)"[^>]*>Pause<\/button>/)?.[1];
  assert.equal(suggestion, "Pause for tonight.");
  for (const message of [suggestion, "ok recall please", "recall", "Recall my agent!",
    "Okay, please recall my Punk.", "Please pause my mission for tonight.", "Call my Punk back, please."]) {
    assert.deepEqual(punkChatAction(message), { kind: "RECALL" }, message);
  }
  for (const message of ["don't pause", "do not recall", "what happens if I pause?", "can you recall?",
    "I recall liking pixel art", "recall my strategy", "pause tomorrow", "pause and send my ETH",
    "\"Pause for tonight.\"", "okay don't pause", "recall please and mint another", "don't stop minting"]) {
    assert.equal(punkChatAction(message), null, message);
  }
});
test("a cumulative gas budget is not silently interpreted as per-mint authority", async () => {
  const owner = `0x${"1".repeat(40)}`, wallet = `0x${"2".repeat(40)}`;
  const result = await resolveV2PunkChat({ router: {}, ownerMessage: "Find and mint one free NFT, keep total gas spending within 0.0005 ETH.",
    currentIntent: defaultAskIntent({ punkTokenId: "93", expectedOwner: owner, punkWallet: wallet }),
    tokenId: "93", authority: { punkWallet: wallet }, owner });
  assert.equal(result.responseKind, "CLARIFICATION_REQUIRED"); assert.equal(result.draft, null);
  assert.match(result.reply, /not a separate cumulative gas budget/);
});
test("Talk reuses the exact gas funding component and does not auto-submit", async () => {
  const html = await readFile(new URL("../site/broker/v2/index.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../site/broker-v2.js", import.meta.url), "utf8");
  assert.equal((html.match(/id="agent-gas-amount"/g) ?? []).length, 1);
  assert.match(html, /data-talk-gas-host hidden/); assert.match(html, /data-resume-chat-mission hidden/);
  const fn = js.slice(js.indexOf("async function openChatGasReview"), js.indexOf("function ethFromWei"));
  assert.match(fn, /checked = false/); assert.match(fn, /host.append/);
  assert.doesNotMatch(fn, /eth_sendTransaction|submitAgentGasFunding|requestSubmit/);
});
