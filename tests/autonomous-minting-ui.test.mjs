import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  automationPunkWalletOpenSeaUrl, buildAutomationGasFundingTransaction,
  formatAutomationGasBalance, selectAutomationGeneration,
} from "../site/autonomous-minting.js";

const root = new URL("../", import.meta.url);

test("automation panel selects the best fully ready generation and preserves the bounded setup", async () => {
  const [html, browser] = await Promise.all([
    readFile(new URL("site/broker/index.html", root), "utf8"),
    readFile(new URL("site/autonomous-minting.js", root), "utf8"),
  ]);
  assert.match(html, /Continuous free-mint automation/);
  assert.match(html, /Automatic safe profile/);
  assert.match(html, /exact reviewed OpenSea Studio runtime/i);
  assert.match(html, /data-v3-upgrade/);
  assert.doesNotMatch(html, /Legacy V1|data-owner-policy-controls|data-account-activation/);
  assert.doesNotMatch(html, /account-activation\.js|owner-policy-controls\.js/);
  assert.match(html, /data-v2-setup disabled/);
  assert.match(html, /Set up and start agent/);
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
  assert.match(html, /View this Punk’s NFTs on OpenSea/);
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
  assert.match(browser, /Promise\.allSettled\(\[fetchGate\(3\), fetchGate\(2\)\]\)/);
  assert.match(browser, /v3Gate\?\.capability === true/);
  assert.match(browser, /v3Gate\?\.setupTransactionAvailable === true/);
  assert.match(browser, /selectAutomationGeneration/);
  assert.match(browser, /disableAutomatedSeaDropPolicy|stopTransactions/i);
  assert.match(browser, /ACTIVE · SCANNING/);
  assert.match(browser, /heartbeatLabel/);
  assert.match(browser, /publicUsage\?\.confirmedMints/);
  assert.match(browser, /publicUsage\?\.mintingPunks/);
  assert.match(browser, /publicUsage\?\.autonomousPreferenceWallets/);
  assert.match(browser, /automatic check every 30 seconds/);
  assert.match(browser, /\/api\/broker\/autonomy-v3-run/);
  assert.match(browser, /NO_ANALYZED_ACTIVE_TARGETS/);
  assert.match(browser, /visibilitychange/);
  assert.match(browser, /addEventListener\?\.\("focus"/);
  assert.match(browser, /refresh: String\(Date\.now\(\)\)/);
  assert.match(browser, /acquisitionsToday/);
  assert.match(browser, /maxAcquisitionsPerDay/);
  assert.match(browser, /dataset\.userEdited/);
  assert.match(browser, /AUTOMATION_V2_NOT_DEPLOYED|PREPARATION|LIVE GATE PENDING/i);
  assert.match(browser, /eth_getCode/);
  assert.match(browser, /eth_estimateGas/);
  assert.match(browser, /eth_sendTransaction/);
  assert.match(browser, /automationPunkWalletOpenSeaUrl/);
  assert.match(browser, /Copied the selected Punk’s V\$\{state\.version\} NFT wallet—not the hosted gas payer/);
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
