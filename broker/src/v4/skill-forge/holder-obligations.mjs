export const HOLDER_OBLIGATION_CHECKS = Object.freeze([
  'AUTOMATION', 'MISSIONS', 'TRANSACTIONS', 'PURCHASES', 'BIDS', 'TRAINING', 'REFUNDS', 'LEGACY',
]);
const valid = (v, code) => { if (!v) throw Error(code); };

export function validateHolderObligations(evidence, source) {
  valid(evidence?.schema === 'GOGH_HOLDER_BURN_OBLIGATIONS_V1'
    && evidence.sourceTokenId === source.selection.sourceTokenId && evidence.anchor?.number === source.anchor.number
    && evidence.anchor.hash === source.anchor.hash && evidence.complete === true && evidence.clear === true
    && Array.isArray(evidence.checks) && evidence.checks.length === HOLDER_OBLIGATION_CHECKS.length
    && HOLDER_OBLIGATION_CHECKS.every(name => evidence.checks.filter(c => c.name === name).length === 1)
    && evidence.checks.every(c => c.status === 'CLEAR' && c.count === 0), 'HOLDER_OBLIGATIONS_UNRESOLVED');
  return evidence;
}

// Query descriptors are code-owned and reviewed against the actual database.
// There is deliberately no generic request-supplied table, column or SQL input.
// A missing category, missing table, timeout or invalid count remains UNKNOWN.
export function createHolderObligationReader({ descriptors, pools }) {
  valid(Array.isArray(descriptors) && descriptors.every(d => HOLDER_OBLIGATION_CHECKS.includes(d.name)
    && typeof d.pool === 'string' && typeof d.sql === 'string' && /^\s*SELECT\b/i.test(d.sql)
    && typeof d.parameters === 'function'), 'HOLDER_OBLIGATION_CONFIGURATION_INVALID');
  return async source => {
    const checks = await Promise.all(HOLDER_OBLIGATION_CHECKS.map(async name => {
      const group = descriptors.filter(d => d.name === name);
      const remediation = group[0]?.remediation ?? 'This check is unavailable. Recheck later; burning remains disabled.';
      if (!group.length) return { name, status: 'UNKNOWN', count: null, remediation };
      let count = 0;
      try {
        for (const descriptor of group) {
          const rows = (await pools[descriptor.pool].query(descriptor.sql, descriptor.parameters(source))).rows;
          valid(rows?.length === 1 && /^(0|[1-9][0-9]*)$/.test(String(rows[0].count)), 'HOLDER_OBLIGATION_COUNT_INVALID');
          const n = Number(rows[0].count); valid(Number.isSafeInteger(n) && Number.isSafeInteger(count + n), 'HOLDER_OBLIGATION_COUNT_INVALID');
          count += n;
        }
        return { name, status: count === 0 ? 'CLEAR' : 'BLOCKED', count, remediation };
      } catch { return { name, status: 'UNKNOWN', count: null, remediation }; }
    }));
    return { schema: 'GOGH_HOLDER_BURN_OBLIGATIONS_V1', sourceTokenId: source.selection.sourceTokenId,
      anchor: { number: source.anchor.number, hash: source.anchor.hash }, complete: checks.every(c => c.status !== 'UNKNOWN'),
      clear: checks.every(c => c.status === 'CLEAR'), checks };
  };
}
