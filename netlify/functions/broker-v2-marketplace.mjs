import { getDatabase } from '@netlify/database';
import { marketplaceRuntime } from './_shared/marketplace-runtime.mjs';
import { json, readJson, PublicError, requireSameOrigin } from './_shared/http.mjs';
import { requireV2Session } from './_shared/v2-session.mjs';
import { v2TokenIdFrom } from './_shared/v2-route.mjs';
import { marketplaceInput, marketplaceScope, marketplaceCas } from '../../broker/src/v4/marketplace/durable-journal.mjs';

const ACTIONS = ['claim', 'recover', 'cancel', 'decline'];
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length
    || fields.some(field => !Object.hasOwn(value, field))) {
    throw new PublicError(400, 'MARKETPLACE_INVALID_INPUT', 'Refresh the purchase review and choose an available action.');
  }
}
export async function handleMarketplace(request, { runtimeFactory = marketplaceRuntime,
  sessionPool = () => getDatabase().pool, sessionReader = requireV2Session, originCheck = requireSameOrigin } = {}) {
  if (!['GET', 'POST'].includes(request.method)) return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const punkId = v2TokenIdFrom(request, '/marketplace');
    const params = new URL(request.url).searchParams;
    if ((request.method === 'POST' && [...params].length) || [...params.keys()].some(key => key !== 'intentId')
      || params.getAll('intentId').length > 1 || (params.has('intentId') && !/^[0-9a-f]{64}$/.test(params.get('intentId')))) {
      throw new PublicError(400, 'MARKETPLACE_INVALID_INPUT', 'Use the selected Punk purchase review.');
    }
    if (request.method === 'POST') originCheck(request);
    const session = await sessionReader(request, sessionPool());
    const identity = { owner: session.walletAddress.toLowerCase(), punkId };
    try { marketplaceScope(identity); }
    catch { throw new PublicError(400, 'MARKETPLACE_INVALID_SCOPE', 'Choose a valid Gogh Punk.'); }
    let body;
    if (request.method === 'POST') {
      body = await readJson(request, 4096);
      if (body?.operation === 'prepare') {
        exact(body, ['operation', 'input']);
        try { body.input = marketplaceInput(body.input); }
        catch { throw new PublicError(400, 'MARKETPLACE_INVALID_INPUT', 'Choose one to five exact ETH listings and decimal-string limits.'); }
      } else {
        if (!ACTIONS.includes(body?.operation)) throw new PublicError(400, 'MARKETPLACE_INVALID_INPUT', 'Choose an available purchase action.');
        exact(body, ['operation', 'intentId', 'revision', 'reviewHash', ...(body.operation === 'recover' && Object.hasOwn(body, 'transactionHash') ? ['transactionHash'] : [])]);
        try { marketplaceCas({ ...identity, intentId: body.intentId, revision: body.revision, reviewHash: body.reviewHash }); }
        catch { throw new PublicError(400, 'MARKETPLACE_INVALID_CAS', 'Refresh the original purchase review.'); }
        if (Object.hasOwn(body, 'transactionHash') && (typeof body.transactionHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(body.transactionHash))) {
          throw new PublicError(400, 'MARKETPLACE_INVALID_TRANSACTION_HASH', 'Use the original transaction hash.');
        }
      }
    }
    const { coordinator } = await runtimeFactory();
    const result = request.method === 'GET'
      ? await coordinator.get({ ...identity, ...(params.has('intentId') ? { intentId: params.get('intentId') } : {}) })
      : body.operation === 'prepare' ? await coordinator.prepare({ ...identity, input: body.input })
        : await coordinator[body.operation]({ ...identity, intentId: body.intentId, revision: body.revision,
          reviewHash: body.reviewHash, ...(body.operation === 'recover' && Object.hasOwn(body, 'transactionHash') ? { transactionHash: body.transactionHash } : {}) });
    return json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof PublicError) return json({ ok: false, code: error.code, message: error.message }, error.status);
    const known = typeof error.message === 'string' && /^(MARKETPLACE_[A-Z_]+|ORIGINAL_TRANSACTION_MISMATCH|WRONG_CHAIN)$/.test(error.message);
    return json({ ok: false, code: known ? error.message : 'MARKETPLACE_UNAVAILABLE',
      message: 'The purchase could not be verified. Recover the original review before opening another wallet request.',
      transaction: null, walletClaimed: false, automaticSubmission: false, publicTransactions: 0 }, known ? 409 : 503);
  }
}
export default request => handleMarketplace(request);
export const config = { path: '/api/v2/punks/:tokenId/marketplace', method: ['GET', 'POST'],
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip'], windowLimit: 20, windowSize: 60 } };
