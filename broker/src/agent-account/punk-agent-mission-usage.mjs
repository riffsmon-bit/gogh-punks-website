import { ROBINHOOD } from "../config.mjs";

export async function readPunkAgentMissionUsage(pool, mission, opportunityId, now) {
  // Total is the current owner-approved session's budget. Daily and collection
  // limits retain the Punk's history across sessions, including unresolved sends.
  const parameters = [new Date(now).toISOString(), opportunityId,
    ROBINHOOD.chainId, mission.tokenId, mission.sessionId];
  const result = await pool.query(`SELECT
      COUNT(*) FILTER (WHERE activity.occurred_at >= date_trunc('day', $1::timestamptz
        AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::integer AS daily,
      COUNT(*) FILTER (WHERE operation.session_id = $5::uuid)::integer AS total,
      COUNT(*) FILTER (WHERE activity.opportunity_id = $2)::integer AS opportunity
    FROM broker_v2_activity activity
    LEFT JOIN broker_v2_agent_user_operations operation ON operation.attempt_id = activity.attempt_id
    WHERE activity.chain_id = $3 AND activity.punk_token_id = $4::numeric
      AND activity.activity_type = 'COLLECTED'`, parameters);
  const pending = await pool.query(`SELECT
      COUNT(*) FILTER (WHERE operation.session_id = $5::uuid)::integer AS total,
      COUNT(*) FILTER (WHERE operation.created_at >= date_trunc('day', $1::timestamptz
        AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::integer AS daily,
      COUNT(*) FILTER (WHERE operation.opportunity_id = $2)::integer AS opportunity
    FROM broker_v2_agent_user_operations operation
    JOIN broker_v2_agent_sessions session ON session.session_id = operation.session_id
    WHERE session.chain_id = $3 AND session.punk_token_id = $4::numeric
      AND operation.state IN ('SIGNED', 'SUBMITTED', 'RECONCILIATION_REQUIRED')`, parameters);
  const collected = result.rows[0] ?? {}; const open = pending.rows[0] ?? {};
  return Object.freeze({ dailyMints: Number(collected.daily ?? 0) + Number(open.daily ?? 0),
    totalMints: Number(collected.total ?? 0) + Number(open.total ?? 0),
    opportunityMints: Number(collected.opportunity ?? 0) + Number(open.opportunity ?? 0) });
}
