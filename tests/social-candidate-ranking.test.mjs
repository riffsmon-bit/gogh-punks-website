import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenSeaSocialProfileSource, normalizeProjectImage, normalizeProjectWebsite,
  normalizeXProfile, rankFreeMintCandidates, rankSeaDropCollections,
} from "../broker/src/discovery/social-candidate-ranking.mjs";

const A = `0x${"1".repeat(40)}`;
const B = `0x${"2".repeat(40)}`;
const C = `0x${"3".repeat(40)}`;

test("social URL normalization rejects credentials, internal targets, and malformed X profiles", () => {
  assert.equal(normalizeProjectWebsite("https://example.com/project"), "https://example.com/project");
  assert.equal(normalizeProjectWebsite("http://127.0.0.1/admin"), null);
  assert.equal(normalizeProjectWebsite("http://[::1]/admin"), null);
  assert.equal(normalizeProjectWebsite("https://8.8.8.8/project"), null);
  assert.equal(normalizeProjectWebsite("https://169.254.169.254/latest/meta-data"), null);
  assert.equal(normalizeProjectWebsite("https://user:pass@example.com"), null);
  assert.equal(normalizeXProfile("@ExampleNFT"), "https://x.com/ExampleNFT");
  assert.equal(normalizeXProfile("https://twitter.com/ExampleNFT"), "https://x.com/ExampleNFT");
  assert.equal(normalizeXProfile("https://x.com/ExampleNFT/status/1"), null);
  assert.equal(normalizeXProfile("https://evil.example/ExampleNFT"), null);
  assert.equal(normalizeProjectImage("https://i.seadn.io/example.png"), "https://i.seadn.io/example.png");
  assert.equal(normalizeProjectImage("https://evil.example/example.png"), null);
});

test("website and X rank above incomplete metadata without becoming a security approval", () => {
  const result = rankFreeMintCandidates([
    { collection: C, signals: { supportedRuntime: true, freeMint: true,
      knownSupportedPlatform: true } },
    { collection: B, signals: { supportedRuntime: true, freeMint: true,
      websiteUrl: "https://project.example", knownSupportedPlatform: true } },
    { collection: A, signals: { supportedRuntime: true, freeMint: true,
      websiteUrl: "https://project.example", xUrl: "https://x.com/project",
      websiteCrossReferenced: true, metadataComplete: true, knownSupportedPlatform: true } },
  ], { maximum: 2 });
  assert.deepEqual(result.selected.map(({ collection }) => collection), [A, B]);
  assert.deepEqual(result.selected.map(({ tier }) => tier), ["HIGH", "MEDIUM"]);
  assert.equal(result.diagnostics.sentToOnchainValidation, 2);
  assert.equal(result.diagnostics.discovered, 3);
  assert.equal(result.ranked[0].eligibleForSecurityReview, true);

  const unsafe = rankFreeMintCandidates([{ collection: A, signals: {
    supportedRuntime: false, freeMint: true, websiteUrl: "https://project.example",
    xUrl: "https://x.com/project", websiteCrossReferenced: true,
  } }]);
  assert.equal(unsafe.selected.length, 0);
  assert.equal(unsafe.ranked[0].tier, "REJECTED");
  const paid = rankFreeMintCandidates([{ collection: A, signals: {
    supportedRuntime: true, freeMint: false, websiteUrl: "https://project.example",
    xUrl: "https://x.com/project", websiteCrossReferenced: true,
  } }]);
  assert.equal(paid.selected.length, 0);
  assert.equal(paid.ranked[0].score, 0);
});

test("OpenSea source uses only fixed API origins and normalizes advisory links", async () => {
  const calls = [];
  const source = createOpenSeaSocialProfileSource({ apiKey: "server-key-123", fetchImpl: async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(url.includes("/contract/")
      ? { collection: "example-collection" }
      : { name: "Example", image_url: "https://i.seadn.io/example.png",
        project_url: "https://example.org", twitter_username: "ExampleNFT" }),
    { status: 200, headers: { "content-type": "application/json" } });
  } });
  const result = await rankSeaDropCollections([A], { source, maximum: 1 });
  assert.equal(result.selected[0].tier, "MEDIUM");
  assert.equal(result.selected[0].signals.websiteUrl, "https://example.org/");
  assert.equal(result.selected[0].signals.xUrl, "https://x.com/ExampleNFT");
  assert.equal(result.selected[0].signals.projectName, "Example");
  assert.equal(result.selected[0].signals.imageUrl, "https://i.seadn.io/example.png");
  assert.equal(result.selected[0].signals.websiteCrossReferenced, false);
  assert.equal(result.selected[0].signals.xCrossReferenced, false);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => url.startsWith("https://api.opensea.io/api/v2/")));
});

test("candidate validation fanout is bounded even when discovery returns many projects", async () => {
  let profileReads = 0;
  const collections = Array.from({ length: 12 }, (_, index) => (
    `0x${(index + 1).toString(16).padStart(40, "0")}`
  ));
  const result = await rankSeaDropCollections(collections, { maximum: 3, source: {
    profile: async () => { profileReads += 1; return {}; },
  } });
  assert.equal(profileReads, 12);
  assert.equal(result.selected.length, 3);
  assert.equal(result.diagnostics.maximumOnchainValidations, 3);
});
