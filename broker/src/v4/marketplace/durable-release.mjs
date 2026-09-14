import { marketplaceAssert, marketplaceDigest, marketplaceJson } from './durable-journal.mjs';

// Deliberately no environment flag, guessed deployment, or production ALLOW fixture.
const CURRENT = Object.freeze({ schema: 'GOGH_MARKETPLACE_RELEASE_V1', status: 'BLOCKED', chainId: 4663,
  action: 'BUY_LISTINGS', purchaseGuardDeployment: null,
  blockers: Object.freeze(['PURCHASE_POSTCONDITION_GUARD_NOT_DEPLOYED', 'MARKETPLACE_REVIEWED_SOURCE_NOT_CONFIGURED',
    'MARKETPLACE_SCREENING_NOT_CONFIGURED', 'MARKETPLACE_POLICY_SKILLS_NOT_CONFIGURED', 'MARKETPLACE_JOURNAL_NOT_RELEASED']) });
export const currentMarketplaceRelease = () => structuredClone(CURRENT);
export function validateMarketplaceRelease(release) {
  const value = JSON.parse(marketplaceJson(release));
  marketplaceAssert(value.schema === CURRENT.schema && value.chainId === 4663 && value.action === 'BUY_LISTINGS'
    && ['BLOCKED', 'PAUSED', 'OWNER_ASSIST'].includes(value.status), 'MARKETPLACE_RELEASE_INVALID');
  if (value.status === 'OWNER_ASSIST') {
    const guard = value.purchaseGuardDeployment;
    marketplaceAssert(guard && ['REVIEWED_PRODUCTION', 'OWNED_DISPOSABLE_CHAIN'].includes(guard.environment)
      && /^0x[0-9a-f]{40}$/.test(guard.address) && guard.address !== `0x${'0'.repeat(40)}`
      && /^0x[0-9a-f]{64}$/.test(guard.codeHash)
      && value.evidence && ['selection', 'screening', 'policySkills', 'database'].every(key => /^[0-9a-f]{64}$/.test(value.evidence[key]))
      && Array.isArray(value.blockers) && value.blockers.length === 0, 'MARKETPLACE_RELEASE_EVIDENCE_REQUIRED');
  } else marketplaceAssert(Array.isArray(value.blockers) && value.blockers.length > 0
    && value.blockers.every(code => /^[A-Z][A-Z0-9_]{0,95}$/.test(code)), 'MARKETPLACE_RELEASE_INVALID');
  return value;
}
export const marketplaceReleaseHash = release => marketplaceDigest(marketplaceJson(validateMarketplaceRelease(release)));
