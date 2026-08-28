import assert from "node:assert/strict";
import test from "node:test";

import { fetchLocalBrokerRead, localBrokerReadUrl } from
  "../scripts/lib/v2-local-read-proxy.mjs";

test("local V2 read bridge permits only exact deferred public Broker reads", async () => {
  assert.equal(localBrokerReadUrl("/api/broker/owner-punks",
    new URLSearchParams({ owner: "0x1111111111111111111111111111111111111111" })).href,
  "https://goghpunks.xyz/api/broker/owner-punks?owner=0x1111111111111111111111111111111111111111");
  assert.equal(localBrokerReadUrl("/api/broker/autonomy-v3-status",
    new URLSearchParams({ tokenId: "93" })).href,
  "https://goghpunks.xyz/api/broker/autonomy-v3-status?tokenId=93");
  for (const [path, query] of [
    ["/api/broker/owner-punks", { owner: "bad" }],
    ["/api/broker/autonomy-v3-worker", { tokenId: "93" }],
    ["/api/broker/autonomy-v3-status", { tokenId: "93", extra: "1" }],
  ]) assert.throws(() => localBrokerReadUrl(path, new URLSearchParams(query)));

  let calls = 0;
  const result = await fetchLocalBrokerRead({
    pathname: "/api/broker/autonomy-v3-activity",
    searchParams: new URLSearchParams({ tokenId: "94" }),
    fetchFunction: async (url, options) => {
      calls += 1;
      assert.equal(url.href,
        "https://goghpunks.xyz/api/broker/autonomy-v3-activity?tokenId=94");
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.accept, "application/json");
      return new Response('{"ok":true,"activity":null}', { status: 200,
        headers: { "content-type": "application/json", "content-length": "27" } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 200);
  assert.equal(result.body, '{"ok":true,"activity":null}');
});

test("local V2 read bridge fails closed on malformed or oversized upstream data", async () => {
  const input = { pathname: "/api/broker/nft-withdrawal-assets",
    searchParams: new URLSearchParams({ tokenId: "93" }) };
  await assert.rejects(fetchLocalBrokerRead({ ...input,
    fetchFunction: async () => new Response("not-json") }), /invalid/);
  await assert.rejects(fetchLocalBrokerRead({ ...input,
    fetchFunction: async () => new Response('{"activity":null}') }), /invalid/);
  await assert.rejects(fetchLocalBrokerRead({ ...input,
    fetchFunction: async () => new Response('{"ok":true}', {
      headers: { "content-length": "2000001" },
    }) }), /too large/);
});
