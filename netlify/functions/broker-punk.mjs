import { getDatabase } from "@netlify/database";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { json } from "./_shared/http.mjs";

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
    const [punkResult, acquisitionResult, decisionResult] = await Promise.all([
      getDatabase().pool.query(
        `SELECT * FROM broker_punks
          WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId],
      ),
      getDatabase().pool.query(
        `SELECT * FROM broker_acquisitions
          WHERE chain_id = $1 AND punk_collection_address = $2 AND punk_token_id = $3
          ORDER BY acquired_at DESC LIMIT 100`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId],
      ),
      getDatabase().pool.query(
        `SELECT * FROM broker_decision_logs
          WHERE punk_chain_id = $1 AND punk_collection_address = $2 AND punk_token_id = $3
          ORDER BY occurred_at DESC LIMIT 100`,
        [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId],
      ),
    ]);
    return json({
      ok: true,
      identity: {
        chainId: ROBINHOOD.chainId,
        collection: ROBINHOOD.canonicalCollection,
        tokenId,
      },
      punk: punkResult.rows[0] ?? null,
      acquisitions: acquisitionResult.rows,
      decisions: decisionResult.rows,
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
        decisions: [],
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
    aggregateBy: "ip",
    windowLimit: 120,
    windowSize: 60,
  },
};
