import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("../site/broker/v2/index.html", import.meta.url);
const cssUrl = new URL("../site/broker-v2.css", import.meta.url);

test("V2 Control Center exposes the complete selected-Punk action architecture", async () => {
  const html = await readFile(htmlUrl, "utf8");
  for (const action of ["talk", "strategy", "fund", "collection", "activity", "settings"]) {
    assert.match(html, new RegExp(`data-v2-tab="${action}"`));
    assert.match(html, new RegExp(`data-v2-panel="${action}"`));
  }
  assert.doesNotMatch(html, /data-v2-(?:tab|panel)="withdraw"/);
  assert.match(html, /SELECT YOUR ART BROKER/);
  assert.match(html, /WHAT ARE WE HUNTING/);
  assert.match(html, /Funds go directly into this Punk Wallet/);
  assert.match(html, /ALL HISTORY/);
  assert.match(html, /GOGH INTELLIGENCE · AUTO/);
  assert.match(html, /data-welcome-message/);
  assert.match(html, /AUTONOMOUS · LOCKED/);
  assert.match(html, /PUNK AGENT ACCOUNT/);
  assert.match(html, /data-fund-agent-account/);
  assert.match(html, /WITHDRAW FROM THE PIECE/);
  assert.match(html, /ETH ↔ WETH/);
  assert.match(html, /MISSING AN NFT\? PASTE ITS EXACT OPENSEA ITEM LINK/);
  assert.match(html, /data-exact-nft-form/);
  assert.match(html, /data-v2-withdrawal/);
  assert.match(html, /FIXED DESTINATION/);
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
  const [html, script] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(new URL("../site/broker-v2.js", import.meta.url), "utf8"),
  ]);
  assert.match(script, /view=indexed/);
  assert.match(script, /verifyOwnedPunkIds/);
  assert.doesNotMatch(script, /owner-punks\?owner=.*view=reconcile/);
  assert.match(script, /api\/v2\/punks\/\$\{tokenId\}\/collection/);
  assert.match(script, /api\/v2\/punks\/\$\{tokenId\}\/activity/);
  assert.match(html, /data-mission-monitor/);
  assert.match(html, /data-mission-next-check/);
  assert.match(html, /data-mission-queue/);
  assert.match(script, /REFRESHING THE LIVE ROBINHOOD NFT OPPORTUNITY QUEUE/);
  assert.match(script, /SCREENING AND SIMULATING CURRENT CANDIDATES/);
  assert.match(script, /SCOUT CHECK FAILED · RETRY SCHEDULED/);
  assert.match(script, /LIVE QUEUE REFRESH RATE-LIMITED/);
  assert.match(script, /REVIEW_DISCOVERY_BACKOFF_MS = 5 \* 60_000/);
  assert.match(script, /last confirmed queue/);
  assert.match(script, /ensureV2Session/);
  assert.match(script, /GALLERY UNAVAILABLE/);
  assert.doesNotMatch(script, /dangerouslySetInnerHTML|innerHTML\s*=/);
  assert.match(script, /api\/broker\/nft-withdrawal-assets\?\$\{params\}/);
  assert.match(script, /assets\.owner !== state\.wallet\?\.account/);
  assert.match(script, /asset\.ownershipStatus|LIVE OWNERSHIP CHECK/);
  assert.match(script, /WITHDRAW/);
  assert.match(script, /gateway\.pinata\.cloud/);
  assert.match(script, /fixedIpfs/);
  assert.match(script, /exactOpenSeaAsset/);
  assert.match(script, /preflightNftWithdrawal/);
  assert.match(script, /submitNftWithdrawal/);
  assert.match(script, /waitForNftWithdrawalReceipt/);
  assert.match(script, /state\.withdrawalPlan \? "SUBMIT IN METAMASK" : "REVIEW & SIMULATE"/);
  assert.match(script, /validateWithdrawableNftAssets/);
  assert.doesNotMatch(script, /withdraw\.href = `\/broker\/punk\//);
});

test("funding exposes hardened ETH funding and canonical WETH wrap submission", async () => {
  const [html, script] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(new URL("../site/broker-v2.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73/);
  assert.match(html, /data-weth-form/);
  assert.match(html, /WRAP ETH INTO WETH/);
  assert.match(html, /UNWRAP WETH INTO ETH/);
  assert.match(script, /wrappedBalanceOfData/);
  assert.match(script, /buildWrappedNativeTransaction/);
  assert.match(script, /simulateWrappedNativeTransaction/);
  assert.match(script, /readPunkWalletFundsState/);
  assert.match(script, /waitForPunkWalletTransactionReceipt/);
  assert.match(script, /api\/v2\/agent-account\/setup/);
  assert.match(script, /api\/v2\/agent-account\/receipt/);
  assert.match(script, /api\/v2\/agent-account\/recall/);
  assert.match(script, /Punk Agent Account gas/);
  assert.doesNotMatch(script, /readOwnerPolicyState|fetchOwnerPolicyGate/);
  assert.match(script, /if \(state\.selected && activeTab\) void hydrateSelected\(activeTab\)/);
  assert.match(script, /FUNDING CONFIRMED/);
  assert.match(script, /ETH and WETH balances refreshed/);
  assert.match(script, /preflightPunkWalletFunds/);
  assert.match(script, /submitPunkWalletFunds/);
  assert.match(script, /submitWrappedNativeTransaction/);
  assert.match(html, /data-fund-confirm/);
  assert.match(html, /data-weth-confirm/);
  assert.match(script, /LOCAL PREVIEW.*No wallet transaction can be requested/);
});

test("transient wallet frames do not erase or repeatedly reload a verified Punk roster", async () => {
  const script = await readFile(new URL("../site/broker-v2.js", import.meta.url), "utf8");
  assert.match(script, /verifiedSameAccount && \(wallet\.chainId == null \|\| wallet\.status === "pending"\)/);
  assert.match(script, /verifiedSameAccount \|\| state\.ownershipLoadingAccount === account/);
  assert.match(script, /requestId !== state\.ownershipRequestId/);
  assert.match(script, /punks\.find\(\(punk\) => punk\.tokenId === selectedTokenId\)/);
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

test("the hosted PR review runs bounded tab agents while owner transactions stay explicit", async () => {
  const [html, script] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(new URL("../site/broker-v2.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /data-review-title/);
  assert.match(script, /api\/v2\/review\/chat/);
  assert.match(script, /api\/v2\/review\/inspect-url/);
  assert.match(html, /data-review-agent-console/);
  assert.match(html, /SEND PUNK OUT/);
  assert.match(html, /ACTIVATE &amp; SEND PUNK OUT/);
  assert.match(html, /data-strategy-activation-status/);
  assert.match(html, /data-review-agent-recall hidden>CALL PUNK BACK/);
  assert.match(html, /RUN SAFE TEST/);
  assert.match(html, /data-review-agent-rules/);
  assert.match(html, /CONFIRMED DAILY LIMIT/);
  assert.match(html, /CONFIRMED MAX MINTS \/ MISSION/);
  assert.match(html, /data-review-daily-limit>NOT SET/);
  assert.match(html, /data-review-total-limit>NOT SET/);
  assert.match(html, /Set every mission parameter in chat/);
  assert.doesNotMatch(html, /UPDATE VIA CHAT|data-review-agent-limit-form/);
  assert.match(script, /chatForm\.requestSubmit\(\)/);
  assert.match(script, /api\/v2\/review\/run/);
  assert.match(script, /api\/v2\/admin\/discovery\/ingest/);
  assert.match(script, /timeoutMs: 45_000/);
  assert.match(script, /testMode: "SAFE_FIXTURE"/);
  assert.match(script, /No live mint or transaction exists/);
  assert.match(script, /ROBINHOOD NFT QUEUE/);
  assert.doesNotMatch(script, /SHARED V2 OPPORTUNITIES/);
  assert.match(html, /ALL HISTORY/);
  assert.match(script, /EARLIER ART BROKER/);
  assert.match(html, /Browser-persistent review intelligence only/);
  assert.match(script, /startReviewAgent/);
  assert.match(script, /dispatchAfterActivation/);
  assert.match(script, /recordReviewMissionRun/);
  assert.match(script, /function recallSelectedReviewAgent\(\)/);
  assert.match(script, /PUNK CALLED BACK BY OWNER/);
  assert.match(script, /selectedReviewAgent\(\)\?\.status !== "SCOUTING"/);
  assert.match(script, /reviewMissionTimer = null/);
  assert.match(script, /releaseReviewMissionLease\(key\)/);
  assert.match(script, /REVIEW_MISSION_POLL_MS = 60_000/);
  assert.match(script, /if \(dispatchAfterActivation\) await sendReviewAgentOut\(\)/);
  assert.match(script, /selectedReviewAgent\(\)\?\.intent/);
  assert.match(script, /Your signed strategy is active, but only MetaMask can approve a mint/);
  assert.match(script, /MetaMask should be open now\. Sign the free strategy-activation message/);
  assert.match(script, /ACTIVATION STOPPED/);
  assert.match(script, /api\/v2\/review\/strategy-draft/);
  assert.match(script, /api\/v2\/review\/mint-receipt/);
  assert.match(script, /reviewAgents: new Map\(\)/);
  assert.match(script, /localStorage\.setItem\(REVIEW_BROWSER_STORAGE_KEY/);
  assert.match(script, /sessionStorage\.getItem\(REVIEW_SESSION_STORAGE_KEY/);
  assert.match(script, /REVIEW_MISSION_LEASE_MS = 15_000/);
  assert.match(script, /acquireReviewMissionLease/);
  assert.match(script, /reviewMissionInFlight: new Set\(\)/);
  assert.match(script, /state\.reviewMissionInFlight\.has\(key\)/);
  assert.match(script, /state\.reviewMissionInFlight\.delete\(key\)/);
  assert.match(script, /const seen = new Set\(\)/);
  assert.match(script, /window\.addEventListener\("storage"/);
  assert.match(script, /HOOD MORNING/);
  assert.match(script, /HOOD AFTERNOON/);
  assert.match(script, /HOOD EVENING/);
  assert.match(script, /Open Activity for my live status/);
  assert.match(script, /normalizeReviewAgentSnapshot/);
  assert.match(script, /restoreReviewSessionState\(\)/);
  assert.match(script, /persistReviewSessionState\(\)/);
  assert.match(script, /STRATEGY DRAFT CREATED/);
  assert.match(script, /SIMULATION PASSED/);
  assert.match(script, /SUBMIT IN METAMASK/);
  assert.match(script, /GOGH INTELLIGENCE · REVIEW PARSER/);
  assert.match(html, /TAUGHT SKILLS/);
  assert.match(html, /TEACH THIS PUNK/);
  assert.match(script, /responseKind === "SKILL_DRAFT"/);
  assert.match(script, /activateReviewSkill/);
  assert.match(script, /reviewSkills: new Map\(\)/);
  assert.match(script, /policy and all safety gates still win/i);
});

test("link checks show progress and ground conversational follow-up questions", async () => {
  const script = await readFile(new URL("../site/broker-v2.js", import.meta.url), "utf8");
  assert.match(script, /CHECKING… No wallet request will be accepted/);
  assert.match(script, /form\.setAttribute\("aria-busy", "true"\)/);
  assert.match(script, /button\.disabled = true/);
  assert.match(script, /state\.lastInspection = inspection/);
  assert.match(script, /state\.localStrategy = null; state\.localSkill = null; state\.lastInspection = null/);
  assert.match(script, /const inspection = state\.lastInspection/);
  assert.match(script, /GOGH INTELLIGENCE · SAFE FALLBACK/);
  assert.match(script, /The review service timed out\. Try again/);
  assert.match(script, /No transaction was prepared/);
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
