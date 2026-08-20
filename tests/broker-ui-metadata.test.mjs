import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("broker UI renders only allowlisted OpenSea display metadata", async () => {
  const [client, punkPage, headers] = await Promise.all([
    readFile(new URL("../site/broker.js", import.meta.url), "utf8"),
    readFile(new URL("../site/punk/index.html", import.meta.url), "utf8"),
    readFile(new URL("../netlify.toml", import.meta.url), "utf8"),
  ]);

  assert.match(client, /url\.protocol !== "https:"/);
  assert.match(client, /url\.hostname !== hostname/);
  assert.match(client, /OPENSEA_IMAGE_HOST = "i\.seadn\.io"/);
  assert.match(client, /pathnamePrefix: OPENSEA_ASSET_PREFIX/);
  assert.match(client, /document\.createElement\("img"\)/);
  assert.match(client, /item\.textContent = `\$\{type\}: \$\{value\}`/);
  assert.doesNotMatch(client, /\$\{[^}]*nftMetadata/);
  assert.match(punkPage, /data-punk-portrait/);
  assert.match(punkPage, /data-punk-opensea/);
  assert.match(punkPage, /rel="noopener noreferrer nofollow"/);
  assert.match(headers, /img-src 'self' data: https:\/\/i\.seadn\.io/);
  assert.match(headers, /BROKER_METADATA_ENABLED = "true"/);
  assert.doesNotMatch(headers, /connect-src[^\n]*api\.opensea\.io/);
});
