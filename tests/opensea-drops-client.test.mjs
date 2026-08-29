import assert from "node:assert/strict";
import test from "node:test";

import { createOpenSeaDropsClient } from "../broker/src/connector/opensea-drops-client.mjs";

const MINTER = "0x1111111111111111111111111111111111111111";
const TARGET = "0x2222222222222222222222222222222222222222";

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("OpenSea client sends server key only to fixed official origin", async () => {
  const calls = [];
  const client = createOpenSeaDropsClient({ apiKey: "server-key-123",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ target: TARGET, calldata: "0x12345678", value: "4" });
    } });
  const proposal = await client.buildMintTransaction("example-drop", { minter: MINTER, quantity: 1 });
  assert.equal(proposal.target, TARGET);
  assert.equal(proposal.source, "OPENSEA_DROPS_API_UNTRUSTED_PROPOSAL");
  assert.equal(calls[0].url, "https://api.opensea.io/api/v2/drops/example-drop/mint");
  assert.equal(calls[0].options.headers["x-api-key"], "server-key-123");
  assert.deepEqual(JSON.parse(calls[0].options.body), { minter: MINTER, quantity: 1 });
});
test("OpenSea client rejects quantity, inactive drops, and malformed proposals", async () => {
  const client = createOpenSeaDropsClient({ apiKey: "server-key-123",
    fetchImpl: async () => response({}, 409) });
  await assert.rejects(client.buildMintTransaction("example-drop", { minter: MINTER, quantity: 2 }),
    /quantity 1/);
  await assert.rejects(client.buildMintTransaction("example-drop", { minter: MINTER, quantity: 1 }),
    /not active/);
  const malformed = createOpenSeaDropsClient({ apiKey: "server-key-123",
    fetchImpl: async () => response({ target: TARGET, calldata: "0x", value: "0" }) });
  await assert.rejects(malformed.buildMintTransaction("example-drop", { minter: MINTER, quantity: 1 }),
    /calldata/);
});
