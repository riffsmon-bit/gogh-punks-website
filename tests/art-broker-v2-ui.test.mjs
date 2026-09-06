import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("../site/broker/v2/index.html", import.meta.url);
const cssUrl = new URL("../site/broker-v2.css", import.meta.url);

test("V2 Control Center exposes the complete selected-Punk action architecture", async () => {
  const html = await readFile(htmlUrl, "utf8");
  for (const action of ["talk", "strategy", "fund", "collection", "activity", "withdraw", "settings"]) {
    assert.match(html, new RegExp(`data-v2-tab="${action}"`));
    assert.match(html, new RegExp(`data-v2-panel="${action}"`));
  }
  assert.match(html, /SELECT YOUR ART BROKER/);
  assert.match(html, /WHAT ARE WE HUNTING/);
  assert.match(html, /Funds go directly into this Punk Wallet/);
  assert.match(html, /V1 \+ V2/);
  assert.match(html, /GOGH INTELLIGENCE · AUTO/);
  assert.match(html, /AUTONOMOUS · LOCKED/);
});

test("V2 semantics, mobile navigation, focus, and reduced motion are deliberate", async () => {
  const [html, css] = await Promise.all([readFile(htmlUrl, "utf8"), readFile(cssUrl, "utf8")]);
  assert.match(html, /<main id="broker-main"/);
  assert.match(html, /<nav class="broker-tabs" aria-label="Punk actions">/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /class="sr-only"/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /position: fixed; bottom: 0/);
});

test("live collection and activity panels hydrate real authenticated API states", async () => {
  const script = await readFile(new URL("../site/broker-v2.js", import.meta.url), "utf8");
  assert.match(script, /view=indexed/);
  assert.match(script, /verifyOwnedPunkIds/);
  assert.doesNotMatch(script, /owner-punks\?owner=.*view=reconcile/);
  assert.match(script, /api\/v2\/punks\/\$\{tokenId\}\/collection/);
  assert.match(script, /api\/v2\/punks\/\$\{tokenId\}\/activity/);
  assert.match(script, /ensureV2Session/);
  assert.match(script, /GALLERY UNAVAILABLE/);
  assert.doesNotMatch(script, /dangerouslySetInnerHTML|innerHTML\s*=/);
});

test("chat sends on Enter while preserving Shift+Enter and composition", async () => {
  const [html, script] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(new URL("../site/broker-v2.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /Press Enter to send\. Press Shift plus Enter for a new line\./);
  assert.match(html, /aria-keyshortcuts="Enter"/);
  assert.match(script, /event\.key !== "Enter" \|\| event\.shiftKey \|\| event\.isComposing/);
  assert.match(script, /chatForm\.requestSubmit\(\)/);
});

test("the local review route is isolated and explicitly cannot broadcast", async () => {
  const [html, server] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(new URL("../scripts/run-v2-local-demo.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(html, /LOCAL PRODUCT PREVIEW/);
  assert.match(server, /LOCAL SIMULATION ONLY/);
  assert.match(server, /127\.0\.0\.1/);
  assert.doesNotMatch(server, /netlify deploy|git push|eth_sendRawTransaction/);
});

test("private operations view exposes aggregated V2 health without user data", async () => {
  const [html, script, endpoint] = await Promise.all([
    readFile(new URL("../site/broker/v2/admin/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/broker-v2-admin.js", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/broker-v2-admin.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(html, /OPERATIONAL READOUT/);
  assert.match(html, /DISCOVERED/); assert.match(html, /PROVIDERS/);
  assert.match(script, /Kept in memory|kept in memory/i);
  assert.doesNotMatch(script, /localStorage|sessionStorage/);
  assert.match(endpoint, /verifyAdminBearer/); assert.match(endpoint, /AGGREGATED_ONLY/);
  assert.doesNotMatch(endpoint, /wallet_address|conversation|message/);
});
