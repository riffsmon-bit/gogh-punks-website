// Read-only advisory. Future training source MUST independently enforce this on-chain.
export const FORGE_MINIMUM_SUPPLY = 1111n;
const collection = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6';
export function assessSupplyFloor(evidence, { now = Date.now() } = {}) {
  const valid = evidence?.chainId === 4663 && typeof evidence?.collection === 'string' && evidence.collection.toLowerCase() === collection
    && typeof evidence?.totalSupply === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(evidence.totalSupply)
    && BigInt(evidence.totalSupply) < 2n ** 256n
    && /^0x[0-9a-f]{64}$/i.test(evidence?.blockHash ?? '')
    && Number.isSafeInteger(evidence?.checkedAt) && Number.isSafeInteger(now)
    && now >= evidence.checkedAt && now - evidence.checkedAt <= 30_000;
  if (!valid) return { status: 'SUPPLY_UNKNOWN', allowedBySupplyRule: false, minimumSupply: '1111', headroom: null };
  const supply = BigInt(evidence.totalSupply);
  return { status: supply > FORGE_MINIMUM_SUPPLY ? 'SUPPLY_RULE_PASSED' : 'SUPPLY_FLOOR_REACHED',
    allowedBySupplyRule: supply > FORGE_MINIMUM_SUPPLY, minimumSupply: '1111',
    headroom: String(supply > FORGE_MINIMUM_SUPPLY ? supply - FORGE_MINIMUM_SUPPLY : 0n) };
}
