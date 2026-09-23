// Passive, browser-local history. Notifications never authorize work and do not
// poll, send transactions, or infer a successful mint from a submitted operation.
const PREFIX = 'gogh-mission-notifications-v1:4663:';
const LIMIT = 100;
const FRESH_MS = 90_000;
const STATUSES = ['COMPLETED', 'FAILED', 'EXPIRED', 'REQUIRES_ATTENTION'];
const PENDING = ['SIGNED', 'SUBMITTED', 'PENDING_RECEIPT'];
const ownerKey = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value)
  && !/^0x0{40}$/i.test(value) ? value.toLowerCase() : null;
const tokenKey = value => typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value) ? value : null;
const sessionKey = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

function signal(account, time) {
  const mission = account.mission;
  const pending = PENDING.includes(mission.latestOperation?.state);
  const inactive = account.runtime.sessionActive === false;
  if (STATUSES.includes(mission.status)) {
    if (mission.status === 'REQUIRES_ATTENTION') return ['REQUIRES_ATTENTION', 'MISSION_NEEDS_REVIEW'];
    if (!inactive || pending) return ['REQUIRES_ATTENTION', 'CHECK_MISSION_RESULT'];
    if (mission.status === 'EXPIRED' && !(Date.parse(mission.validUntil) <= time)) return null;
    return [mission.status, mission.status];
  }
  if (mission.status === 'INACTIVE') return ['REQUIRES_ATTENTION', 'PERMISSION_INACTIVE'];
  if (mission.status !== 'ACTIVE') return null;
  if (inactive) return Date.parse(mission.validUntil) <= time
    ? ['EXPIRED', 'EXPIRED'] : ['REQUIRES_ATTENTION', 'PERMISSION_INACTIVE'];
  if (pending) return null;
  if (Array.isArray(account.readiness?.blockers) && account.readiness.blockers.includes('AGENT_GAS_UNFUNDED')) return ['REQUIRES_ATTENTION', 'NEEDS_GAS'];
  if (account.worker?.enabled === false) return ['REQUIRES_ATTENTION', 'WORKER_PAUSED'];
  if (account.readiness?.automaticExecutionReady === false) return ['REQUIRES_ATTENTION', 'MISSION_NOT_READY'];
  if (mission.lastFailedAt && Date.parse(mission.lastFailedAt) <= time
    && (!mission.lastCheckedAt || Date.parse(mission.lastFailedAt) >= Date.parse(mission.lastCheckedAt))) {
    return ['REQUIRES_ATTENTION', 'LAST_CHECK_FAILED'];
  }
  return null;
}

const DETAILS = Object.freeze({
  COMPLETED: 'The recorded mission is complete. Open Activity to review its results.',
  FAILED: 'The mission stopped with an error. Open Activity before retrying.',
  EXPIRED: 'This mission’s permission expired. Review a new mission to continue.',
  CHECK_MISSION_RESULT: 'The mission result and wallet permission need checking. Open Activity.',
  MISSION_NEEDS_REVIEW: 'This mission needs your attention. Open Activity for its status.',
  PERMISSION_INACTIVE: 'Mint permission is inactive. Review this Punk’s mission before restarting.',
  NEEDS_GAS: 'This Punk needs gas for its mission. Open Fund to review its balances.',
  WORKER_PAUSED: 'Automatic checks are paused. Open Activity for the current status.',
  MISSION_NOT_READY: 'This Punk’s mission is not ready to execute. Open Activity for the reason.',
  LAST_CHECK_FAILED: 'The last mission check failed. Open Activity before assuming minting is active.',
});

function view(item) {
  return Object.freeze({ ...item, title: { COMPLETED: 'Mission completed', FAILED: 'Mission failed',
    EXPIRED: 'Mission expired', REQUIRES_ATTENTION: 'Mission needs attention' }[item.status],
  detail: DETAILS[item.reason], tone: item.status === 'COMPLETED' ? 'success' : 'warning' });
}

export function createMissionNotifications({ storage, onChange = () => {}, now = Date.now } = {}) {
  if (storage === undefined) {
    try { storage = globalThis.localStorage; } catch { storage = null; }
  }
  const owners = new Map();
  const time = () => typeof now === 'function' ? now() : now;
  function state(owner) {
    if (!owners.has(owner)) {
      const fresh = { items: [], latest: [] };
      try {
        const text = storage?.getItem(PREFIX + owner);
        const parsed = text && text.length <= 150_000 ? JSON.parse(text) : null;
        if (parsed?.version === 1 && parsed.owner === owner && Array.isArray(parsed.items)) {
          const ids = new Set();
          for (const item of parsed.items.slice(0, LIMIT)) {
            if (item.owner !== owner || !tokenKey(item.tokenId) || !sessionKey(item.sessionId)
              || !STATUSES.includes(item.status) || !Object.hasOwn(DETAILS, item.reason)
              || item.id !== `${item.tokenId}:${item.sessionId}:${item.status}` || ids.has(item.id)
              || !Number.isFinite(item.observedAt) || item.observedAt > time() || item.observedAt < 0
              || typeof item.read !== 'boolean') continue;
            ids.add(item.id);
            fresh.items.push({ id: item.id, owner, tokenId: item.tokenId, sessionId: item.sessionId,
              status: item.status, reason: item.reason, observedAt: item.observedAt, read: item.read,
              completedMints: count(item.completedMints), totalLimit: count(item.totalLimit) });
          }
          for (const item of (Array.isArray(parsed.latest) ? parsed.latest : []).slice(0, LIMIT)) {
            if (tokenKey(item.tokenId) && sessionKey(item.sessionId) && Number.isFinite(item.receivedAt)
              && item.receivedAt >= 0 && item.receivedAt <= time()) {
              fresh.latest.push({ tokenId: item.tokenId, sessionId: item.sessionId, receivedAt: item.receivedAt });
            }
          }
        }
      } catch { /* Full disk, private browsing, and invalid saved history must not block the app. */ }
      owners.set(owner, fresh);
    }
    return owners.get(owner);
  }
  function save(owner, value) {
    try { storage?.setItem(PREFIX + owner, JSON.stringify({ version: 1, owner, ...value })); } catch { /* Memory-only notifications remain available. */ }
  }
  function changed(owner) { try { onChange({ owner }); } catch { /* Display failures cannot interrupt status reads. */ } }
  function list({ owner, tokenId } = {}) {
    owner = ownerKey(owner);
    if (!owner || tokenId !== undefined && !tokenKey(tokenId)) return [];
    return state(owner).items.filter(item => tokenId === undefined || item.tokenId === tokenId)
      .sort((a, b) => b.observedAt - a.observedAt).map(view);
  }
  return Object.freeze({
    list,
    unread: query => list(query).filter(item => !item.read).length,
    observe({ owner, tokenId, account } = {}) {
      owner = ownerKey(owner); tokenId = tokenKey(tokenId);
      const currentTime = time(), mission = account?.mission;
      if (!owner || !tokenId || !Number.isFinite(currentTime) || account?.ok !== true || account.error
        || ownerKey(account.owner) !== owner || String(account.tokenId) !== tokenId
        || account.chainId !== undefined && account.chainId !== 4663
        || !Number.isFinite(account.receivedAt) || account.receivedAt > currentTime
        || currentTime - account.receivedAt > FRESH_MS || !sessionKey(mission?.sessionId)
        || typeof account.runtime?.sessionActive !== 'boolean' || account.readiness?.databaseReady === false
        || account.runtime.owner !== undefined && ownerKey(account.runtime.owner) !== owner
        || mission.intent?.expectedOwner !== undefined && ownerKey(mission.intent.expectedOwner) !== owner
        || mission.intent?.punkTokenId !== undefined && String(mission.intent.punkTokenId) !== tokenId
        || mission.account !== undefined && account.runtime.account !== undefined
          && (!ownerKey(mission.account) || ownerKey(mission.account) !== ownerKey(account.runtime.account))) return null;
      const value = state(owner), previous = value.latest.find(item => item.tokenId === tokenId);
      if (previous && account.receivedAt <= previous.receivedAt) return null;
      const newSession = previous?.sessionId !== mission.sessionId;
      value.latest = [{ tokenId, sessionId: mission.sessionId, receivedAt: account.receivedAt },
        ...value.latest.filter(item => item.tokenId !== tokenId)].slice(0, LIMIT);
      const result = signal(account, currentTime);
      if (!result) { if (newSession) save(owner, value); return null; }
      const [status, reason] = result, id = `${tokenId}:${mission.sessionId}:${status}`;
      // Reading an alert acknowledges that status for that session. Repeated polls
      // (including changing blockers) must not repeatedly light its badge again.
      if (value.items.some(item => item.id === id)) return null;
      const item = { id, owner, tokenId, sessionId: mission.sessionId, status, reason,
        completedMints: count(mission.completedMints), totalLimit: count(mission.totalLimit),
        observedAt: account.receivedAt, read: false };
      // A confirmed result supersedes an earlier warning for the same mission.
      // Keep its history, but do not leave a resolved problem in the unread count.
      if (status !== 'REQUIRES_ATTENTION') for (const older of value.items) {
        if (older.tokenId === tokenId && older.sessionId === mission.sessionId) older.read = true;
      }
      value.items = [item, ...value.items].slice(0, LIMIT); save(owner, value); changed(owner);
      return view(item);
    },
    markRead({ owner, tokenId } = {}) {
      owner = ownerKey(owner);
      if (!owner || tokenId !== undefined && !tokenKey(tokenId)) return 0;
      const value = state(owner); let changedCount = 0;
      for (const item of value.items) if (!item.read && (tokenId === undefined || item.tokenId === tokenId)) {
        item.read = true; changedCount++;
      }
      if (changedCount) { save(owner, value); changed(owner); }
      return changedCount;
    },
  });
}
