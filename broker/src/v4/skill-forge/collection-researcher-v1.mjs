import { createHash } from 'node:crypto';
import { createCollectionEvidenceV1 } from './collection-evidence-v1.mjs';

export function createCollectionResearcherV1(options) {
  const reader = createCollectionEvidenceV1(options);
  return Object.freeze({
    async researchCollection(args) {
      const evidence = await reader.readCollectionSample(args), counts = new Map();
      for (const token of evidence.tokens) {
        if (token.status !== 'OBSERVED') continue;
        const present = new Set(token.declaredTraits.map(trait => trait.traitType));
        for (const name of present) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      const report = { schema: 'GOGH_COLLECTION_RESEARCH_V1', ...evidence,
        traitCoverage: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([traitType, observedTokenCount]) => ({
          traitType, observedTokenCount, absentFromObservedTokenCount: evidence.coverage.observedCount - observedTokenCount })),
        limitations: ['CALLER_SELECTED_SAMPLE_NOT_COLLECTION_INVENTORY', 'METADATA_DECLARATIONS_CAN_LIE',
          'EXTERNAL_METADATA_AND_IMAGES_NOT_FETCHED', 'NO_AUTHENTICITY_OR_SECURITY_CLEARANCE',
          'TRAIT_COUNTS_ARE_NOT_RARITY_OR_VALUE'], securityVerdict: 'NOT_A_SECURITY_CLEARANCE' };
      return { ...report, evidenceHash: createHash('sha256').update(JSON.stringify(report)).digest('hex') };
    },
  });
}
