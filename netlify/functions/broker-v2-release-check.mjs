import history from '../../docs/review/2026-09-12/selected-launch/source-standard-asset-history.json' with { type: 'json' };
import { checkReleaseChain } from '../../broker/src/v4/operations/release-readiness.mjs';
import { createForgeRpcClients } from '../../broker/src/v4/skill-forge/rpc-clients.mjs';
import { currentTrainingRelease, forgeTrainingRuntime } from './_shared/forge-training-runtime.mjs';
import { verifyAdminBearer } from './_shared/v2-session.mjs';
import { json, readJson, PublicError } from './_shared/http.mjs';
import { requireV2StrategyOrigin } from './broker-v2-strategy.mjs';

const headers = { 'cache-control': 'private, no-store', 'netlify-cdn-cache-control': 'no-store' };
export async function handleReleaseCheck(request, { environment = process.env,
  clientsFactory = () => createForgeRpcClients(environment), releaseReader = currentTrainingRelease,
  chainCheck = checkReleaseChain, trainingRuntime = role => forgeTrainingRuntime(role, environment),
} = {}) {
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405, headers);
  try {
    requireV2StrategyOrigin(request);
    verifyAdminBearer(request, { GOGH_V2_ADMIN_TOKEN: environment.GOGH_V2_RELEASE_CHECK_TOKEN });
    const body = await readJson(request, 128);
    if (!body || Array.isArray(body) || Object.keys(body).some(key => key !== 'action')
      || !['chain', 'training'].includes(body.action)) return json({ ok: false, code: 'RELEASE_CHECK_INVALID' }, 400, headers);
    let check;
    if (body.action === 'chain') check = await chainCheck({ clients: clientsFactory(), history, release: releaseReader() });
    else {
      // Runtime initialization verifies its actual restricted role and default-
      // deny RLS. No coordinator, journal write or settlement method is invoked.
      const roles = await Promise.all(['request', 'worker'].map(async role => {
        await trainingRuntime(role); return { role, restrictedRoleVerified: true };
      }));
      check = { verified: true, roles };
    }
    if (check?.verified !== true) throw Error('UNVERIFIED_RESULT');
    return json({ ok: true, code: 'RELEASE_CHECK_VERIFIED', action: body.action, check,
      checkedAt: new Date().toISOString(), walletAuthority: 'NONE', transactionSubmitted: false }, 200, headers);
  } catch (error) {
    if (error instanceof PublicError) return json({ ok: false, code: error.code, message: error.message }, error.status, headers);
    return json({ ok: false, code: 'RELEASE_CHECK_UNAVAILABLE',
      message: 'The fixed production connection check could not be verified.',
      walletAuthority: 'NONE', transactionSubmitted: false }, 503, headers);
  }
}
export default handleReleaseCheck;
export const config = { path: '/api/v2/admin/release/check', method: ['POST'], rateLimit: {
  action: 'rate_limit', aggregateBy: ['domain'], windowLimit: 4, windowSize: 60,
} };
