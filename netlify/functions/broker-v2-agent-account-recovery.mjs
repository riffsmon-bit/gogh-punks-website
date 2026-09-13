import { getDatabase } from '@netlify/database';
import { createPublicClient, http } from 'viem';
import { prepareAgentRecovery } from '../../broker/src/agent-account/punk-agent-recovery.mjs';
import { normalizeAgentRecoveryIntent } from '../../site/punk-agent-recovery.js';
import { requireV2Session } from './_shared/v2-session.mjs';
import { PublicError, json, readJson, requireSameOrigin } from './_shared/http.mjs';
import { getRpcUrl } from './_shared/config.mjs';
import { isV2DeployPreviewUrl, requireV2DeployPreview } from './_shared/v2-review.mjs';

const known = new Set(['OWNER_CHANGED', 'ACCOUNT_NOT_ACTIVATED', 'RUNTIME_CHANGED', 'NONCE_CHANGED',
  'BALANCE_CHANGED', 'RECALL_REQUIRED', 'ASSET_CHANGED', 'INVALID_INTENT', 'INVALID_REVIEW',
  'FEE_CHANGED', 'STALE_BLOCK', 'SIMULATION_FAILED', 'DEPLOYMENT_MISMATCH']);
export async function handleAgentRecovery(request, { pool = null, client = null,
  requireSession = requireV2Session, now = () => Date.now(), prepare = prepareAgentRecovery } = {}) {
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    if (isV2DeployPreviewUrl(request)) requireV2DeployPreview(request); else requireSameOrigin(request);
    const body = await readJson(request, 4_000);
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'intent'))
      throw new PublicError(400, 'INVALID_REQUEST', 'Choose a typed Agent recovery action.');
    const intent = normalizeAgentRecoveryIntent(body.intent);
    const session = await requireSession(request, pool ?? getDatabase().pool, new Date(now()));
    const rpc = client ?? createPublicClient({ transport: http(getRpcUrl(), { timeout: 8_000, retryCount: 0 }) });
    const review = await prepare({ client: rpc, intent, owner: session.walletAddress, now });
    return json({ ok: true, review, transactionSubmitted: false });
  } catch (error) {
    if (error instanceof PublicError) return json({ ok: false, code: error.code, message: error.message }, error.status);
    const suffix = String(error?.code ?? '').replace(/^AGENT_RECOVERY_/, '');
    if (known.has(suffix)) return json({ ok: false, code: `AGENT_RECOVERY_${suffix}`,
      message: suffix === 'RECALL_REQUIRED' ? 'Recall the Agent session before withdrawing its EntryPoint gas deposit.'
        : 'The recovery checks did not pass. Refresh ownership, balances and the selected asset, then review again.' },
    suffix.startsWith('INVALID_') ? 400 : 409);
    return json({ ok: false, code: 'AGENT_RECOVERY_UNAVAILABLE',
      message: 'Agent recovery checks are unavailable. No transaction was submitted.' }, 503);
  }
}
export default handleAgentRecovery;
export const config = { path: '/api/v2/agent-account/recovery', method: 'POST', rateLimit: {
  action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowLimit: 20, windowSize: 60,
} };
