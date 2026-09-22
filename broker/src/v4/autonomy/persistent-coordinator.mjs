import { randomUUID } from 'node:crypto';
import { normalizeV2Opportunity } from '../opportunity.mjs';
import { normalizePersistentConfig, persistentStatus, persistentObservationKey, evaluatePersistentOpportunity, watchFail } from './persistent-domain.mjs';

export function createPersistentWatchCoordinator({ store, readAuthority, readContinuity,
  readEconomics = async () => ({ verified: false }), now = Date.now }) {
  const economics = async (tokenId, owner, anchor) => {
    try { return await readEconomics({ tokenId, owner, anchor }); }
    catch { return { verified: false }; } // Outage never broadens capability or invents balance.
  };
  const current = async (tokenId, owner) => {
    const anchor = await readAuthority(tokenId, { expectedOwner: owner });
    let watch = await store.get(tokenId), continuityUnavailable = false;
    if (watch && watch.state === 'ACTIVE') {
      try {
        await readContinuity(watch.anchor, anchor);
        watch = await store.checkpoint(watch, anchor) ?? await store.get(tokenId);
      } catch (error) {
        if (error.code === 'WATCH_OWNER_CHANGED')
          watch = await store.pause(watch.tokenId, watch.owner, watch.version, 'OWNER_ACTION_REQUIRED');
        else continuityUnavailable = true; // Current owner may review saved taste without treating unverified history as continuous.
      }
    }
    const context = await economics(tokenId, owner, anchor);
    const projected = persistentStatus(watch, context, now());
    const status = continuityUnavailable ? { ...projected, watching: false, state: 'SAFETY_BLOCKED',
      reason: 'WATCH_OWNERSHIP_UNAVAILABLE', message: 'Watching could not verify ownership history. Refresh, or review your saved settings to start a new watching period.', action: 'REVIEW' } : projected;
    return { watch, status, history: watch ? await store.history(tokenId) : [],
      summary: watch ? await store.summary(tokenId, status.utcDay) : { reviewed: 0, matched: 0, passed: 0 },
      permission: { verified: context.verified === true, sessionActive: context.sessionActive === true,
        sessionExpiresAt: context.sessionExpiresAt ?? null, executionAuthorized: false } };
  };
  return {
    current,
    async prepare({ tokenId, owner, config, expectedVersion }) {
      const normalized = normalizePersistentConfig(config, now());
      const anchor = await readAuthority(tokenId, { expectedOwner: owner });
      const existing = await store.get(tokenId);
      if ((existing?.version ?? 0) !== expectedVersion) watchFail('WATCH_VERSION_CHANGED', 'Refresh your Punk before reviewing changed settings.');
      const draft = { draftId: randomUUID(), tokenId, owner, config: normalized, expectedVersion, anchor,
        expiresAt: new Date(now() + 600000).toISOString() };
      await store.saveDraft(draft);
      return { ...draft, authority: 'WATCH_ONLY', message: 'Keep looking until paused. This does not grant or renew wallet spending permission.' };
    },
    async confirm({ tokenId, owner, draftId }) {
      const draft = await store.getDraft(draftId, tokenId, owner);
      if (!draft || Date.parse(draft.expiresAt) <= now()) watchFail('WATCH_DRAFT_EXPIRED', 'This review expired. Review your settings again.');
      const anchor = await readAuthority(tokenId, { expectedOwner: owner });
      if (!draft.used) await readContinuity(draft.anchor, anchor);
      return store.confirmDraft(draft, anchor);
    },
    async pause({ tokenId, owner, expectedVersion }) {
      await readAuthority(tokenId, { expectedOwner: owner });
      const watch = await store.get(tokenId);
      if (!watch || watch.version !== expectedVersion) watchFail('WATCH_VERSION_CHANGED', 'Refresh before pausing this Punk.');
      // New owner may pause inherited watching; the old owner cannot pass fresh ownerOf.
      return store.pause(tokenId, watch.owner, expectedVersion);
    },
    async batch({ opportunities = [], limit = 25, maxDurationMs = 45000 } = {}) {
      if (!Number.isInteger(maxDurationMs) || maxDurationMs < 1000 || maxDurationMs > 60000) throw Error('WATCH_INVALID_DURATION');
      const startedAt = now();
      if (!Array.isArray(opportunities) || opportunities.length > 100) throw Error('WATCH_INVALID_OPPORTUNITY_BATCH');
      const ids = [...new Set(opportunities.map(x => x?.opportunityId))];
      if (ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9:_-]{8,256}$/.test(id))) throw Error('WATCH_INVALID_OPPORTUNITY_BATCH');
      // The feed returns summaries. Resolve normalized records once, shared across all selected Punks.
      const shared = []; let invalidOpportunities = 0;
      for (const value of await store.opportunities(ids)) {
        try { shared.push(normalizeV2Opportunity(value, new Date(now()))); }
        catch { invalidOpportunities++; } // One malformed feed record does not stop other research.
      }
      const watches = await store.active(limit);
      const result = { status: 'COMPLETE', checked: 0, decisions: 0, matched: 0, pausedForTransfer: 0,
        unavailable: 0, invalidOpportunities, opportunities: shared.length, executionAuthorized: false, transactionSubmitted: false };
      watchLoop: for (const snapshot of watches) {
        if (now() - startedAt >= maxDurationMs) { result.status = 'PARTIAL'; break; }
        let watch = snapshot;
        try {
          const anchor = await readAuthority(watch.tokenId);
          await readContinuity(watch.anchor, anchor);
          watch = await store.checkpoint(watch, anchor);
          if (!watch || !persistentStatus(watch, {}, now()).watching) continue;
          const context = await economics(watch.tokenId, watch.owner, anchor);
          for (const opportunity of shared) {
            if (now() - startedAt >= maxDurationMs) { result.status = 'PARTIAL'; break watchLoop; }
            const at = now(), key = persistentObservationKey(watch, opportunity, at);
            if (!await store.claim(watch, opportunity.opportunityId, key, new Date(at).toISOString().slice(0, 10))) continue;
            const decision = evaluatePersistentOpportunity({ watch, opportunity, economics: context, now: at });
            if (await store.finish(watch, key, decision)) {
              result.decisions++; if (decision.matchesTaste) result.matched++;
            }
          }
          result.checked++;
        } catch (error) {
          if (error.code === 'WATCH_OWNER_CHANGED') {
            try { await store.pause(snapshot.tokenId, snapshot.owner, snapshot.version, 'OWNER_ACTION_REQUIRED'); result.pausedForTransfer++; }
            catch { result.unavailable++; }
          } else result.unavailable++;
          await store.touch(snapshot); // Fair bounded rotation even when one provider/token fails.
        }
      }
      return result;
    },
  };
}
