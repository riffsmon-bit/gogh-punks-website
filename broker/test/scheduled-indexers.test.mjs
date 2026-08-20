import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("core and market-wide mint indexers alternate the shared chain lock", async () => {
  const [core, mint] = await Promise.all([
    readFile(new URL("../../netlify/functions/broker-indexer.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../netlify/functions/broker-mint-indexer.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(core, /stream !== "nft_transfers"/);
  assert.match(core, /schedule: "\*\/2 \* \* \* \*"/);
  assert.match(mint, /BROKER_INDEX_STREAMS: "nft_transfers"/);
  assert.match(mint, /schedule: "1-59\/2 \* \* \* \*"/);
  assert.match(mint, /BROKER_INDEXER_ENABLED !== "true"/);
});
