import { Erc20WithdrawalError } from '../../site/erc20-withdraw-wallet.js';
import { isV2DeployPreviewUrl, requireV2DeployPreview } from './_shared/v2-review.mjs';
import { getDatabase } from '@netlify/database';
import { Erc20WithdrawalCoordinator } from '../../broker/src/control-center/erc20-withdrawal.mjs';
import { createForgeRpcClients } from '../../broker/src/v4/skill-forge/rpc-clients.mjs';
import { json, readJson, requireSameOrigin, PublicError } from './_shared/http.mjs';
import { requireV2Session } from './_shared/v2-session.mjs';
import { v2TokenIdFrom } from './_shared/v2-route.mjs';
const shape = { inspect: ['operation', 'role', 'contract'], prepare: ['operation', 'role', 'contract', 'amount'],
  verify: ['operation', 'review'], recover: ['operation', 'review', 'transactionHash'] };
function runtime() {
  return new Erc20WithdrawalCoordinator({ clients: createForgeRpcClients() });
}
export async function handleErc20Withdrawal(request, { sessionPool = () => getDatabase().pool,
  sessionReader = requireV2Session, originCheck = request => isV2DeployPreviewUrl(request) ? requireV2DeployPreview(request) : requireSameOrigin(request), runtimeFactory = runtime } = {}) {
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    originCheck(request); const tokenId = v2TokenIdFrom(request, '/erc20-withdraw');
    if (new URL(request.url).search) throw new PublicError(400, 'INVALID_REQUEST', 'Choose a token withdrawal action.');
    const body = await readJson(request, 12_000), keys = shape[body?.operation];
    if (!body || Array.isArray(body) || !keys || Object.keys(body).length !== keys.length || keys.some(k => !Object.hasOwn(body, k)))
      throw new PublicError(400, 'INVALID_REQUEST', 'Choose a token withdrawal action.');
    const session = await sessionReader(request, sessionPool()), owner = session.walletAddress.toLowerCase(), coordinator = runtimeFactory();
    if (body.review && (body.review.owner !== owner || body.review.tokenId !== tokenId)) throw new PublicError(403, 'REVIEW_OWNER_CHANGED', 'This review belongs to a different Punk or wallet.');
    if (body.operation === 'inspect') return json({ ok: true, asset: await coordinator.inspect({ tokenId, owner, role: body.role, contract: body.contract }) });
    if (body.operation === 'prepare') return json({ ok: true, review: await coordinator.prepare({ tokenId, owner, role: body.role, contract: body.contract, amount: body.amount }) });
    if (body.operation === 'verify') return json({ ok: true, ...await coordinator.verify(body.review) });
    return json({ ok: true, ...await coordinator.recover(body) });
  } catch (error) {
    if (error instanceof PublicError) return json({ ok: false, code: error.code, message: error.message }, error.status);
    const code = String(error?.code ?? '');
    if (error instanceof Erc20WithdrawalError) return json({ ok: false, code,
      message: error.message }, /INVALID|UNSUPPORTED/.test(code) ? 400 : 409);
    return json({ ok: false, code: 'ERC20_WITHDRAW_UNAVAILABLE', message: 'The token checks are unavailable. No withdrawal was sent by this service. If your wallet already opened, recover that original transaction.' }, 503);
  }
}
export default handleErc20Withdrawal;
export const config = { path: '/api/v2/punks/:tokenId/erc20-withdraw', method: 'POST', rateLimit: {
  action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowLimit: 12, windowSize: 60,
} };
