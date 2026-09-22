import { readHolderSource } from './holder-source.mjs';
import { readHolderCreditEvidence } from './holder-credit-evidence.mjs';
import { HOLDER_BURN_READINESS, HOLDER_BURN_RELEASE } from './holder-release.mjs';
import { HOLDER_OBLIGATION_CHECKS } from './holder-obligations.mjs';

// Public inspection never starts an expensive genesis backfill. A prior owned-
// Punk projection, mint/deploy block, or gallery response is not a complete
// inventory. Approval and burn endpoints remain unavailable. The staged durable
// coordinator can replace this only after all release gates pass.
export function createHolderInspection({ clients, selection, readSource = readHolderSource,
  readCredits = readHolderCreditEvidence, now = Date.now, readObligations }) {
  const unavailable = async () => { throw Error('HOLDER_BURN_NOT_RELEASED'); };
  return {
    get: async () => ({ record: null, availability: HOLDER_BURN_READINESS }),
    async check() {
      const source = await readSource({ clients, selection, now });
      let training;
      try { training = await readCredits({ clients, release: HOLDER_BURN_RELEASE, source, now }); }
      catch { training = { status: 'UNKNOWN', clear: false, burnCredits: null, purchasedCredits: null }; }
      const obligations = readObligations ? await readObligations(source) : {
        schema: 'GOGH_HOLDER_BURN_OBLIGATIONS_V1', sourceTokenId: selection.sourceTokenId,
        anchor: source.anchor, complete: false, clear: false,
        checks: HOLDER_OBLIGATION_CHECKS.map(name => ({ name, status: 'UNKNOWN', count: null,
          remediation: 'This attached activity has not been completely verified. Sacrifice remains unavailable.' })),
      };
      const blockers = ['HOLDER_BURN_NOT_RELEASED', 'HOLDER_INVENTORY_UNKNOWN', 'HOLDER_HISTORY_INCOMPLETE'];
      if (training.status !== 'VERIFIED') blockers.push('HOLDER_CREDITS_UNKNOWN');
      else if (!training.clear) blockers.push('HOLDER_CREDITS_REMAIN');
      if (!obligations.complete || !obligations.clear) blockers.push('HOLDER_OBLIGATIONS_UNRESOLVED');
      if (source.wallets.some(w => [w.nativeWei, w.wethWei, w.entryPointDepositWei].some(v => BigInt(v) !== 0n))) blockers.push('HOLDER_ASSETS_PRESENT');
      if (source.wallets.some(w => w.sessionActive)) blockers.push('HOLDER_AUTOMATION_ACTIVE');
      if (source.wallets.some(w => w.pendingTransaction)) blockers.push('HOLDER_TRANSACTION_PENDING');
      return { schema: 'GOGH_HOLDER_BURN_CHECK_V1', selection, checkedAt: now(), ...source, training, obligations,
        inventory: { complete: false, empty: false, assets: [], nonstandardAssets: 'OWNER_REVIEW_REQUIRED' },
        history: { status: 'NOT_INDEXED', complete: false, progressPercent: null, automaticBackfill: false },
        blockers, canBurn: false, confirmationText: `BURN ${selection.sourceTokenId}`, expectedCreditGain: '1',
        limitations: 'ETH, WETH, gas deposits and Training Credits are inspected. NFT and other-token inventory is not yet complete. Assets can arrive while a wallet confirmation is pending; the deployed burn contract does not protect those deposits.' };
    },
    prepare: unavailable, claim: unavailable, cancel: unavailable, recover: unavailable,
  };
}
