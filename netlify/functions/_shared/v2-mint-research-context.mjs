import { createHash } from 'node:crypto';
import { parseAbi, parseAbiItem } from 'viem';
import agentDeployment from '../../../deployments/robinhood-punk-agent-account.json' with { type: 'json' };
import paidRelease from '../../../deployments/robinhood-directed-paid-mint.json' with { type: 'json' };
import { ROBINHOOD } from '../../../broker/src/config.mjs';
import { readPunkAgentAccountRuntime } from '../../../broker/src/agent-account/punk-agent-account-runtime.mjs';
import { AGENT_RECOVERY_PINS, agentRecoveryProxyRuntime } from '../../../site/punk-agent-recovery.js';
import { normalizePunkCollectingIntent, punkCollectingIntentHash } from '../../../broker/src/v4/collecting-intent.mjs';
import { normalizeV2Opportunity } from '../../../broker/src/v4/opportunity.mjs';

const ADDRESS = /^0x[0-9a-f]{40}$/, HASH = /^0x[0-9a-f]{64}$/, UINT = /^(0|[1-9][0-9]{0,77})$/;
const fail = code => { throw Error(code); };
const requireValue = (value, code) => { if (!value) fail(code); };
const ABI = parseAbi(['function ownerOf(uint256) view returns(address)', 'function accountSalt() view returns(bytes32)']);
const TRANSFER = parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)');
const lower = value => typeof value === 'string' ? value.toLowerCase() : '';

// An empty SELECT is not proof of zero use when RLS hides records. Require a
// full SELECT policy for this role (or PostgreSQL's explicit RLS bypass), and
// reject applicable restrictive filters. This does not grant any privilege.
async function verifyReadCoverage(pool, tables) {
  const result = await pool.query(`SELECT COUNT(*)::integer AS tables, bool_and(
    NOT row_security_active(c.oid) OR (
      EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polcmd IN ('r','*') AND p.polpermissive
        AND (p.polqual IS NULL OR pg_get_expr(p.polqual,p.polrelid)='true')
        AND (0=ANY(p.polroles) OR EXISTS(SELECT 1 FROM unnest(p.polroles) r WHERE r<>0 AND pg_has_role(current_user,r,'USAGE'))))
      AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polcmd IN ('r','*') AND NOT p.polpermissive
        AND p.polqual IS NOT NULL AND pg_get_expr(p.polqual,p.polrelid)<>'true'
        AND (0=ANY(p.polroles) OR EXISTS(SELECT 1 FROM unnest(p.polroles) r WHERE r<>0 AND pg_has_role(current_user,r,'USAGE'))))
    )) AS complete FROM pg_class c WHERE c.oid=ANY($1::regclass[])`, [tables.map(table => `public.${table}`)]);
  requireValue(result.rows?.length === 1 && result.rows[0].tables === tables.length && result.rows[0].complete === true,
    'MINT_RESEARCH_ACCOUNTING_UNAVAILABLE');
}
const APP_TABLES = ['broker_v2_strategies', 'broker_v2_opportunities', 'broker_v2_execution_attempts',
  'broker_acquisitions', 'broker_v2_activity', 'broker_v2_agent_user_operations', 'broker_v2_agent_sessions', 'broker_paid_mint_jobs', 'broker_v4_execution_attempts'];

// Reads the deployed canonical AGENT account, not the previous V3 wallet. Every
// runtime, owner and balance read uses the same fresh block. No account creation.
export async function readMintResearchAgentAuthority({ client, tokenId, owner, now = () => new Date() }) {
  const p = AGENT_RECOVERY_PINS, block = await client.getBlock({ blockTag: 'latest' });
  const time = Number(block?.timestamp) * 1000;
  requireValue(typeof block?.number === 'bigint' && block.number >= 0n && HASH.test(block.hash)
    && Number.isSafeInteger(time) && time <= +now() && +now() - time <= 30_000, 'MINT_RESEARCH_STALE_ANCHOR');
  const blockNumber = block.number;
  const pinned = { getChainId: () => client.getChainId(),
    readContract: query => client.readContract({ ...query, blockNumber }),
    getCode: query => client.getCode({ ...query, blockNumber }),
    getBalance: query => client.getBalance({ ...query, blockNumber }) };
  const runtime = await readPunkAgentAccountRuntime({ client: pinned, deployment: agentDeployment, tokenId, expectedOwner: owner });
  requireValue(runtime.accountCreated === true, 'MINT_RESEARCH_AGENT_NOT_ACTIVATED');
  const [currentOwner, salt, code] = await Promise.all([
    pinned.readContract({ address: p.collection, abi: ABI, functionName: 'ownerOf', args: [BigInt(tokenId)] }),
    pinned.readContract({ address: p.registry, abi: ABI, functionName: 'accountSalt' }),
    pinned.getCode({ address: runtime.account }),
  ]);
  requireValue(lower(currentOwner) === owner && lower(code) === agentRecoveryProxyRuntime(tokenId, lower(salt)), 'MINT_RESEARCH_AGENT_MISMATCH');
  return { chainId: ROBINHOOD.chainId, collection: p.collection, tokenId, owner,
    punkWallet: lower(runtime.account), activated: true, nativeBalanceWei: runtime.nativeBalance.toString(),
    blockNumber: blockNumber.toString(), blockHash: block.hash, blockTime: time };
}

// Select explicit read-only columns through the already configured restricted
// Forge request role. Never read raw_transaction, transaction_json or any key.
export const SELECTED_PAID_RESEARCH_SQL = `SELECT r.intent_id, r.review_json, r.review_hash,
  r.status AS review_status, e.status AS execution_status, e.transaction_hash, e.receipt
  FROM broker_selected_paid_reviews r LEFT JOIN broker_selected_paid_executions e USING (intent_id)
  WHERE r.review_json::jsonb->>'action' = 'AUTHORIZE' ORDER BY r.created_at DESC LIMIT 1001`;
export async function readSelectedPaidMintResearchUsage({ tokenId, wallet, now = new Date(), environment = process.env,
  runtimeReader = async () => (await import('./forge-training-runtime.mjs')).forgeTrainingRuntime('request', environment) }) {
  // This release only permits one Punk. Other Punks cannot have selected-paid
  // records under this fixed release; no unavailable database is treated as empty.
  requireValue(paidRelease.schema === 'GOGH_DIRECTED_PAID_MINT_RELEASE_V1' && paidRelease.chainId === 4663
    && paidRelease.tokenId === '93' && paidRelease.collection === ROBINHOOD.canonicalCollection, 'MINT_RESEARCH_ACCOUNTING_UNAVAILABLE');
  if (tokenId !== paidRelease.tokenId) return [];
  requireValue(wallet === paidRelease.recipient, 'MINT_RESEARCH_ACCOUNTING_UNAVAILABLE');
  try {
    const { pool } = await runtimeReader();
    await verifyReadCoverage(pool, ['broker_selected_paid_reviews', 'broker_selected_paid_executions']);
    const privileges = await pool.query("SELECT has_column_privilege(current_user,'public.broker_selected_paid_executions','raw_transaction','SELECT') AS raw_read");
    requireValue(privileges.rows?.length === 1 && privileges.rows[0].raw_read === false, 'MINT_RESEARCH_ACCOUNTING_UNAVAILABLE');
    const result = await pool.query(SELECTED_PAID_RESEARCH_SQL);
    requireValue(Array.isArray(result.rows) && result.rows.length <= 1000, 'MINT_RESEARCH_ACCOUNTING_UNAVAILABLE');
    return result.rows.flatMap(row => {
      requireValue(typeof row.review_json === 'string'
        && createHash('sha256').update(row.review_json).digest('hex') === row.review_hash, 'MINT_RESEARCH_ACCOUNTING_UNAVAILABLE');
      const review = JSON.parse(row.review_json);
      requireValue(review.schema === 'GOGH_DIRECTED_PAID_REVIEW_V1' && review.intentId === row.intent_id
        && review.action === 'AUTHORIZE' && review.owner === paidRelease.owner && review.tokenId === tokenId
        && review.recipient === wallet && review.targetCollection === paidRelease.targetCollection
        && review.vault === paidRelease.vault && review.transaction?.chainId === '0x1237', 'MINT_RESEARCH_ACCOUNTING_UNAVAILABLE');
      requireValue(['PREPARED', 'WALLET_REQUESTED', 'CONFIRMED', 'REVERTED', 'CANCELLED', 'DECLINED'].includes(row.review_status)
        && [null, 'SIGNED', 'SUBMITTED', 'COMPLETED', 'REVERTED', 'STOPPED'].includes(row.execution_status), 'MINT_RESEARCH_ACCOUNTING_UNAVAILABLE');
      if (row.execution_status !== null) requireValue(row.review_status === 'CONFIRMED', 'MINT_RESEARCH_ACCOUNTING_UNAVAILABLE');
      if (row.execution_status === 'COMPLETED') {
        const receipt = row.receipt;
        requireValue(receipt?.status === 'COMPLETED' && HASH.test(row.transaction_hash)
          && receipt.transactionHash === row.transaction_hash && receipt.collection === paidRelease.targetCollection
          && receipt.recipient === wallet && UINT.test(receipt.tokenId) && UINT.test(receipt.blockTimestamp)
          && HASH.test(receipt.blockHash) && UINT.test(receipt.blockNumber) && receipt.verifiedProviders === 2
          && Number.isSafeInteger(Number(receipt.blockTimestamp) * 1000)
          && Number(receipt.blockTimestamp) * 1000 <= +now, 'MINT_RESEARCH_ACCOUNTING_UNAVAILABLE');
        return [{ ref: row.transaction_hash, source: 'SELECTED_PAID', quantity: '1',
          collection: paidRelease.targetCollection, pending: false, at: new Date(Number(receipt.blockTimestamp) * 1000).toISOString() }];
      }
      if (['REVERTED', 'STOPPED'].includes(row.execution_status) || ['REVERTED', 'CANCELLED', 'DECLINED'].includes(row.review_status)) return [];
      // A budget confirmation is not a mint receipt. Unknown/submitted missions
      // reserve one unit, including old requests until their outcome is recorded.
      return [{ ref: `selected:${row.intent_id}`, source: 'SELECTED_PAID', quantity: '1',
        collection: paidRelease.targetCollection, pending: true, at: now.toISOString() }];
    });
  } catch { fail('MINT_RESEARCH_ACCOUNTING_UNAVAILABLE'); }
}

// One snapshot in the application database. Completed acquisitions and attempts
// are deduped by transaction + NFT collection, taking the largest source count.
// Acquisition bytes32 opportunity IDs are deliberately NOT equated with V2 IDs.
// Limits count all lifetime acquisitions, and the opportunity limit counts the
// whole NFT collection plus every unresolved reservation. These conservative
// bounds may block earlier, never later.
export const MINT_RESEARCH_USAGE_SQL = `WITH attempts AS (
  SELECT a.*, o.collection_contract FROM broker_v2_execution_attempts a
  LEFT JOIN broker_v2_opportunities o ON o.opportunity_id = a.opportunity_id AND o.chain_id = a.chain_id
  WHERE a.chain_id = $1 AND a.punk_token_id = $3::numeric AND a.punk_account = $4
), acquisitions AS (
  SELECT * FROM broker_acquisitions WHERE chain_id = $1 AND punk_collection_address = $2
    AND punk_token_id = $3::numeric AND punk_account_address = $4
), sources AS (
  SELECT CASE WHEN state = 'CONFIRMED' THEN transaction_hash::text ELSE 'attempt:' || attempt_id::text END AS ref,
    'V2_ATTEMPT' AS source, 1::numeric AS quantity, collection_contract::text AS collection,
    state <> 'CONFIRMED' AS pending, CASE WHEN state = 'CONFIRMED' THEN confirmed_at ELSE $6::timestamptz END AS at
    FROM attempts WHERE state NOT IN ('REVERTED','REJECTED','CANCELLED','EXPIRED')
  UNION ALL SELECT transaction_hash::text, 'ACQUISITION', asset_amount, nft_collection_address::text, false, acquired_at FROM acquisitions
  UNION ALL SELECT ref, source, quantity, collection, pending, at FROM jsonb_to_recordset($7::jsonb)
    AS paid(ref text, source text, quantity numeric, collection text, pending boolean, at timestamptz)
), by_source AS (
  SELECT ref, collection, source, pending, SUM(quantity) AS total,
    SUM(CASE WHEN pending OR at >= date_trunc('day',$6::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' THEN quantity ELSE 0 END) AS daily
    FROM sources GROUP BY ref, collection, source, pending
), unique_mints AS (
  SELECT ref, collection, pending, MAX(total) AS total, MAX(daily) AS daily FROM by_source GROUP BY ref, collection, pending
)
SELECT COALESCE(SUM(total),0)::text AS total_mints, COALESCE(SUM(daily),0)::text AS daily_mints,
  COALESCE(SUM(CASE WHEN pending OR collection = $5 THEN total ELSE 0 END),0)::text AS opportunity_mints,
  (EXISTS (SELECT 1 FROM sources WHERE ref IS NULL OR collection IS NULL OR at IS NULL OR at > $6::timestamptz
      OR quantity IS NULL OR quantity < 1 OR quantity <> trunc(quantity))
   OR EXISTS (SELECT 1 FROM broker_paid_mint_jobs WHERE chain_id = $1 AND punk_token_id = $3::numeric
      AND status NOT IN ('RELEASED','REORGED'))
   OR EXISTS (SELECT 1 FROM broker_v4_execution_attempts WHERE chain_id = $1 AND punk_collection_address = $2
      AND punk_token_id = $3::numeric AND punk_account_address = $4 AND state NOT IN ('SAFE_FAILURE','CANCELLED'))
   OR EXISTS (SELECT 1 FROM broker_v2_activity v LEFT JOIN broker_v2_execution_attempts a USING(attempt_id)
      WHERE v.chain_id = $1 AND v.punk_token_id = $3::numeric AND v.activity_type = 'COLLECTED'
        AND (a.attempt_id IS NULL OR a.chain_id <> v.chain_id OR a.punk_token_id <> v.punk_token_id
          OR (a.punk_account = $4 AND a.state <> 'CONFIRMED')))
   OR EXISTS (SELECT 1 FROM broker_v2_agent_user_operations u JOIN attempts a USING(attempt_id)
      LEFT JOIN broker_v2_agent_sessions s USING(session_id)
      WHERE u.state IN ('SIGNED','SUBMITTED','CONFIRMED','RECONCILIATION_REQUIRED')
        AND (a.state IN ('REVERTED','REJECTED','CANCELLED','EXPIRED')
          OR (u.state = 'CONFIRMED') IS DISTINCT FROM (a.state = 'CONFIRMED')
          OR (u.transaction_hash IS NOT NULL AND a.transaction_hash IS NOT NULL AND u.transaction_hash <> a.transaction_hash)
          OR u.expected_collection <> a.collection_contract OR s.session_id IS NULL
          OR s.chain_id <> $1 OR s.collection_address <> $2 OR s.punk_token_id <> $3::numeric OR s.punk_account <> $4
          OR s.owner_snapshot <> a.owner_snapshot))
  ) AS incomplete FROM unique_mints`;

export async function readMintResearchUsage({ pool, tokenId, wallet, collection, now, selectedPaidUsageReader }) {
  try {
    await verifyReadCoverage(pool, APP_TABLES);
    const selected = await selectedPaidUsageReader({ tokenId, wallet, now });
    requireValue(Array.isArray(selected), 'MINT_RESEARCH_ACCOUNTING_UNAVAILABLE');
    const result = await pool.query(MINT_RESEARCH_USAGE_SQL, [4663, ROBINHOOD.canonicalCollection, tokenId, wallet, collection,
      now.toISOString(), JSON.stringify(selected)]);
    requireValue(result.rows?.length === 1 && result.rows[0].incomplete === false, 'MINT_RESEARCH_ACCOUNTING_UNAVAILABLE');
    const row = result.rows[0], usage = {};
    for (const [name, column] of [['dailyMints','daily_mints'], ['totalMints','total_mints'], ['opportunityMints','opportunity_mints']]) {
      requireValue(typeof row[column] === 'string' && UINT.test(row[column]) && Number.isSafeInteger(Number(row[column])), 'MINT_RESEARCH_ACCOUNTING_UNAVAILABLE');
      usage[name] = Number(row[column]);
    }
    return usage;
  } catch { fail('MINT_RESEARCH_ACCOUNTING_UNAVAILABLE'); }
}

// Only server-owned pool/client services enter this factory. Callers provide an
// identity and existing opportunity ID, never a strategy, usage or simulation.
export function createMintResearchContextReader({ pool, client, environment = process.env, now = () => new Date(),
  authorityReader = readMintResearchAgentAuthority,
  selectedPaidUsageReader = args => readSelectedPaidMintResearchUsage({ ...args, environment }),
} = {}) {
  requireValue(pool && typeof pool.query === 'function' && client, 'MINT_RESEARCH_CONTEXT_UNAVAILABLE');
  return async ({ tokenId, owner, opportunityId }) => {
    requireValue(typeof tokenId === 'string' && /^[1-9][0-9]{0,3}$/.test(tokenId) && ADDRESS.test(owner)
      && typeof opportunityId === 'string' && /^[a-zA-Z0-9:_-]{8,256}$/.test(opportunityId), 'MINT_RESEARCH_IDENTITY_INVALID');
    const authority = await authorityReader({ client, tokenId, owner, now });
    const [strategies, opportunities] = await Promise.all([
      pool.query(`SELECT version, intent_hash, intent, state, configured_by, ownership_block::text,
        owner_confirmation_hash, activated_at, expires_at FROM broker_v2_strategies
        WHERE chain_id = $1 AND collection_address = $2 AND token_id = $3::numeric
          AND state IN ('ACTIVE','PAUSED') ORDER BY version DESC LIMIT 1`, [4663, ROBINHOOD.canonicalCollection, tokenId]),
      pool.query(`SELECT opportunity_id, collection_contract, normalized, screening_status, expires_at
        FROM broker_v2_opportunities WHERE chain_id = $1 AND opportunity_id = $2`, [4663, opportunityId]),
    ]);
    const strategy = strategies.rows[0], source = opportunities.rows[0], time = new Date(now());
    requireValue(strategy?.state === 'ACTIVE' && strategy.configured_by === owner
      && HASH.test(strategy.owner_confirmation_hash) && strategy.activated_at !== null
      && Number.isFinite(+new Date(strategy.activated_at)) && +new Date(strategy.activated_at) <= +time
      && +new Date(strategy.expires_at) > +time && UINT.test(strategy.ownership_block)
      && BigInt(strategy.ownership_block) <= BigInt(authority.blockNumber), 'MINT_RESEARCH_STRATEGY_UNAVAILABLE');
    const intent = normalizePunkCollectingIntent(strategy.intent, time), version = Number(strategy.version);
    requireValue(intent.expectedOwner === owner && intent.punkTokenId === tokenId && intent.punkWallet === authority.punkWallet
      && intent.requireSimulation === true && Number.isSafeInteger(version) && version > 0
      && punkCollectingIntentHash(intent, time) === strategy.intent_hash, 'MINT_RESEARCH_STRATEGY_UNAVAILABLE');
    requireValue(source?.screening_status === 'PASSED' && source.opportunity_id === opportunityId
      && (source.expires_at === null || +new Date(source.expires_at) > +time), 'MINT_RESEARCH_OPPORTUNITY_UNAVAILABLE');
    const opportunity = normalizeV2Opportunity(source.normalized, time);
    requireValue(opportunity.opportunityId === opportunityId && opportunity.collectionContract === source.collection_contract
      && opportunity.screeningStatus === 'PASSED', 'MINT_RESEARCH_OPPORTUNITY_UNAVAILABLE');
    const fromBlock = BigInt(strategy.ownership_block), toBlock = BigInt(authority.blockNumber);
    const [usage, priorOwner, logs] = await Promise.all([
      readMintResearchUsage({ pool, tokenId, wallet: authority.punkWallet, collection: opportunity.collectionContract,
        now: time, selectedPaidUsageReader }),
      client.readContract({ address: ROBINHOOD.canonicalCollection, abi: ABI, functionName: 'ownerOf', args: [BigInt(tokenId)], blockNumber: fromBlock }),
      client.getLogs({ address: ROBINHOOD.canonicalCollection, event: TRANSFER, args: { tokenId: BigInt(tokenId) }, fromBlock, toBlock, strict: true }),
    ]);
    // Inclusive anchor rejects a transfer within the original authority block as
    // well as away-and-back transfers after activation. A new strategy is needed.
    requireValue(lower(priorOwner) === owner && Array.isArray(logs) && logs.length === 0, 'MINT_RESEARCH_STRATEGY_OWNER_CHANGED');
    const head = await client.getBlock({ blockNumber: toBlock });
    requireValue(head.hash === authority.blockHash && head.number === toBlock && await client.getChainId() === 4663
      && +now() - authority.blockTime <= 30_000, 'MINT_RESEARCH_STALE_ANCHOR');
    return { intent, opportunity, authority, usage, strategyHash: strategy.intent_hash, strategyVersion: version };
  };
}
