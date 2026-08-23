import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildAutomationGasFundingTransaction, formatAutomationGasBalance,
} from "../site/autonomous-minting.js";

const root = new URL("../", import.meta.url);

test("automation panel exposes only the reviewed V2 setup and stop sequence", async () => {
  const [html, browser] = await Promise.all([
    readFile(new URL("site/broker/index.html", root), "utf8"),
    readFile(new URL("site/autonomous-minting.js", root), "utf8"),
  ]);
  assert.match(html, /Continuous free-mint automation/);
  assert.match(html, /Legacy V1 Punk wallet controls/);
  assert.match(html, /This is not the autonomous V2 worker/);
  assert.doesNotMatch(html, /data-owner-policy-controls open/);
  assert.match(html, /data-v2-setup disabled/);
  assert.match(html, /data-v2-stop disabled/);
  assert.match(html, /data-v2-cap disabled/);
  assert.match(html, /data-v2-days disabled/);
  assert.match(html, /One ERC-721 per transaction/i);
  assert.match(html, /paid mints/i);
  assert.match(html, /data-v2-worker/);
  assert.match(html, /Fund the hosted automation agent/);
  assert.match(html, /does not pay hosted-worker gas/i);
  assert.match(html, /data-v2-agent-full/);
  assert.match(html, /data-v2-agent-balance-large/);
  assert.match(html, /data-v2-agent-fund disabled/);
  assert.match(html, /not recoverable through Punk withdrawal controls/i);
  assert.match(html, /verified worker heartbeat/i);
  assert.match(html, /Automation checkpoint:/);
  assert.match(html, /saved preference cannot silently/i);
  assert.match(browser, /eth_sendTransaction/);
  assert.doesNotMatch(browser, /personal_sign|eth_signTypedData|wallet_addEthereumChain/i);
  assert.match(browser, /AUTOMATION_V2_OWNER_SETUP|autonomy-v2-owner-setup/i);
  assert.match(browser, /disableAutomatedSeaDropPolicy|stopTransactions/i);
  assert.match(browser, /ACTIVE · SCANNING/);
  assert.match(browser, /heartbeatLabel/);
  assert.match(browser, /acquisitionsToday/);
  assert.match(browser, /maxAcquisitionsPerDay/);
  assert.match(browser, /dataset\.userEdited/);
  assert.match(browser, /AUTOMATION_V2_NOT_DEPLOYED|PREPARATION|LIVE GATE PENDING/i);
  assert.match(browser, /eth_getCode/);
  assert.match(browser, /eth_estimateGas/);
  assert.match(browser, /eth_sendTransaction/);
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
