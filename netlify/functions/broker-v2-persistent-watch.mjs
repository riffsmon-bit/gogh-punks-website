import { getDatabase } from '@netlify/database';
import { json, readJson, PublicError } from './_shared/http.mjs';
import { v2TokenIdFrom } from './_shared/v2-route.mjs';
import { requireV2Session } from './_shared/v2-session.mjs';
import { requireV2StrategyOrigin } from './broker-v2-strategy.mjs';
import { v2Failure } from './_shared/v2-http.mjs';
import { createPersistentWatchRuntime } from './_shared/v2-persistent-watch-runtime.mjs';
import { PersistentWatchError, exactWatchObject } from '../../broker/src/v4/autonomy/persistent-domain.mjs';

export async function handleV2PersistentWatch(request, { pool = getDatabase().pool,
  environment = process.env, requireSession = requireV2Session, runtime = null } = {}) {
  try {
    if (!['GET', 'POST'].includes(request.method)) return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    const tokenId = v2TokenIdFrom(request, '/persistent-watch');
    if (tokenId === '0' || Number(tokenId) > 5016) throw new PublicError(400, 'WATCH_INVALID_PUNK', 'Choose a valid Punk.');
    const session = await requireSession(request, pool);
    if (environment.GOGH_V2_PERSISTENT_WATCH_ENABLED !== 'true') throw new PublicError(503,
      'WATCH_DISABLED', 'Continuous watching is temporarily unavailable. Your existing mint permission is unchanged.');
    const coordinator = (runtime ?? createPersistentWatchRuntime({ pool, environment })).coordinator;
    const identity = { tokenId, owner: session.walletAddress.toLowerCase() };
    if (request.method === 'GET') return json({ ok: true, tokenId, ...(await coordinator.current(tokenId, identity.owner)) });
    requireV2StrategyOrigin(request);
    const body = await readJson(request, 8192);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PublicError(400, 'WATCH_INVALID_REQUEST', 'Review your Punk settings again.');
    let result;
    if (body.action === 'prepare') {
      exactWatchObject(body, ['action', 'config', 'expectedVersion']);
      if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) throw new PublicError(400, 'WATCH_INVALID_VERSION', 'Refresh this Punk.');
      result = { draft: await coordinator.prepare({ ...identity, config: body.config, expectedVersion: body.expectedVersion }) };
    } else if (body.action === 'confirm') {
      exactWatchObject(body, ['action', 'draftId']);
      if (typeof body.draftId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.draftId)) throw new PublicError(400, 'WATCH_INVALID_DRAFT', 'Review these settings again.');
      result = await coordinator.confirm({ ...identity, draftId: body.draftId });
    } else if (body.action === 'pause') {
      exactWatchObject(body, ['action', 'expectedVersion']);
      if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) throw new PublicError(400, 'WATCH_INVALID_VERSION', 'Refresh this Punk.');
      result = { watch: await coordinator.pause({ ...identity, expectedVersion: body.expectedVersion }) };
    } else throw new PublicError(400, 'WATCH_INVALID_ACTION', 'Choose a supported watching action.');
    return json({ ok: true, tokenId, ...result, executionAuthorized: false, transactionPrepared: false, transactionSubmitted: false });
  } catch (error) {
    return v2Failure(error instanceof PersistentWatchError ? new PublicError(error.status, error.code, error.message) : error);
  }
}
export default handleV2PersistentWatch;
export const config = { path: '/api/v2/punks/:tokenId/persistent-watch', rateLimit: {
  action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowLimit: 20, windowSize: 60 } };
