import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  automationGateNeedsLegacyFallback, automationPunkWalletOpenSeaUrl,
  automationSelectionChanged,
  buildAutomationGasFundingTransaction,
  createCoalescedRefresh, formatAutomationGasBalance, RETIREMENT_MINT_LIFETIMES,
  automationTerminalSnapshot, ownerRosterHasNoPunks, retirementActivationDisclosure, selectAutomationGeneration,
  selectedAutomationPunk,
} from "../site/autonomous-minting.js";
import { DRAFT_RARITY_MINT_LIMITS } from "../broker/src/retirement/deflationary-model.mjs";

const root = new URL("../", import.meta.url);

test("automation panel selects the best fully ready generation and preserves the bounded setup", async () => {
  const [html, browser] = await Promise.all([
    readFile(new URL("site/broker/index.html", root), "utf8"),
    readFile(new URL("site/autonomous-minting.js", root), "utf8"),
  ]);
  assert.match(html, /Continuous free-mint automation/);
  assert.match(html, /<details class="active-agent-console" data-active-agent-console>/);
  assert.match(html, /Your Active Agents/);
  assert.match(html, /Live agent scan terminal/);
  assert.match(html, /data-v3-scan-terminal/);
  assert.match(html, /Activation and limit setup use the single guided wizard above/);
  assert.equal((html.match(/data-wallet-disconnect/g) ?? []).length, 1);
  assert.match(html, /Automatic safe profile/);
  assert.match(html, /exact reviewed OpenSea Studio runtime/i);
  assert.match(html, /data-v3-upgrade/);
  assert.doesNotMatch(html, /Legacy V1|data-owner-policy-controls|data-account-activation/);
  assert.doesNotMatch(html, /account-activation\.js|owner-policy-controls\.js/);
  assert.match(html, /data-v2-setup disabled/);
  assert.match(html, /Set up and start agent/);
  assert.match(html, /data-v2-progress/);
  assert.match(html, /Choose Punk[\s\S]*Set limits[\s\S]*Confirm setup[\s\S]*Agent live/);
  assert.match(html, /Conservative · 1 mint\/day for 7 days/);
  assert.match(html, /Standard · 5 mints\/day for 14 days/);
  assert.match(html, /Active · 10 mints\/day for 30 days/);
  assert.match(html, /data-v2-confirmation-plan/);
  assert.match(html, /data-retirement-confirm/);
  assert.match(html, /How the proposed 1,420-supply retirement model works/);
  assert.match(html, /agent never burns a Punk automatically/i);
  assert.match(browser, /retirementConfirm\.checked !== true/);
  assert.equal(automationSelectionChanged({ tokenId: "93" }, { tokenId: "93", activated: true }), false);
  assert.equal(automationSelectionChanged({ tokenId: "93" }, { tokenId: "94" }), true);
  assert.equal(automationSelectionChanged({ tokenId: "93" }, null), true);
  assert.equal(automationGateNeedsLegacyFallback({
    capability: true, setupTransactionAvailable: true,
  }, "93"), false);
  assert.equal(automationGateNeedsLegacyFallback(null, "93"), true);
  assert.match(html, /data-v2-stop disabled/);
  assert.match(html, /data-v2-cap disabled/);
  assert.match(html, /data-v2-days disabled/);
  assert.match(html, /One ERC-721 per transaction/i);
  assert.match(html, /paid mints/i);
  assert.match(html, /data-v2-worker/);
  assert.match(html, /data-v3-usage-mints/);
  assert.match(html, /data-v3-usage-punks/);
  assert.match(html, /data-v3-usage-wallets/);
  assert.match(html, /Punks are not people/);
  assert.match(html, /data-v2-refresh/);
  assert.match(html, /data-v3-run-now disabled/);
  assert.match(html, /data-v3-run-all disabled/);
  assert.match(html, /Send selected agent now/);
  assert.match(html, /data-v2-refreshed/);
  assert.match(html, /fixed zero-price safety profile|fixed safety profile/i);
  assert.match(html, /Art Mandate preferences are not required/);
  assert.doesNotMatch(html, /data-mandate-form/);
  assert.doesNotMatch(html, /mandate-editor\.js/);
  assert.match(html, /Fund the hosted automation agent/);
  assert.match(html, /does not pay hosted-worker gas/i);
  assert.match(html, /data-v3-account-copy disabled/);
  assert.match(html, /Copy NFT-wallet address/);
  assert.match(html, /data-v3-account-opensea/);
  assert.match(html, /View verified NFT gallery/);
  assert.match(html, /OpenSea \(may update slowly\)/);
  assert.match(html, /data-v2-agent-full/);
  assert.match(html, /data-v2-agent-balance-large/);
  assert.match(html, /data-v2-agent-fund disabled/);
  assert.match(html, /not recoverable through Punk withdrawal controls/i);
  assert.match(html, /verified worker heartbeat/i);
  assert.match(html, /Automation checkpoint:/);
  assert.match(html, /Art-taste settings do not gate mints/i);
  assert.match(browser, /eth_sendTransaction/);
  assert.doesNotMatch(browser, /personal_sign|eth_signTypedData|wallet_addEthereumChain/i);
  assert.match(browser, /autonomy-v\$\{state\.version\}-owner-setup/i);
  assert.match(browser, /autonomy-v\$\{version\}-status/i);
  assert.match(browser, /automationGateNeedsLegacyFallback\(v3Gate, requestedTokenId\)/);
  assert.match(browser, /v3Gate\?\.setupTransactionAvailable === true/);
  assert.match(browser, /v3Gate\?\.setupTransactionAvailable === true/);
  assert.match(browser, /selectAutomationGeneration/);
  assert.match(browser, /disableAutomatedSeaDropPolicy|stopTransactions/i);
  assert.match(browser, /LIVE · CHECKING FOR FREE MINTS/);
  assert.match(browser, /no mint passed all checks/);
  assert.match(browser, /state\.setupSubmission/);
  assert.match(browser, /requires \$\{setupCount\} sequential MetaMask confirmations/);
  assert.match(browser, /heartbeatLabel/);
  assert.match(browser, /publicUsage\?\.confirmedMints/);
  assert.match(browser, /publicUsage\?\.mintingPunks/);
  assert.match(browser, /publicUsage\?\.autonomousPreferenceWallets/);
  assert.match(browser, /publicUsage\?\.latestConfirmedAt/);
  assert.match(browser, /durable history is not erased by a later failed scan/);
  assert.match(browser, /lightweight activity check every 15 seconds/);
  assert.match(browser, /\/api\/broker\/autonomy-v3-activity/);
  assert.match(html, /data-v3-latest-mint/);
  assert.match(browser, /Latest autonomous mint/);
  assert.match(browser, /robinhoodchain\.blockscout\.com\/tx/);
  assert.match(browser, /createCoalescedRefresh\(loadOnce\)/);
  assert.match(browser, /\/api\/broker\/autonomy-v3-run/);
  assert.match(browser, /Its first bounded scan is starting automatically/);
  assert.match(browser, /if \(startFirstScan\)[\s\S]*await runAgentNow\(\)/);
  assert.match(browser, /JSON\.stringify\(\{ all: true \}\)/);
  assert.match(browser, /NO_ANALYZED_ACTIVE_TARGETS/);
  assert.match(browser, /visibilitychange/);
  assert.match(browser, /addEventListener\?\.\("focus"/);
  assert.doesNotMatch(browser, /refresh: String\(Date\.now\(\)\)/);
  assert.match(browser, /status route carries a short CDN cache/);
  assert.match(browser, /acquisitionsToday/);
  assert.match(browser, /maxAcquisitionsPerDay/);
  assert.match(browser, /dataset\.userEdited/);
  assert.match(browser, /DEPLOYED_AWAITING_LIVE_GATE|DEPLOYED_CONFIGURATION_PENDING/);
  assert.match(browser, /eth_getCode/);
  assert.match(browser, /eth_estimateGas/);
  assert.match(browser, /eth_sendTransaction/);
  assert.match(browser, /automationPunkWalletOpenSeaUrl/);
  assert.match(browser, /Copied the selected Punk’s V\$\{state\.version\} NFT wallet—not the hosted gas payer/);
});

test("agent terminal separates enrollment from real scanning and minting without live fan-out", () => {
  const snapshot = automationTerminalSnapshot([
    { tokenId: "93", agentSummary: { configured: true, enrolled: true,
      status: "AWAITING_WORKER_EVIDENCE" } },
    { tokenId: "94", agentSummary: { configured: true, enrolled: true,
      status: "SCANNING", reason: "NO_ACTIVE_CANDIDATES" } },
    { tokenId: "96", agentSummary: { configured: true, enrolled: false,
      status: "NEEDS_ENROLLMENT" } },
  ], "94", true);
  assert.deepEqual(snapshot.counts, {
    agents: 3, enrolled: 2, scanning: 1, minting: 0, attention: 1,
  });
  assert.equal(snapshot.running, true);
  assert.match(snapshot.lines[0], /worker ONLINE · 2\/3 locally indexed as enrolled/);
  assert.match(snapshot.lines[1], /WORKER\s+waiting for the first production heartbeat/);
  assert.match(snapshot.lines[3], /#93\s+enrolled · awaiting fresh worker evidence/);
  assert.match(snapshot.lines[4], /#94\s+scanning candidates now.*< selected/);
  assert.match(snapshot.lines[5], /#96\s+needs enrollment repair/);
});

test("agent terminal shows real production heartbeat and mint evidence separately from preview enrollment", () => {
  const snapshot = automationTerminalSnapshot([
    { tokenId: "93", agentSummary: { configured: true, enrolled: true,
      status: "AWAITING_WORKER_EVIDENCE" } },
  ], "93", true, {
    heartbeat: { online: true, status: "MINT_CONFIRMED", tokenId: "1132",
      completedAt: "2026-08-30T11:47:09.205Z",
      transactionHash: `0x${"ab".repeat(32)}` },
    usage: { confirmedMints: 1231, mintingPunks: 145,
      latestConfirmedAt: "2026-08-30T11:47:09.205Z" },
  });
  assert.match(snapshot.lines.join("\n"), /WORKER\s+MINT_CONFIRMED · Punk #1132/);
  assert.match(snapshot.lines.join("\n"), /MINT\s+Punk #1132 confirmed/);
  assert.match(snapshot.lines.join("\n"), /1,231 confirmed mints · 145 Punk agents/);
  assert.match(snapshot.lines.join("\n"), /preview enrollment index; per-Punk heartbeat/);
});

test("wizard exposes a bounded searchable Punk picker instead of a large native menu", async () => {
  const brokerHtml = await readFile(new URL("site/broker/index.html", root), "utf8");
  assert.match(brokerHtml, /data-wizard-punk-search/);
  assert.match(brokerHtml, /data-wizard-punk-results/);
  assert.match(brokerHtml, /GOGH \/ LIVE WORKER/);
});

test("activation disclosure binds the exact draft lifetimes and fails closed without rarity evidence", () => {
  assert.deepEqual(RETIREMENT_MINT_LIFETIMES, DRAFT_RARITY_MINT_LIMITS);
  const pending = retirementActivationDisclosure("93", null);
  assert.equal(pending.assigned, false);
  assert.match(pending.summary, /countdown is not active/i);
  const preview = retirementActivationDisclosure("93", {
    rarityTier: "RARE",
    rarityEvidence: "OPENSEA_OPENRARITY_CURRENT",
    rarityRank: 900,
  });
  assert.equal(preview.assigned, false);
  assert.equal(preview.preview, true);
  assert.equal(preview.limit, 400);
  assert.match(preview.title, /OpenRarity #900/);
  assert.match(preview.summary, /preview only/i);
  const metadataPreview = retirementActivationDisclosure("94", {
    rarityTier: "EPIC",
    rarityEvidence: "ONCHAIN_METADATA_TRAIT_CURRENT",
  });
  assert.equal(metadataPreview.assigned, false);
  assert.equal(metadataPreview.preview, true);
  assert.equal(metadataPreview.limit, 800);
  assert.match(metadataPreview.title, /on-chain epic trait/i);
  const assigned = retirementActivationDisclosure("93", {
    rarityTier: "COMMON",
    rarityEvidence: "VERIFIED_SNAPSHOT",
    confirmedAutonomousMints: 17,
  });
  assert.equal(assigned.limit, 100);
  assert.equal(assigned.remaining, 83);
  assert.match(assigned.summary, /83 remaining/);
});

test("zero-Punk wallets never select an absent automation Punk", () => {
  assert.equal(ownerRosterHasNoPunks({ tokenIds: [] }), true);
  assert.equal(ownerRosterHasNoPunks({ tokenIds: ["93"] }), false);
  assert.equal(ownerRosterHasNoPunks(null), false);
  assert.equal(selectedAutomationPunk(null, null), null);
  assert.equal(selectedAutomationPunk({}, null), null);
  assert.equal(selectedAutomationPunk({ punk: null }, { tokenId: "93" }), null);
  assert.equal(selectedAutomationPunk({ punk: { tokenId: "93" } }, null), null);
  const punk = { tokenId: "93", active: true };
  assert.equal(selectedAutomationPunk({ punk }, { tokenId: "93" }), punk);
  assert.equal(selectedAutomationPunk({ punk }, { tokenId: "94" }), null);
});

test("live refreshes coalesce instead of invalidating a slower status response", async () => {
  const resolvers = [];
  let calls = 0;
  const refresh = createCoalescedRefresh(() => {
    calls += 1;
    return new Promise((resolve) => resolvers.push(resolve));
  });
  const first = refresh();
  const second = refresh();
  const third = refresh();
  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(calls, 0);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolvers.shift()();
  await first;
  await Promise.resolve();
  assert.equal(calls, 2);
  resolvers.shift()();
  await Promise.resolve();
});

test("a deployed selected V3 Punk never falls back to its legacy V2 wallet during a worker restart", () => {
  const tokenId = "94";
  const v3Gate = {
    capability: false,
    setupTransactionAvailable: false,
    status: "WORKER_STARTING",
    punk: { tokenId, created: true, active: true, account: `0x${"3".repeat(40)}` },
  };
  const v2Gate = {
    capability: true,
    setupTransactionAvailable: true,
    punk: { tokenId, created: false, active: false, account: `0x${"2".repeat(40)}` },
  };
  assert.deepEqual(selectAutomationGeneration(v3Gate, v2Gate, tokenId), {
    version: 3, gate: v3Gate,
  });
});

test("an uncreated V3 Punk continues to use the live V2 generation", () => {
  const tokenId = "95";
  const v3Gate = {
    capability: false,
    setupTransactionAvailable: false,
    punk: { tokenId, created: false, active: false, account: `0x${"3".repeat(40)}` },
  };
  const v2Gate = { capability: true, setupTransactionAvailable: true };
  assert.deepEqual(selectAutomationGeneration(v3Gate, v2Gate, tokenId), {
    version: 2, gate: v2Gate,
  });
});

test("the V3 Punk NFT wallet link is exact and rejects malformed addresses", () => {
  const wallet = `0x${"aB".repeat(20)}`;
  assert.equal(automationPunkWalletOpenSeaUrl(wallet),
    `https://opensea.io/0x${"ab".repeat(20)}`);
  assert.throws(() => automationPunkWalletOpenSeaUrl("0x1234"), /invalid/);
});

test("hosted gas funding has a fixed recipient, fixed amounts, and empty calldata", () => {
  const from = `0x${"1".repeat(40)}`;
  const agent = `0x${"2".repeat(40)}`;
  assert.deepEqual(buildAutomationGasFundingTransaction(from, agent, "500000000000000"), {
    from, to: agent, value: "0x1c6bf52634000", data: "0x",
  });
  assert.equal(formatAutomationGasBalance("78238454698000"), "0.000078238 ETH");
  assert.throws(() => buildAutomationGasFundingTransaction(from, agent, "500000000000001"));
  assert.throws(() => buildAutomationGasFundingTransaction(from, `${agent}00`, "500000000000000"));
});
