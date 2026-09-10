// Read-only roster reconciliation. An NFT transfer needs no claim or wallet prompt.
// This updates presentation; execution must still verify live ownerOf and history.
export function createOwnerRefresh({ getContext, getPunks, readOwned, onChanged, onUnavailable,
  now = Date.now, minimumIntervalMs = 15_000 }) {
  let generation = 0, pending = null, checkedAt = -Infinity, unavailable = false;
  const identity = context => context?.chainId === 4663
    && /^0x[0-9a-f]{40}$/i.test(context.owner ?? '') ? context.owner.toLowerCase() : null;
  const ids = punks => {
    if (!Array.isArray(punks) || punks.length > 5017) throw Error('INVALID_ROSTER');
    const values = punks.map(p => p?.tokenId);
    if (values.some(id => typeof id !== 'string' || !/^(0|[1-9]\d{0,3})$/.test(id))
      || new Set(values).size !== values.length) throw Error('INVALID_ROSTER');
    return values.sort((a, b) => Number(a) - Number(b)).join(',');
  };
  const current = (n, owner) => n === generation && identity(getContext()) === owner;
  return {
    invalidate() { ++generation; pending = null; checkedAt = -Infinity; unavailable = false; },
    async refresh() {
      const context = getContext(), owner = identity(context), n = generation;
      if (!owner || context.visible === false || context.loading || pending !== null
        || now() - checkedAt < minimumIntervalMs) return { status: 'SKIPPED' };
      checkedAt = now();
      const request = {}; pending = request;
      try {
        const punks = await readOwned(owner);
        if (!current(n, owner)) return { status: 'DISCARDED' };
        const next = ids(punks), before = ids(getPunks());
        if (next === before && !unavailable) return { status: 'UNCHANGED' };
        unavailable = false;
        onChanged(punks);
        return { status: 'CHANGED' };
      } catch {
        if (!current(n, owner)) return { status: 'DISCARDED' };
        unavailable = true; onUnavailable();
        return { status: 'UNAVAILABLE' };
      } finally {
        if (pending === request) pending = null;
      }
    },
  };
}
