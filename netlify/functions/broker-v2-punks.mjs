import { getDatabase } from "@netlify/database";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { json } from "./_shared/http.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { indexedOwnerPunkIds, liveOwnerPunkSnapshot } from "./broker-owner-punks.mjs";

export default async function handler(request) {
  if (request.method !== "GET") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const pool = getDatabase().pool;
  try {
    const session = await requireV2Session(request, pool);
    const candidates = await indexedOwnerPunkIds(session.walletAddress, (...args) => pool.query(...args));
    const ownership = await liveOwnerPunkSnapshot(session.walletAddress, candidates);
    const profiles = ownership.tokenIds.length ? await pool.query(`SELECT punk.token_id::text,
        punk.account_address, profile.broker_level, strategy.version AS active_strategy_version,
        strategy.state AS strategy_state, strategy.intent->>'operatingMode' AS operating_mode
      FROM broker_punks AS punk LEFT JOIN broker_v2_profiles AS profile
        ON profile.chain_id = punk.chain_id AND profile.collection_address = punk.collection_address
          AND profile.token_id = punk.token_id
      LEFT JOIN broker_v2_strategies AS strategy ON strategy.chain_id = profile.chain_id
        AND strategy.collection_address = profile.collection_address
        AND strategy.token_id = profile.token_id AND strategy.version = profile.active_strategy_version
        AND strategy.configured_by = $4 AND strategy.intent->>'expectedOwner' = $4
      WHERE punk.chain_id = $1 AND punk.collection_address = $2
        AND punk.token_id = ANY($3::numeric[])`,
    [ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, ownership.tokenIds, session.walletAddress]) : { rows: [] };
    const byToken = new Map(profiles.rows.map((row) => [row.token_id, row]));
    return json({ ok: true, owner: session.walletAddress, chainId: ROBINHOOD.chainId,
      collection: ROBINHOOD.canonicalCollection, ownershipBlock: ownership.blockNumber.toString(),
      complete: true, punks: ownership.tokenIds.map((tokenId) => {
        const row = byToken.get(tokenId);
        return { tokenId, punkWallet: row?.account_address ?? null,
          brokerLevel: Number(row?.broker_level ?? 0), strategyVersion: row?.active_strategy_version
            ? Number(row.active_strategy_version) : null, strategyState: row?.strategy_state ?? null,
          operatingMode: row?.operating_mode ?? "ASK" };
      }) });
  } catch (error) { return v2Failure(error); }
}

export const config = { path: "/api/v2/punks", method: "GET", rateLimit: {
  action: "rate_limit", aggregateBy: ["ip"], windowLimit: 30, windowSize: 60,
} };
