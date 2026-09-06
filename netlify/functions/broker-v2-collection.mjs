import { getDatabase } from "@netlify/database";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { NFT_DISPLAY_METADATA_SELECT, attachNftDisplayMetadata } from
  "./_shared/broker-display-metadata.mjs";
import { json } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { v2TokenIdFrom } from "./_shared/v2-route.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const pool = getDatabase().pool;
  try {
    const tokenId = v2TokenIdFrom(request, "/collection");
    const session = await requireV2Session(request, pool);
    const authority = await readV2PunkAuthority(tokenId, { expectedOwner: session.walletAddress });
    const result = await pool.query(`SELECT acquisition.*, ${NFT_DISPLAY_METADATA_SELECT}
      FROM broker_acquisitions AS acquisition
      LEFT JOIN broker_nft_metadata AS nft_metadata
        ON nft_metadata.chain_id = acquisition.chain_id
       AND nft_metadata.collection_address = acquisition.nft_collection_address
       AND nft_metadata.token_id = acquisition.nft_token_id
      WHERE acquisition.chain_id = $1 AND acquisition.punk_collection_address = $2
        AND acquisition.punk_token_id = $3::numeric
      ORDER BY acquisition.acquired_at DESC LIMIT 250`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId]);
    return json({ ok: true, tokenId, punkWallet: authority.punkWallet,
      indexedAtAuthorityBlock: authority.blockNumber,
      holdings: result.rows.map((raw) => {
        const row = attachNftDisplayMetadata(raw);
        return { collection: row.nft_collection_address, tokenId: String(row.nft_token_id),
          amount: String(row.asset_amount), acquiredAt: new Date(row.acquired_at).toISOString(),
          provenance: String(row.acquisition_mode).startsWith("V2") ? "V2" : "V1",
          acquisitionType: row.acquisition_mode, mintCostWei: String(row.price),
          transactionHash: row.transaction_hash, artwork: row.nftMetadata ?? null,
          withdrawControlUrl: `/broker/punk/${tokenId}?tab=assets` };
      }), indexerIsCustodyAuthority: false });
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/punks/:tokenId/collection", method: "GET", rateLimit: {
  action: "rate_limit", aggregateBy: ["ip"], windowLimit: 60, windowSize: 60,
} };
