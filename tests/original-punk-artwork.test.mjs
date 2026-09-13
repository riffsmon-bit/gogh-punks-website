import assert from "node:assert/strict";
import test from "node:test";
import { createOriginalPunkArtworkEnricher } from "../netlify/functions/_shared/original-punk-artwork.mjs";
import handler from "../netlify/functions/broker-punk-artwork.mjs";

const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const svg = id => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><text>${id}</text></svg>`).toString("base64")}`;
const metadata = id => `data:application/json;base64,${Buffer.from(JSON.stringify({ name: `Gogh Punk #${id}`, image: svg(id) })).toString("base64")}`;
const candidates = ids => ids.map(tokenId => ({ tokenId: String(tokenId), artwork: null }));
function fixture(options = {}) {
  let timestamp = 1_000_000, calls = [], active = 0, peak = 0;
  const client = { getChainId: async () => 4663, readContract: async request => {
    calls.push(request); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    return metadata(request.args[0]);
  } };
  const enrich = createOriginalPunkArtworkEnricher({ client, now: () => timestamp, ...options });
  return { client, enrich, calls, peak: () => peak, advance: ms => { timestamp += ms; } };
}

test("missing original artwork is bound to each canonical token and preserves authority fields", async () => {
  const f = fixture();
  const input = candidates([235, 241, 907]).map(item => ({ ...item, automationCreated: false,
    ownershipVerified: false, rarity: { rank: 12 }, otherField: "preserved" }));
  const result = await f.enrich(input);
  assert.deepEqual(result.map(item => item.tokenId), ["235", "241", "907"]);
  assert.equal(new Set(result.map(item => item.artwork.imageUrl)).size, 3);
  for (let index = 0; index < result.length; index++) {
    const { artwork, ...rest } = result[index];
    const { artwork: _oldArtwork, ...originalFields } = input[index];
    assert.deepEqual(rest, originalFields);
    assert.equal(artwork.name, `Gogh Punk #${result[index].tokenId}`);
    assert.equal(artwork.imageUrl, svg(result[index].tokenId));
    assert.equal(f.calls[index].address, COLLECTION);
    assert.equal(f.calls[index].functionName, "tokenURI");
    assert.equal(f.calls[index].args[0], BigInt(result[index].tokenId));
  }
});

test("existing images and warm cached originals avoid unnecessary RPC reads", async () => {
  const f = fixture();
  const input = [{ tokenId: "93", artwork: { imageUrl: "https://i.seadn.io/93.png" } }, ...candidates([235])];
  const first = await f.enrich(input), second = await f.enrich(input);
  assert.equal(f.calls.length, 1); assert.equal(first[0], input[0]);
  assert.deepEqual(first, second);
  f.advance(3_600_001); await f.enrich(input); assert.equal(f.calls.length, 2);
});

test("concurrency and request caps are bounded while later IDs receive artwork on refresh", async () => {
  const f = fixture({ maximumReads: 4, concurrency: 2 });
  const input = candidates([235, 241, 349, 476, 761, 907]);
  const first = await f.enrich(input);
  assert.equal(f.calls.length, 4); assert.ok(f.peak() <= 2);
  assert.equal(first.filter(item => item.artwork).length, 4);
  const second = await f.enrich(input);
  assert.equal(f.calls.length, 6); assert.ok(second.every(item => item.artwork));
});

test("cache eviction rotates attempts instead of permanently starving later IDs", async () => {
  const f = fixture({ maximumReads: 2, concurrency: 1, cacheEntries: 2 });
  const input = candidates([1, 2, 3, 4, 5]);
  for (let i = 0; i < 4; i++) await f.enrich(input);
  assert.deepEqual([...new Set(f.calls.map(call => String(call.args[0])))].sort(), ["1", "2", "3", "4", "5"]);
});

test("overlapping requests share in-flight artwork reads", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.enrich(candidates([235, 241])), f.enrich(candidates([235, 241]))]);
  assert.equal(f.calls.length, 2); assert.deepEqual(a, b);
});

test("wrong-chain responses and unsupported IDs cannot supply original artwork", async () => {
  const f = fixture(); f.client.getChainId = async () => 1;
  const input = [...candidates([235]), { tokenId: "5017", artwork: null }, { tokenId: "0235", artwork: null }];
  const result = await f.enrich(input);
  assert.equal(f.calls.length, 0); assert.deepEqual(result, input);
});

test("unavailable, external and oversized metadata remain unavailable without changing candidates", async () => {
  for (const value of ["https://internal.invalid/metadata", "ipfs://untrusted", "data:application/json;base64,!",
    "data:application/json," + "x".repeat(512_000),
    `data:application/json;base64,${Buffer.from(JSON.stringify({ image: "https://attacker.invalid/image" })).toString("base64")}`]) {
    const f = fixture(); f.client.readContract = async () => value;
    const input = candidates([235]); assert.deepEqual(await f.enrich(input), input);
  }
  const f = fixture(); let attempts = 0;
  f.client.readContract = async () => { attempts++; throw Error("https://private.invalid/SECRET"); };
  const input = candidates([235]);
  assert.deepEqual(await f.enrich(input), input); await f.enrich(input); assert.equal(attempts, 1);
  f.advance(15_001); await f.enrich(input); assert.equal(attempts, 2);
});

test("a hung artwork read is bounded and leaves ownership candidates intact", async () => {
  const f = fixture({ timeoutMs: 10 }); f.client.readContract = () => new Promise(() => {});
  const input = candidates([235]); assert.deepEqual(await f.enrich(input), input);
});

test("artwork endpoint returns fixed collection identity and explicit partial availability", async () => {
  const f = fixture(); f.client.readContract = async request => request.args[0] === 235n ? metadata(235) : "";
  const response = await handler(new Request("https://goghpunks.xyz/api/broker/punk-artwork?tokenIds=235,241&collection=foreign&chainId=1"), { enrich: f.enrich });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.chainId, 4663); assert.equal(body.collection, COLLECTION); assert.equal(body.complete, false);
  assert.deepEqual(body.artworks.map(item => item.tokenId), ["235", "241"]);
  assert.equal(body.artworks[0].artwork.imageUrl, svg(235)); assert.equal(body.artworks[1].artwork, null);
  assert.equal(response.headers.get("cache-control"), "public, max-age=15");
  assert.equal("owner" in body, false); assert.equal("ownershipVerified" in body, false);
});

test("artwork endpoint rejects duplicate, malformed, excessive and noncanonical token requests before reads", async () => {
  const invalid = ["", "235,235", "0235", "-1", "5017", "235,", "235.0", "235&tokenIds=241",
    Array.from({ length: 33 }, (_, i) => i).join(",")];
  for (const ids of invalid) {
    let called = false;
    const response = await handler(new Request(`https://goghpunks.xyz/api/broker/punk-artwork?tokenIds=${ids}`),
      { enrich: async () => { called = true; throw Error("must not call"); } });
    assert.equal(response.status, 400, ids); assert.equal(called, false);
  }
  assert.equal((await handler(new Request("https://goghpunks.xyz/api/broker/punk-artwork", { method: "POST" }))).status, 405);
});

test("endpoint errors never return provider URLs or turn artwork into ownership evidence", async () => {
  const response = await handler(new Request("https://goghpunks.xyz/api/broker/punk-artwork?tokenIds=235"),
    { enrich: async () => { throw Error("https://provider.invalid/SECRET"); } });
  const text = await response.text(); assert.equal(text.includes("SECRET"), false);
  assert.deepEqual(JSON.parse(text).artworks, [{ tokenId: "235", artwork: null }]);
});

test("large embedded images keep the response bounded without dropping requested IDs", async () => {
  const ids = Array.from({ length: 12 }, (_, i) => String(i));
  const imageUrl = "data:image/png;base64," + "a".repeat(250_000);
  const response = await handler(new Request("https://goghpunks.xyz/api/broker/punk-artwork?tokenIds=" + ids.join(",")),
    { enrich: async items => items.map(item => ({ ...item, artwork: { status: "AVAILABLE", imageUrl } })) });
  const text = await response.text(), body = JSON.parse(text);
  assert.ok(text.length < 2_010_000); assert.equal(body.complete, false);
  assert.deepEqual(body.artworks.map(item => item.tokenId), ids);
  assert.ok(body.artworks.some(item => item.artwork === null));
});
