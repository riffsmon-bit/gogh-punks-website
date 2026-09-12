import { getDatabase } from "@netlify/database";
import { createPublicClient, http, parseAbi } from "viem";
import { getRpcUrl } from "./_shared/config.mjs";
import { buildWithdrawableNftAssets } from "./broker-nft-withdrawal-assets.mjs";
import { readOnchainNftDisplay } from "../../broker/src/metadata/onchain-nft-display.mjs";
import { OpenSeaPortfolioSource } from "../../broker/src/metadata/opensea-portfolio.mjs";
import { verifyCollectionHoldings } from "./_shared/v2-collection-holdings.mjs";
import deployment from "../../deployments/robinhood-punk-agent-account.json" with { type: "json" };
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
    const client = createPublicClient({ transport: http(getRpcUrl(), { timeout: 8000, retryCount: 1 }) });
    const abi = parseAbi(['function ownerOf(uint256) view returns (address)',
      'function balanceOf(address,uint256) view returns (uint256)',
      'function tokenURI(uint256) view returns (string)', 'function uri(uint256) view returns (string)',
      'function account(uint256) view returns (address)']);
    let agentAccount = null;
    try {
      if (deployment.status === 'DEPLOYED') agentAccount = await client.readContract({
        address: deployment.contracts.GoghPunkAgentAccountRegistry.address, abi,
        functionName: 'account', args: [BigInt(tokenId)] });
    } catch { /* Unknown custody is excluded, never guessed from history. */ }
    let walletInventory = null;
    try { walletInventory = await buildWithdrawableNftAssets(tokenId, { database: pool }); }
    catch { /* Return verified acquisition candidates with an explicit partial inventory label. */ }
    const candidates = result.rows.map((raw) => {
        const row = attachNftDisplayMetadata(raw);
        return { collection: row.nft_collection_address, tokenId: String(row.nft_token_id),
          standard: row.asset_standard ?? 'ERC721',
          amount: String(row.asset_amount), acquiredAt: new Date(row.acquired_at).toISOString(),
          provenance: String(row.acquisition_mode).startsWith("V2") ? "V2" : "V1",
          acquisitionType: row.acquisition_mode, mintCostWei: String(row.price),
          custodyAccount: row.punk_account_address,
          custodyType: row.punk_account_address === authority.punkWallet
            ? "PUNK_WALLET" : "PUNK_AGENT_ACCOUNT",
          transactionHash: row.transaction_hash, artwork: row.nftMetadata ?? null,
          withdrawControlUrl: row.punk_account_address === authority.punkWallet
            ? `/broker/punk/${tokenId}?tab=assets` : null };
      });
    if (walletInventory?.account?.toLowerCase() === authority.punkWallet.toLowerCase()
      && walletInventory?.owner?.toLowerCase() === authority.owner.toLowerCase()) {
      candidates.push(...walletInventory.items.map(item => ({ ...item,
        custodyAccount: authority.punkWallet, custodyType: 'PUNK_WALLET',
        acquisitionType: item.provenance ?? 'RECEIVED', mintCostWei: null,
        artwork: { name: item.name, imageUrl: item.imageUrl },
        withdrawControlUrl: `/broker/punk/${tokenId}?tab=assets` })));
    }
    if (agentAccount && process.env.OPENSEA_API_KEY) {
      try {
        const indexed = await new OpenSeaPortfolioSource({ apiKey: process.env.OPENSEA_API_KEY }).accountNfts(agentAccount);
        candidates.push(...indexed.map(item => ({ ...item, custodyAccount: agentAccount,
          custodyType: 'PUNK_AGENT_ACCOUNT', provenance: 'RECEIVED', acquisitionType: 'RECEIVED',
          mintCostWei: null, acquiredAt: null, artwork: { name: item.name, imageUrl: item.imageUrl } })));
      } catch { /* Advisory index may be unavailable; only live-verified candidates are displayed. */ }
    }
    const inventory = await verifyCollectionHoldings({ candidates,
      accounts: [authority.punkWallet, agentAccount],
      readOwner: item => client.readContract({ address: item.collection, abi,
        functionName: 'ownerOf', args: [BigInt(item.tokenId)] }),
      readBalance: item => client.readContract({ address: item.collection, abi,
        functionName: 'balanceOf', args: [item.custodyAccount, BigInt(item.tokenId)] }),
      readDisplay: async item => readOnchainNftDisplay(await client.readContract({
        address: item.collection, abi, functionName: item.standard === 'ERC1155' ? 'uri' : 'tokenURI',
        args: [BigInt(item.tokenId)] })),
    });
    return json({ ok: true, tokenId, punkWallet: authority.punkWallet,
      indexedAtAuthorityBlock: authority.blockNumber, ...inventory, indexerIsCustodyAuthority: false });
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/punks/:tokenId/collection", method: "GET", rateLimit: {
  action: "rate_limit", aggregateBy: ["ip"], windowLimit: 60, windowSize: 60,
} };
