import { createHash } from 'node:crypto';
import { V2_ART_STYLES } from '../collecting-intent.mjs';
import { createCollectionEvidenceV1 } from './collection-evidence-v1.mjs';

const STYLE_TRAITS = new Set(['art style', 'art_style', 'style']);
const normalized = value => value.trim().toUpperCase().replace(/[ -]+/g, '_');

// Deterministic metadata-label matching, not an unevaluated visual/AI classifier.
export function createArtCuratorV1(options) {
  const reader = createCollectionEvidenceV1(options);
  return Object.freeze({
    async classifyCollection({ contract, tokenIds, preferredStyles = [] }) {
      if (!Array.isArray(preferredStyles) || preferredStyles.length > V2_ART_STYLES.length
        || preferredStyles.some(style => !V2_ART_STYLES.includes(style))
        || new Set(preferredStyles).size !== preferredStyles.length) throw Error('INVALID_PREFERRED_STYLES');
      preferredStyles = [...preferredStyles];
      const evidence = await reader.readCollectionSample({ contract, tokenIds });
      const matches = [], totals = new Map();
      for (const token of evidence.tokens) {
        const styleTraits = token.status === 'OBSERVED'
          ? token.declaredTraits.filter(trait => STYLE_TRAITS.has(trait.traitType.trim().toLowerCase())) : [];
        const labels = styleTraits.filter(trait => trait.displayType === null && typeof trait.value === 'string')
          .map(trait => normalized(trait.value));
        // Ambiguous/malformed declarations are unknown, never promoted to confident labels.
        const styles = token.excludedTraits === 0 && styleTraits.length === 1 && labels.length === 1
          && V2_ART_STYLES.includes(labels[0]) ? labels : [];
        for (const style of styles) totals.set(style, (totals.get(style) ?? 0) + 1);
        matches.push({ tokenId: token.tokenId, status: styles.length ? 'DECLARED_STYLE_OBSERVED' : 'UNKNOWN',
          declaredStyles: styles, preferredStyleMatches: styles.filter(style => preferredStyles.includes(style)),
          reason: styles.length ? 'EXACT_RECOGNIZED_METADATA_LABEL' : token.status !== 'OBSERVED'
            ? 'METADATA_UNAVAILABLE' : token.excludedTraits > 0 ? 'MALFORMED_METADATA_TRAITS'
              : styleTraits.length > 1 ? 'AMBIGUOUS_STYLE_DECLARATIONS' : 'NO_RECOGNIZED_STYLE_DECLARATION' });
      }
      const report = { schema: 'GOGH_DECLARED_ART_STYLE_MATCHES_V1', chainId: evidence.chainId,
        contract: evidence.contract, blockNumber: evidence.blockNumber, blockHash: evidence.blockHash,
        contractCodeHash: evidence.contractEvidence.codeHash, metadataHash: evidence.metadataHash,
        coverage: evidence.coverage, source: evidence.source, classificationBasis: 'EXACT_DECLARED_METADATA_STYLE_LABELS',
        visualClassification: 'UNAVAILABLE', confidence: null, preferredStyles: [...preferredStyles],
        preferenceSource: 'CALL_ARGUMENTS_NOT_CONFIRMED_OWNER_POLICY',
        declaredStyleCounts: [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([style, tokenCount]) => ({ style, tokenCount })),
        tokens: matches, recognizedTokenCount: matches.filter(token => token.declaredStyles.length).length,
        unknownTokenCount: matches.filter(token => !token.declaredStyles.length).length,
        walletAuthority: 'NONE', executable: false,
        limitations: ['NO_IMAGE_FETCH_OR_VISUAL_CLASSIFICATION', 'METADATA_DECLARATIONS_CAN_LIE',
          'UNKNOWN_IS_NOT_A_NEGATIVE_STYLE_JUDGMENT', 'NO_AESTHETIC_QUALITY_AUTHENTICITY_OR_VALUE_CLAIM',
          'PREFERENCES_DO_NOT_CHANGE_OWNER_POLICY_OR_AUTHORIZE_ACTIONS'] };
      return { ...report, evidenceHash: createHash('sha256').update(JSON.stringify(report)).digest('hex') };
    },
  });
}
