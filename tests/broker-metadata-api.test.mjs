import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  attachNftDisplayMetadata,
  nftDisplayMetadata,
} from "../netlify/functions/_shared/broker-display-metadata.mjs";

test("display metadata exposes only allowlisted provider URLs", () => {
  const metadata = nftDisplayMetadata({
    nft_metadata_status: "AVAILABLE",
    nft_metadata_name: "Gogh Punk #317",
    nft_metadata_description: "Canonical Punk artwork.",
    nft_metadata_image_url: "https://i.seadn.io/s/raw/files/example.png",
    nft_metadata_collection_slug: "gogh-punks",
    nft_metadata_token_standard: "ERC721",
    nft_metadata_traits: [{ trait_type: "Background", value: "Blue" }],
    nft_metadata_opensea_url:
      "https://opensea.io/assets/robinhood/0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6/317",
    nft_metadata_fetched_at: "2026-08-20T12:00:00.000Z",
  });
  assert.equal(metadata.status, "AVAILABLE");
  assert.equal(metadata.imageUrl, "https://i.seadn.io/s/raw/files/example.png");
  assert.match(metadata.openSeaUrl, /^https:\/\/opensea\.io\/assets\/robinhood\//);
  assert.deepEqual(metadata.traits, [{ traitType: "Background", value: "Blue" }]);

  const rejected = nftDisplayMetadata({
    nft_metadata_status: "UNTRUSTED",
    nft_metadata_image_url: "https://i.seadn.io.evil.example/tracker.png",
    nft_metadata_token_standard: "ERC20",
    nft_metadata_traits: {},
    nft_metadata_opensea_url: "https://opensea.io.evil.example/assets/robinhood/fake",
  });
  assert.deepEqual(rejected, {
    status: null,
    name: null,
    description: null,
    imageUrl: null,
    collectionSlug: null,
    tokenStandard: null,
    traits: null,
    openSeaUrl: null,
    fetchedAt: null,
  });
});

test("API records receive nullable display metadata without replacing source fields", () => {
  const record = attachNftDisplayMetadata({
    id: "opportunity-1",
    expected_price: "123",
    metadata: { evidence: "onchain" },
    nft_metadata_status: null,
    nft_metadata_name: null,
  });
  assert.equal(record.expected_price, "123");
  assert.deepEqual(record.metadata, { evidence: "onchain" });
  assert.equal(record.nftMetadata.status, null);
  assert.equal(record.nftMetadata.imageUrl, null);
  assert.equal("nft_metadata_status" in record, false);
});

test("broker APIs join display metadata by the full chain-qualified NFT identity", async () => {
  const opportunities = await readFile(
    new URL("../netlify/functions/broker-opportunities.mjs", import.meta.url),
    "utf8",
  );
  const punk = await readFile(
    new URL("../netlify/functions/broker-punk.mjs", import.meta.url),
    "utf8",
  );

  assert.match(opportunities, /nft_metadata\.chain_id = opportunity\.chain_id/);
  assert.match(
    opportunities,
    /nft_metadata\.collection_address = opportunity\.collection_address/,
  );
  assert.match(opportunities, /nft_metadata\.token_id = opportunity\.token_id/);
  assert.match(opportunities, /LIMIT \$1/);

  assert.match(punk, /nft_metadata\.chain_id = punk\.chain_id/);
  assert.match(punk, /nft_metadata\.collection_address = punk\.collection_address/);
  assert.match(punk, /nft_metadata\.token_id = punk\.token_id/);
  assert.match(punk, /nft_metadata\.chain_id = acquisition\.chain_id/);
  assert.match(
    punk,
    /nft_metadata\.collection_address = acquisition\.nft_collection_address/,
  );
  assert.match(punk, /nft_metadata\.token_id = acquisition\.nft_token_id/);
  assert.match(punk, /nft_metadata\.chain_id = opportunity\.chain_id/);
  assert.doesNotMatch(opportunities, /source_payload_hash/);
  assert.doesNotMatch(punk, /source_payload_hash/);
});
