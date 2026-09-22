import { getDatabase } from '@netlify/database';
import { json, readJson, PublicError } from './_shared/http.mjs';
import { requireV2OwnerOrigin } from './_shared/v2-review.mjs';
import { requireV2Session } from './_shared/v2-session.mjs';
import { v2TokenIdFrom } from './_shared/v2-route.mjs';
import { holderBurnSelection } from '../../broker/src/v4/skill-forge/holder-source.mjs';
import { holderBurnRuntime } from './_shared/holder-burn-runtime.mjs';

const FIELDS = { check: ['operation', 'sourceTokenId'] };
const MESSAGES = {
  HOLDER_BURN_NOT_RELEASED: 'Public sacrifice is not available yet. Complete wallet history and protection while a burn is awaiting confirmation must be verified first.',
  HOLDER_CREDITS_UNKNOWN: 'This Punk’s unused Training Credits could not be verified. Recheck; sacrifice remains unavailable.',
  HOLDER_CREDITS_REMAIN: 'This Punk has unused Training Credits. Use them before choosing it for sacrifice.',
  HOLDER_BURN_DIFFERENT_PUNKS_REQUIRED: 'Choose a different Punk to sacrifice. The recipient must survive to receive its credit.',
  HOLDER_BURN_OWNER_CHANGED: 'You no longer own both selected Punks. Refresh your collection and select again.',
  HOLDER_BURN_TOKEN_INVALID: 'Choose an owned Gogh Punk from the list.',
  HOLDER_HISTORY_INCOMPLETE: 'Wallet history is still being checked. Continue the check; no approval or burn was requested.',
  HOLDER_INVENTORY_UNKNOWN: 'Some token holdings could not be verified. Recheck later; burning remains unavailable.',
  HOLDER_ASSETS_PRESENT: 'This Punk still has assets. Open its wallet and withdraw them before sacrificing it.',
  HOLDER_AUTOMATION_ACTIVE: 'Pause this Punk and revoke its automated spending permission before sacrificing it.',
  HOLDER_TRANSACTION_PENDING: 'This Punk has a pending transaction. Wait for its result, then recheck.',
  HOLDER_OBLIGATIONS_UNRESOLVED: 'Missions, pending purchases, bids, refunds or legacy activity still need review. Resolve the listed items first.',
  HOLDER_NONSTANDARD_REVIEW_REQUIRED: 'Review nonstandard assets and any off-chain obligations before continuing.',
  HOLDER_CONFIRMATION_REQUIRED: 'Type BURN followed by the sacrifice Punk number exactly as shown.',
  HOLDER_RECOVER_EXISTING_REVIEW: 'Recover the existing wallet request, or cancel an unsent review before creating another.',
  HOLDER_JOURNAL_CHANGED: 'The saved review changed. Recheck its current state; an existing wallet request will not be resent.',
  BURN_REVIEW_EXPIRED: 'This review expired. Cancel this unsent review and prepare a fresh one.',
  TOKEN_ALREADY_APPROVED: 'Approval is already confirmed. Review the permanent burn next.',
  TOKEN_SPECIFIC_APPROVAL_REQUIRED: 'Approve this one Punk first. Approval does not burn it or create a credit.',
  TRAINING_PAUSED: 'Forge is temporarily paused. Recheck later.',
};
export async function handleHolderBurn(request, { runtimeFactory = holderBurnRuntime, sessionPool = () => getDatabase().pool,
  sessionReader = requireV2Session, originCheck = requireV2OwnerOrigin } = {}) {
  if (!['GET', 'POST'].includes(request.method)) return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const targetTokenId = v2TokenIdFrom(request, '/forge/holder-burn'), url = new URL(request.url);
    if (request.method === 'POST') originCheck(request);
    const session = await sessionReader(request, sessionPool());
    let body;
    if (request.method === 'GET') {
      if ([...url.searchParams.keys()].join(',') !== 'sourceTokenId') throw Error('HOLDER_BURN_REQUEST_INVALID');
      body = { sourceTokenId: url.searchParams.get('sourceTokenId') };
    } else {
      if (url.search) throw Error('HOLDER_BURN_REQUEST_INVALID');
      body = await readJson(request, 2048); const fields = FIELDS[body?.operation];
      if (!fields || Object.keys(body).length !== fields.length || fields.some(k => !Object.hasOwn(body, k))) throw Error('HOLDER_BURN_REQUEST_INVALID');
    }
    const selection = holderBurnSelection(session.walletAddress, body.sourceTokenId, targetTokenId);
    const coordinator = await runtimeFactory(selection);
    const result = request.method === 'GET' ? await coordinator.get() : { source: await coordinator.check() };
    if (result.source) result.source = { ...result.source, canBurn: false };
    return json({ ok: true, mode: 'HOLDER_BURN', ...selection, ...result });
  } catch (error) {
    if (error instanceof PublicError) return json({ ok: false, code: error.code, message: error.message }, error.status);
    const code = Object.hasOwn(MESSAGES, error.message) ? error.message : 'HOLDER_BURN_UNAVAILABLE';
    return json({ ok: false, code, message: MESSAGES[code] ?? 'The wallet check or saved review could not be verified. Recheck; no existing wallet request will be resent.' }, 409);
  }
}
export default request => handleHolderBurn(request);
export const config = { path: '/api/v2/punks/:tokenId/forge/holder-burn', method: ['GET', 'POST'],
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip'], windowLimit: 6, windowSize: 60 } };
