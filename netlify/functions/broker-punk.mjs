import { getDatabase } from "@netlify/database";
import { createPublicClient, defineChain, http, keccak256, parseAbi } from "viem";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import {
  attachNftDisplayMetadata,
  NFT_DISPLAY_METADATA_SELECT,
  nftDisplayMetadata,
} from "./_shared/broker-display-metadata.mjs";
import { json } from "./_shared/http.mjs";
import { getRpcUrl } from "./_shared/config.mjs";
import { CURRENT_BROKER_DEPLOYMENT_SURFACE } from
  "./_shared/broker-deployment-surface.mjs";
import { COMPLETED_EXTERNAL_FREE_MINTS } from
  "./_shared/external-free-mint-display.mjs";

const PUNK_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);
const REGISTRY_ABI = parseAbi([
  "function account(uint256 tokenId) view returns (address)",
  "function isAccountCreated(uint256 tokenId) view returns (bool)",
]);
const ACCOUNT_ABI = parseAbi([
  "function owner() view returns (address)",
  "function token() view returns (uint256 chainId,address tokenContract,uint256 tokenId)",
]);
const CANARY_ART_ABI = parseAbi([
  "function minted() view returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

function liveClient() {
  const rpcUrl = getRpcUrl();
  const chain = defineChain({
    id: ROBINHOOD.chainId,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export async function readLivePunkState(
  tokenId,
  surface = CURRENT_BROKER_DEPLOYMENT_SURFACE,
  client = liveClient(),
) {
  if (surface?.deploymentStatus !== "DEPLOYED" || !surface.accountRegistry) return null;
  const id = BigInt(tokenId);
  const [owner, account, created] = await Promise.all([
    client.readContract({ address: ROBINHOOD.canonicalCollection, abi: PUNK_ABI,
      functionName: "ownerOf", args: [id] }),
    client.readContract({ address: surface.accountRegistry, abi: REGISTRY_ABI,
      functionName: "account", args: [id] }),
    client.readContract({ address: surface.accountRegistry, abi: REGISTRY_ABI,
      functionName: "isAccountCreated", args: [id] }),
  ]);
  const code = await client.getCode({ address: account });
  const deployed = created === true && typeof code === "string" && code !== "0x";
  if (created !== deployed) throw new Error("live Punk Account creation signals disagree");
  if (deployed) {
    const [accountOwner, footer] = await Promise.all([
      client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "owner" }),
      client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "token" }),
    ]);
    if (accountOwner.toLowerCase() !== owner.toLowerCase()
      || BigInt(footer[0]) !== BigInt(ROBINHOOD.chainId)
      || footer[1].toLowerCase() !== ROBINHOOD.canonicalCollection
      || BigInt(footer[2]) !== id) throw new Error("live Punk Account binding mismatch");
  }
  let canaryAsset = null;
  const external = COMPLETED_EXTERNAL_FREE_MINTS.find((item) => (
    item.punkTokenId === tokenId && item.account === account.toLowerCase()
  ));
  if (deployed && external?.status === "COMPLETED_AND_CONTAINED") {
    const collectionCode = await client.getCode({ address: external.candidate.collection });
    if (typeof collectionCode === "string" && collectionCode !== "0x"
      && keccak256(collectionCode) === external.candidate.collectionRuntimeCodeHash) {
      const assetOwner = await client.readContract({ address: external.candidate.collection,
        abi: CANARY_ART_ABI, functionName: "ownerOf", args: [BigInt(external.result.tokenId)] });
      if (assetOwner.toLowerCase() === account.toLowerCase()) {
        canaryAsset = Object.freeze({
          status: "CONFIRMED_ONCHAIN",
          collection: external.candidate.collection,
          tokenId: external.result.tokenId,
          owner: account.toLowerCase(),
          name: `${external.candidate.name} #${external.result.tokenId}`,
          standard: "ERC721",
          executionMode: external.executionMode,
          transactionHash: external.result.transactionHash,
          containment: external.result.containment,
        });
      }
    }
  }
  if (!canaryAsset && surface.canaryStatus === "DEPLOYED" && surface.canary?.punkTokenId === tokenId
    && surface.canary.account === account.toLowerCase()) {
    const outputTokenId = BigInt(surface.canary.tokenId);
    const minted = await client.readContract({ address: surface.canary.collection,
      abi: CANARY_ART_ABI, functionName: "minted" });
    if (minted) {
      const assetOwner = await client.readContract({ address: surface.canary.collection,
        abi: CANARY_ART_ABI, functionName: "ownerOf", args: [outputTokenId] });
      if (assetOwner.toLowerCase() !== account.toLowerCase()) {
        throw new Error("live canary owner differs from Punk Account");
      }
      canaryAsset = Object.freeze({
        status: "CONFIRMED_ONCHAIN",
        collection: surface.canary.collection,
        tokenId: surface.canary.tokenId,
        owner: account.toLowerCase(),
        name: `Gogh One-Shot Canary #${surface.canary.tokenId}`,
        standard: "ERC721",
      });
    }
  }
  return Object.freeze({
    status: "LIVE_ONCHAIN",
    tokenId,
    owner: owner.toLowerCase(),
    account: account.toLowerCase(),
    activated: deployed,
    canaryAsset,
  });
}

function tokenIdFrom(request) {
  const match = new URL(request.url).pathname.match(/^\/api\/punk\/(\d+)$/);
  if (!match) return null;
  try {
    const tokenId = BigInt(match[1]);
    return tokenId >= 0n && tokenId < 10_000n ? tokenId.toString() : null;
  } catch {
    return null;
  }
}

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const tokenId = tokenIdFrom(request);
  if (tokenId === null) return json({ ok: false, code: "INVALID_TOKEN_ID" }, 400);
  try {
    const [punkResult, acquisitionResult, recommendationResult, decisionResult, liveState] = await Promise.all([
      getDatabase().pool.query(
        `SELECT punk.*, ${NFT_DISPLAY_METADATA_SELECT}
           FROM broker_punks AS punk
           LEFT JOIN broker_nft_metadata AS nft_metadata
             ON nft_metadata.chain_id = punk.chain_id
            AND nft_metadata.collection_address = punk.collection_address
            AND nft_metadata.token_id = punk.token_id
          WHERE punk.chain_id = $1
            AND punk.collection_address = $2
            AND punk.token_id = $3`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId],
      ),
      getDatabase().pool.query(
        `SELECT acquisition.*, ${NFT_DISPLAY_METADATA_SELECT}
           FROM broker_acquisitions AS acquisition
           LEFT JOIN broker_nft_metadata AS nft_metadata
             ON nft_metadata.chain_id = acquisition.chain_id
            AND nft_metadata.collection_address = acquisition.nft_collection_address
            AND nft_metadata.token_id = acquisition.nft_token_id
          WHERE acquisition.chain_id = $1
            AND acquisition.punk_collection_address = $2
            AND acquisition.punk_token_id = $3
          ORDER BY acquisition.acquired_at DESC LIMIT 100`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId],
      ),
      getDatabase().pool.query(
        `SELECT recommendation.id, recommendation.recommendation,
                recommendation.scores, recommendation.explanation,
                recommendation.reasoning_hash, recommendation.agent_version_hash,
                recommendation.policy_version, recommendation.created_at,
                opportunity.collection_address,
                opportunity.token_id, opportunity.source, opportunity.opportunity_type,
                opportunity.creator_address, opportunity.marketplace_address,
                opportunity.currency_address, opportunity.expected_price,
                opportunity.maximum_price, opportunity.metadata,
                opportunity.risk_label, opportunity.discovered_at,
                opportunity.source_transaction_hash,
                decision.public_detail AS decision_detail,
                ${NFT_DISPLAY_METADATA_SELECT}
           FROM broker_recommendations AS recommendation
           JOIN broker_opportunities AS opportunity
             ON opportunity.id = recommendation.opportunity_id
           LEFT JOIN broker_nft_metadata AS nft_metadata
             ON nft_metadata.chain_id = opportunity.chain_id
            AND nft_metadata.collection_address = opportunity.collection_address
            AND nft_metadata.token_id = opportunity.token_id
           LEFT JOIN broker_decision_logs AS decision
             ON decision.recommendation_id = recommendation.id
            AND decision.event_type = 'SCOUT_RECOMMENDATION'
          WHERE recommendation.punk_chain_id = $1
            AND recommendation.punk_collection_address = $2
            AND recommendation.punk_token_id = $3
            AND opportunity.canonical = TRUE
          ORDER BY recommendation.created_at DESC, recommendation.id
          LIMIT 24`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId],
      ),
      getDatabase().pool.query(
        `SELECT * FROM broker_decision_logs
          WHERE punk_chain_id = $1 AND punk_collection_address = $2 AND punk_token_id = $3
          ORDER BY occurred_at DESC LIMIT 24`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId],
      ),
      readLivePunkState(tokenId).catch((error) => {
        const type = String(error?.name ?? "Error").replace(/[^A-Za-z0-9_]/g, "");
        const code = String(error?.code ?? "NONE").replace(/[^A-Za-z0-9_-]/g, "");
        const functionName = String(error?.functionName ?? error?.cause?.functionName ?? "NONE")
          .replace(/[^A-Za-z0-9_]/g, "");
        console.error(`BROKER_PUNK_LIVE_READ_FAILED type=${type} code=${code} function=${functionName}`);
        return null;
      }),
    ]);
    const rawPunk = punkResult.rows[0] ?? null;
    const punk = attachNftDisplayMetadata(rawPunk);
    return json({
      ok: true,
      identity: {
        chainId: ROBINHOOD.chainId,
        collection: ROBINHOOD.canonicalCollection,
        tokenId,
        artwork: nftDisplayMetadata(rawPunk ?? {}),
      },
      punk,
      acquisitions: acquisitionResult.rows.map(attachNftDisplayMetadata),
      recommendations: recommendationResult.rows.map(attachNftDisplayMetadata),
      decisions: decisionResult.rows,
      liveState,
      managementEnabled: false,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "BROKER_PUNK_READ_FAILED", type: error?.name }));
    return json(
      {
        ok: true,
        identity: {
          chainId: ROBINHOOD.chainId,
          collection: ROBINHOOD.canonicalCollection,
          tokenId,
        },
        punk: null,
        acquisitions: [],
        recommendations: [],
        decisions: [],
        liveState: null,
        managementEnabled: false,
        dataStatus: "INDEXER_NOT_READY",
      },
      200,
      { "cache-control": "public, max-age=30" },
    );
  }
}

export const config = {
  path: "/api/punk/:tokenId",
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowLimit: 120,
    windowSize: 60,
  },
};
