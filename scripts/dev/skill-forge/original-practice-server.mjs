// A holder-facing rehearsal around the existing deployed-stack composition.
// No browser wallet, generic RPC, arbitrary transaction or public writer exists.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createSelectedBurnCoordinator } from '../../../broker/src/v4/skill-forge/selected-burn-coordinator.mjs';
import { createSelectedBurnStore } from '../../../broker/src/v4/skill-forge/selected-burn-store.mjs';
import { checkSelectedBurnSource, SELECTED_BURN_OWNER } from '../../../broker/src/v4/skill-forge/selected-burn-source.mjs';
import { createTrainingCoordinator } from '../../../broker/src/v4/skill-forge/training-coordinator.mjs';
import { createPostgresTrainingStore } from '../../../broker/src/v4/skill-forge/postgres-training-store.mjs';
import { buildFrozenAllocation, FROZEN_RARITY_HASH } from '../../../broker/src/v4/skill-forge/rarity-allocation.mjs';
import { reconcileTrainingBatch } from '../../../broker/src/v4/skill-forge/training-reconciler.mjs';
import { createDurableTrainingWallet } from '../../../site/forge-durable-wallet.js';
import { createV2McpResearch } from '../../../netlify/functions/_shared/v2-mcp-research.mjs';
import { validateTrainingRelease } from '../../../broker/src/v4/skill-forge/training-release.mjs';
import { loadResearchSkillCatalog } from '../../../broker/src/v4/skill-forge/research-runtime.mjs';
import { originalPracticeReviewState } from './original-practice-review.mjs';

const owner = SELECTED_BURN_OWNER, tokenId = '93';
const json = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
const exact = (input, keys) => input && Object.getPrototypeOf(input) === Object.prototype
  && Object.keys(input).sort().join(',') === keys.sort().join(',');
const safe = message => /^[A-Z0-9_]+$/.test(message) ? message : 'PRACTICE_CHECK_UNAVAILABLE';

export async function serveOriginalForgePractice({ clients, client, sourceClients, release, binding, requests, workers,
  fresh, send, finalize, anchor, forbiddenPorts, onReady, stopSignal } = {}) {
  if (await client.getChainId() !== 4663 || !/anvil/i.test(await client.request({ method: 'web3_clientVersion' }))
    || release.collection !== '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6') throw Error('OWNED_DISPOSABLE_CHAIN_REQUIRED');
  const frozen = JSON.parse(await readFile(new URL(`../../../artifacts/skill-forge/rarity/gogh-opensea-rarity-${FROZEN_RARITY_HASH}.json`, import.meta.url), 'utf8'));
  const allocation = buildFrozenAllocation(frozen);
  const allocationReader = async id => ({ startingSlots: frozen.payload.records.find(r => String(r.tokenId) === id).startingSlots, proof: allocation.proof(id) });
  const coordinator = createTrainingCoordinator({ pool: requests, storeFactory: createPostgresTrainingStore, client, release, allocationReader });
  const worker = createPostgresTrainingStore({ pool: workers, deployment: binding });
  // These are actual copied wallet/balance/standard-history checks. Application
  // jobs are intentionally absent from this disposable database, not certified
  // absent from production. The screen states that remaining limitation.
  const checkSource = () => checkSelectedBurnSource({ clients: sourceClients, checkObligations: async () => ({
    clear: true, scope: 'EMPTY_DISPOSABLE_APPLICATION_NOT_LIVE_OBLIGATION_CLEARANCE',
  }) });
  const burn = createSelectedBurnCoordinator({ clients, release, store: createSelectedBurnStore(requests, owner, '1753'), checkSource });
  const research = createV2McpResearch({ releaseReader: () => validateTrainingRelease(release), clientFactory: () => client,
    packageLoader: loadResearchSkillCatalog, environment: {} });
  const nonce = randomBytes(32).toString('hex'), sent = new Map(), attempted = new Set();
  let server, origin, busy = false, review = null, lastResult = null, lastError = null, stopped = false;
  const scope = () => ({ owner, tokenId, ...(review?.kind === 'TRAINING' ? { intentId: review.prepared.record.intentId } : {}) });
  const state = async () => {
    await fresh();
    const selectedReview = review;
    const training = await coordinator.get(scope());
    const burnState = await burn.get();
    if (selectedReview !== review) throw Error('PRACTICE_REVIEW_UNAVAILABLE');
    const reviewState = review ? originalPracticeReviewState(review,
      review.kind === 'TRAINING' ? training.record : burnState.record, sent.get(review.id) ?? null) : null;
    if (review) review.status = reviewState.status;
    return { schema: 'GOGH_ORIGINAL_FORGE_INTERACTIVE_PRACTICE_V1', localOnly: true, productionAuthority: false,
      sourceTokenId: '1753', targetTokenId: tokenId, copiedChainId: 4663, forkAnchor: { number: String(anchor.number), hash: anchor.hash },
      nonce, busy, training: training.state, burn: burnState.state, review: review ? {
        id: review.id, kind: review.kind, action: review.action, ...reviewState,
        feeCeilingWei: review.kind === 'BURN' ? review.prepared.record.review.maximumNetworkFeeWei : review.prepared.feeCeilingWei,
        expiresAt: review.kind === 'BURN' ? review.prepared.record.review.expiresAt : Number(review.prepared.record.review.guard.deadline) * 1000,
      } : null, lastResult, lastError,
      sourceCoverage: 'Actual copied wallets and standard event history. Empty disposable jobs are a fixture. Nonstandard assets, later deposits and live obligations are not certified.',
      walletRequests: 0, publicTransactions: 0 };
  };
  const finish = async () => {
    if (!review || ['CONFIRMED', 'SETTLED_SUCCESS', 'CANCELLED'].includes(review.status)) return;
    const hash = sent.get(review.id);
    if (!hash) {
      const row = review.kind === 'BURN' ? (await burn.get()).record : (await coordinator.get(scope())).record;
      const current = originalPracticeReviewState(review, row);
      review.status = current.status;
      // Only a persisted PREPARED row proves claim never reached the wallet.
      // Any claimed/unknown result stays reserved and cannot be sent again.
      if (current.canDiscardUnsent) attempted.delete(review.id);
      return;
    }
    await finalize();
    if (review.kind === 'BURN') {
      let row = (await burn.get()).record;
      if (row.status === 'WALLET_REQUESTED') row = (await burn.recover({ intentId: row.review.intentId, revision: row.revision, transactionHash: hash })).record;
      review.status = row.status;
      if (row.status === 'CONFIRMED') lastResult = { action: review.action, confirmed: true, copiedTransactionHash: hash,
        creditGained: review.action === 'BURN' ? 1 : 0 };
    } else {
      let row = (await coordinator.get(scope())).record;
      if (!row.transactionHash) await coordinator.mutate(scope(), 'recover', row.revision, hash);
      await reconcileTrainingBatch({ store: worker, clients, expectedRuntimeHash: release.progressionCodeHash, expectedSnapshotHash: release.snapshotHash });
      row = (await worker.get(scope())); review.status = row.status;
      if (row.status === 'SETTLED_SUCCESS') lastResult = { action: review.action, confirmed: true, copiedTransactionHash: hash };
    }
  };
  async function act(body) {
    if (!exact(body, ['operation', 'input'])) throw Error('PRACTICE_ARGUMENTS_INVALID');
    await fresh(); lastError = null;
    if (body.operation === 'prepare_burn') {
      if (!exact(body.input, ['action']) || !['ENABLE_FORGE', 'APPROVE', 'BURN'].includes(body.input.action)) throw Error('PRACTICE_ACTION_INVALID');
      if (review && !['CONFIRMED', 'SETTLED_SUCCESS', 'CANCELLED'].includes(review.status)) throw Error('RECOVER_OR_CANCEL_CURRENT_REVIEW');
      const prepared = await burn.prepare(body.input.action);
      review = { id: prepared.record.review.intentId, kind: 'BURN', action: body.input.action, prepared, status: 'PREPARED' };
    } else if (body.operation === 'prepare_training') {
      if (!exact(body.input, ['action']) || !exact(body.input.action, ['operation'])
        || !['learn', 'equip', 'unequip', 'claim_rarity', 'unlock'].includes(body.input.action.operation)) throw Error('PRACTICE_ACTION_INVALID');
      if (review && !['CONFIRMED', 'SETTLED_SUCCESS', 'CANCELLED'].includes(review.status)) throw Error('RECOVER_OR_CANCEL_CURRENT_REVIEW');
      const operation = body.input.action.operation, action = { operation,
        ...(['learn', 'equip'].includes(operation) ? { skillKey: release.skills[0].key } : {}),
        ...(['equip', 'unequip'].includes(operation) ? { slot: 0 } : {}) };
      const prepared = await coordinator.prepare({ owner, tokenId, action, requestKey: randomBytes(32).toString('hex') });
      review = { id: prepared.record.intentId, kind: 'TRAINING', action: operation, prepared, status: 'PREPARED', trainingAction: action };
    } else if (body.operation === 'confirm') {
      if (!exact(body.input, ['id', 'confirmation', 'acknowledged']) || body.input.id !== review?.id
        || body.input.acknowledged !== true || body.input.confirmation !== (review.action === 'BURN' ? 'BURN COPY 1753' : 'CONFIRM COPY')) throw Error('PRACTICE_CONFIRMATION_REQUIRED');
      if (review.status !== 'PREPARED' || attempted.has(review.id)) { await finish(); return; }
      attempted.add(review.id); review.status = 'CHECKING';
      if (review.kind === 'BURN') {
        const row = review.prepared.record;
        const claimed = await burn.claim({ intentId: row.review.intentId, revision: row.revision, reviewHash: row.reviewHash,
          confirmation: 'BURN 1753', obligationsReviewed: true });
        review.status = 'WALLET_REQUESTED';
        sent.set(review.id, await send(claimed.transaction));
      } else {
        const control = createDurableTrainingWallet({ release, binding, isCurrent: () => true,
          wasAttempted: () => false, markAttempted: async () => {},
          readCurrent: async () => ({ ok: true, mode: 'OWNER_CANARY', canBurn: false, chainId: 4663, owner, tokenId, ...(await coordinator.get(scope())) }),
          claim: (intentId, revision, reviewHash) => coordinator.claim({ owner, tokenId, intentId }, revision, reviewHash),
          provider: { request: async input => {
            if (input.method === 'eth_accounts') return [owner];
            if (input.method === 'eth_sendTransaction') {
              review.status = 'WALLET_REQUESTED'; const hash = await send(input.params[0]); sent.set(review.id, hash); return hash;
            }
            return client.request(input);
          } },
        });
        await control.submit(review.prepared, { owner, tokenId, chainId: 4663, preview: false }, review.trainingAction);
      }
      await finish();
    } else if (body.operation === 'cancel') {
      if (!exact(body.input, ['id']) || body.input.id !== review?.id) throw Error('PRACTICE_UNSENT_REVIEW_REQUIRED');
      // Re-read the exact intent: a prior GET may have expired it and advanced
      // its revision. Never clear an unknown send merely because time elapsed.
      const row = review.kind === 'BURN' ? (await burn.get()).record : (await coordinator.get(scope())).record;
      const current = originalPracticeReviewState(review, row, sent.get(review.id) ?? null);
      if (!current.canDiscardUnsent) throw Error('PRACTICE_UNSENT_REVIEW_REQUIRED');
      if (row.status === 'PREPARED') {
        const cancelled = review.kind === 'BURN'
          ? (await burn.cancel({ intentId: review.id, revision: row.revision })).record
          : await coordinator.mutate(scope(), 'cancel', row.revision);
        if (!['CANCELLED', 'EXPIRED'].includes(cancelled.status)) throw Error('PRACTICE_UNSENT_REVIEW_REQUIRED');
      }
      attempted.delete(review.id);
      review = null;
    } else if (body.operation === 'research') {
      if (!exact(body.input, [])) throw Error('PRACTICE_ARGUMENTS_INVALID');
      lastResult = await research.call({ owner, tokenId, name: 'rank_trait_sample', arguments: { sampleTokenIds: ['93', '95', '96'] } });
    } else if (body.operation === 'recheck') {
      if (!exact(body.input, [])) throw Error('PRACTICE_ARGUMENTS_INVALID'); await finish();
    } else throw Error('PRACTICE_ACTION_INVALID');
  }
  server = createServer(async (req, res) => {
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" };
    const respond = (code, type, body) => { res.writeHead(code, { ...headers, 'content-type': type }); res.end(body); };
    try {
      if (!origin || req.headers.host !== new URL(origin).host || req.url.includes('?')) return respond(403, 'text/plain', 'LOCAL_PRACTICE_ONLY');
      const files = { '/': ['original-practice.html', 'text/html'], '/practice.js': ['original-practice.js', 'text/javascript'], '/practice.css': ['original-practice.css', 'text/css'] };
      if (req.method === 'GET' && files[req.url]) { const [file, type] = files[req.url]; return respond(200, type, await readFile(new URL(file, import.meta.url))); }
      if (req.url !== '/api/practice' || !['GET', 'POST'].includes(req.method)) return respond(404, 'text/plain', 'NOT_FOUND');
      if (req.method === 'POST') {
        const given = req.headers['x-forge-nonce'];
        if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json' || typeof given !== 'string'
          || given.length !== nonce.length || !timingSafeEqual(Buffer.from(given), Buffer.from(nonce))) return respond(403, 'text/plain', 'LOCAL_CONFIRMATION_REQUIRED');
        if (busy) return respond(409, 'text/plain', 'PRACTICE_CHECK_IN_PROGRESS');
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) throw Error('PRACTICE_REQUEST_TOO_LARGE'); }
        busy = true;
        try { await act(JSON.parse(body)); } finally { busy = false; }
      }
      respond(200, 'application/json', json(await state()));
    } catch (error) { lastError = safe(String(error.message)); respond(409, 'application/json', json({ ok: false, code: lastError, publicTransactions: 0 })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  if (forbiddenPorts?.has(server.address().port)) { server.close(); throw Error('PROTECTED_PRACTICE_PORT'); }
  origin = `http://127.0.0.1:${server.address().port}`;
  console.log(json({ status: 'PRACTICE_READY', url: origin, source: 'COPY #1753', target: 'COPY #93', realWalletRequired: false,
    copiedChainId: 4663, publicTransactions: 0, note: 'Do not add this copied network to a real wallet. The page controls only its own disposable node.' }));
  await onReady?.({ url: origin });
  await new Promise(resolve => {
    const stop = () => { if (stopped) return; stopped = true; process.off('SIGINT', stop); process.off('SIGTERM', stop); stopSignal?.removeEventListener('abort', stop); resolve(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop); stopSignal?.addEventListener('abort', stop, { once: true });
    if (stopSignal?.aborted) stop();
  });
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
