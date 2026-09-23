// Display only. Saved preferences and a worker flag never grant mint authority.
export const START_FREE_MINT_COMMAND = 'Autonomously find and mint free mints. Keep my existing art preferences, daily and total mint limits, gas limit, reserve, allowed contracts and all other rules. Show the complete rules for review.';

export function missionStatus({ account, intent, now = Date.now(), preview = false } = {}) {
  const result = (label, detail, tone = 'idle', canStart = true) => ({ label, detail, tone, canStart });
  if (preview) return result('PREVIEW', 'Example data. No live mint mission is running.', 'idle', false);
  if (!account || account.error || !Number.isFinite(account.receivedAt) || account.receivedAt > now || now - account.receivedAt > 90_000
    || typeof account.runtime?.sessionActive !== 'boolean') {
    return result('STATUS NOT VERIFIED', 'Check status to verify this Punk’s current mint permission and worker. Saved rules alone do not start minting.', 'warning', false);
  }
  const m = account.mission;
  if (m?.status === 'ACTIVE') {
    if (Date.parse(m.validUntil) <= now) return result('MISSION EXPIRED', 'The mint permission expired. Review and authorize a new mission.');
    if (account.runtime?.sessionActive !== true) return result('PERMISSION INACTIVE', 'Automatic minting is stopped. Review the mission and its wallet permission.', 'warning');
    if (account.worker?.enabled !== true) return result('WORKER PAUSED', 'Your mission permission exists, but automatic checks are disabled.', 'warning', false);
    const blockers = account.readiness?.blockers ?? [];
    if (blockers.includes('AGENT_GAS_UNFUNDED')) return result('NEEDS GAS', 'The Agent Account needs ETH for network fees before it can mint. Open Fund.', 'warning', false);
    if (account.readiness?.automaticExecutionReady !== true) return result('NEEDS ATTENTION', 'The mint worker is not ready. Check readiness for the reason; minting is not confirmed active.', 'warning', false);
    if (Date.parse(m.validAfter) > now) return result('WAITING FOR START', 'Your approved mission has a future start time.', 'idle', false);
    if (['SIGNED', 'SUBMITTED', 'PENDING_RECEIPT'].includes(m.latestOperation?.state)) return result('MINT PENDING', 'A mint is awaiting its result. Activity will show the receipt and delivery.', 'active', false);
    if (m.lastFailedAt && (!m.lastCheckedAt || Date.parse(m.lastFailedAt) >= Date.parse(m.lastCheckedAt))) {
      return result('LAST CHECK FAILED', 'The last worker check failed. Open Activity for the reason; a running search is not confirmed.', 'warning', false);
    }
    const last = Date.parse(m.lastCheckedAt ?? m.validAfter);
    if (!Number.isFinite(last) || now - last > 180_000) return result('CHECK OVERDUE', 'No recent successful worker check. Open Activity and check readiness before assuming this Punk is hunting.', 'warning', false);
    return result(m.lastCheckedAt ? 'LOOKING FOR MINTS' : 'WAITING FOR FIRST CHECK',
      `${m.completedMints ?? 0} of ${m.totalLimit} free mints completed · maximum ${m.dailyLimit} per day. Scheduled checks run every minute until the mission completes, expires or is paused.`, 'active', false);
  }
  // An on-chain permission with missing application state must not offer replacement.
  if (account.runtime?.sessionActive === true) return result('CHECK PERMISSION', 'A wallet permission is active, but its mission could not be confirmed. Check readiness before starting another.', 'warning', false);
  const rules = intent ? `Saved rules: ${intent.dailyMintLimit} per day, ${intent.totalMintLimit} total · ${intent.operatingMode}. ` : '';
  const history = m?.status === 'COMPLETED' ? `Last mission completed ${m.completedMints}/${m.totalLimit} mints. ` : '';
  return result('NOT LOOKING FOR MINTS', `${rules}${history}Start a free-mint mission, review the limits and confirm its wallet permission to begin automatic minting.`);
}
