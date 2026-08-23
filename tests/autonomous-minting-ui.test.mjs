import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("automation panel is present, explanatory, and locked by default", async () => {
  const [html, browser] = await Promise.all([
    readFile(new URL("site/broker/index.html", root), "utf8"),
    readFile(new URL("site/autonomous-minting.js", root), "utf8"),
  ]);
  assert.match(html, /Continuous free-mint automation/);
  assert.match(html, /data-v2-setup disabled/);
  assert.match(html, /data-v2-stop disabled/);
  assert.match(html, /One ERC-721 per transaction/i);
  assert.match(html, /paid mints/i);
  assert.doesNotMatch(browser, /eth_sendTransaction|personal_sign|eth_signTypedData/i);
  assert.match(browser, /AUTOMATION_V2_NOT_DEPLOYED|PREPARATION|LIVE GATE PENDING/i);
});
