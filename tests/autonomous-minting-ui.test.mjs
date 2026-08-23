import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("automation panel exposes only the reviewed V2 setup and stop sequence", async () => {
  const [html, browser] = await Promise.all([
    readFile(new URL("site/broker/index.html", root), "utf8"),
    readFile(new URL("site/autonomous-minting.js", root), "utf8"),
  ]);
  assert.match(html, /Continuous free-mint automation/);
  assert.match(html, /data-v2-setup disabled/);
  assert.match(html, /data-v2-stop disabled/);
  assert.match(html, /data-v2-cap disabled/);
  assert.match(html, /data-v2-days disabled/);
  assert.match(html, /One ERC-721 per transaction/i);
  assert.match(html, /paid mints/i);
  assert.match(html, /data-v2-worker/);
  assert.match(html, /verified worker heartbeat/i);
  assert.match(html, /Tester checkpoint:/);
  assert.match(html, /no saved preference can silently start it/i);
  assert.match(browser, /eth_sendTransaction/);
  assert.doesNotMatch(browser, /personal_sign|eth_signTypedData|wallet_addEthereumChain/i);
  assert.match(browser, /AUTOMATION_V2_OWNER_SETUP|autonomy-v2-owner-setup/i);
  assert.match(browser, /disableAutomatedSeaDropPolicy|stopTransactions/i);
  assert.match(browser, /ACTIVE · SCANNING/);
  assert.match(browser, /heartbeatLabel/);
  assert.match(browser, /acquisitionsToday/);
  assert.match(browser, /AUTOMATION_V2_NOT_DEPLOYED|PREPARATION|LIVE GATE PENDING/i);
});
