import assert from "node:assert/strict";
import test from "node:test";

import {
  fixedIpfsGatewayUrl, readOnchainNftDisplay, sanitizeOnchainNftDisplay,
} from "../src/metadata/onchain-nft-display.mjs";

const METADATA_CID = "bafkreihytc54zdfjl74gk4lqhclbehejfjvw2exj6yz7qg75s2zki5ak5i";
const IMAGE_CID = "bafybeifxubfqw4ijecm3adlgczd37x2kk3xu4mpsgelh7n4nxxq5ufmrsy";

test("IPFS display URLs are pinned to one fixed HTTPS gateway", () => {
  assert.equal(fixedIpfsGatewayUrl(`ipfs://${METADATA_CID}`),
    `https://ipfs.io/ipfs/${METADATA_CID}`);
  assert.equal(fixedIpfsGatewayUrl(`ipfs://ipfs/${METADATA_CID}/metadata.json`),
    `https://ipfs.io/ipfs/${METADATA_CID}/metadata.json`);
  for (const value of ["https://evil.test/meta", "ipfs://../secret", `ipfs://${METADATA_CID}?x=1`,
    "ipfs://bafy", `ipfs://${METADATA_CID}/../../secret`]) {
    assert.equal(fixedIpfsGatewayUrl(value), null);
  }
});

test("on-chain metadata keeps only bounded name and an IPFS image", () => {
  assert.deepEqual(sanitizeOnchainNftDisplay({
    name: "Pepe\u0000 Brokers", image: `ipfs://${IMAGE_CID}`,
  }), {
    name: "Pepe Brokers", imageUrl: `https://ipfs.io/ipfs/${IMAGE_CID}`,
    source: "ONCHAIN_TOKEN_URI_IPFS",
  });
  assert.equal(sanitizeOnchainNftDisplay({ name: "No remote image", image: "https://evil.test/a" })
    .imageUrl, null);
  assert.throws(() => sanitizeOnchainNftDisplay({ name: 7 }), /name/);
});

test("metadata fetch is bounded, no-redirect, cached, and reads one fixed IPFS URL", async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({
      name: "Pepe Brokers", image: `ipfs://${IMAGE_CID}`,
    }) };
  };
  const first = await readOnchainNftDisplay(`ipfs://${METADATA_CID}`, { fetchFn, now: 10 });
  const second = await readOnchainNftDisplay(`ipfs://${METADATA_CID}`, { fetchFn, now: 11 });
  assert.deepEqual(first, second);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://ipfs.io/ipfs/${METADATA_CID}`);
  assert.equal(calls[0].options.redirect, "error");
});
