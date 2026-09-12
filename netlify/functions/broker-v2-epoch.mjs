import { getDatabase } from '@netlify/database';
import { createPublicClient, http } from 'viem';
import deployment from '../../deployments/robinhood-epoch-proposal.json' with { type: 'json' };
import { readEpochRoster, readEpochPunkProfile, describeEpochEnrollment } from '../../broker/src/agent-account/punk-epoch-profile.mjs';
import { getRpcUrl } from './_shared/config.mjs';
import { requireV2Session } from './_shared/v2-session.mjs';
import { json, PublicError } from './_shared/http.mjs';

// Entirely read-only. Does not import a signer, accept calldata or modify the legacy roster.
export function createEpochProfileHandler(deps = {}) {
  const manifest = deps.deployment ?? deployment;
  return async request => {
    if (request.method !== 'GET') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    try {
      const url = new URL(request.url), path = url.pathname;
      const profilePath = path.match(/^\/api\/v2\/epoch\/punks\/(0|[1-9]\d{0,3})$/);
      if (path !== '/api/v2/epoch/roster' && !profilePath) return json({ ok: false, code: 'NOT_FOUND' }, 404);
      if (path === '/api/v2/epoch/roster') {
        const owner = url.searchParams.get('owner');
        if (!/^0x[0-9a-f]{40}$/i.test(owner ?? '') || [...url.searchParams.keys()].some(k => k !== 'owner')
          || url.searchParams.getAll('owner').length !== 1) throw new PublicError(400, 'INVALID_OWNER', 'Choose a valid owner.');
        // Public ownership only. Never return conversations, policies or wallet credentials.
        const result = await (deps.readRoster ?? readEpochRoster)({ client: manifest.status === 'UNDEPLOYED' ? null : client(), deployment: manifest, owner });
        return json({ ok: true, ...result, readOnly: true });
      }
      if (url.search) throw new PublicError(400, 'INVALID_REQUEST', 'This profile does not accept configuration parameters.');
      if (manifest.status !== 'DEPLOYED') return json({ ok: false, code: 'EPOCH_NOT_DEPLOYED',
        message: 'Session receipt enrollment is not deployed. Existing Punk accounts are unchanged.' }, 503);
      const pool = (deps.getPool ?? (() => getDatabase().pool))();
      const session = await (deps.requireSession ?? requireV2Session)(request, pool);
      const profile = await (deps.readProfile ?? readEpochPunkProfile)({ client: client(), deployment: manifest,
        tokenId: profilePath[1], expectedOwner: session.walletAddress });
      return json({ ok: true, profile, enrollment: describeEpochEnrollment(profile), readOnly: true,
        economicPermissionsActivated: false });
    } catch (error) {
      if (error instanceof PublicError) return json({ ok: false, code: error.code, message: error.message }, error.status);
      if (error.code === 'NOT_CURRENT_OWNER') return json({ ok: false, code: error.code, message: 'Current receipt ownership is required.' }, 403);
      // No raw RPC payloads, provider URLs, auth details or guessed zero balances.
      return json({ ok: false, code: 'EPOCH_READ_UNAVAILABLE',
        message: 'The receipt ownership snapshot could not be verified. Refresh before continuing.' }, 503);
    }
  };
  function client() { return deps.client ?? createPublicClient({ transport: http(getRpcUrl(), { timeout: 8000, retryCount: 0 }) }); }
}

export default createEpochProfileHandler();
export const config = { path: ['/api/v2/epoch/roster', '/api/v2/epoch/punks/:tokenId'], rateLimit: {
  action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowLimit: 30, windowSize: 60,
} };
