import training from '../../../../deployments/robinhood-forge-training.json' with { type: 'json' };

// This release is deliberately a useful read-only inspection. Changing an env
// flag cannot turn the existing immutable burn contract into an asset guard.
export const HOLDER_BURN_RELEASE = Object.freeze({ ...training, status: 'TESTING',
  productionBurnAuthorized: false, inspectionOnly: true });
export const HOLDER_BURN_READINESS = Object.freeze({
  status: 'TESTING', publicBurnAvailable: false, inspectionAvailable: true,
  blockers: Object.freeze([
    'COMPLETE_STANDARD_ASSET_HISTORY_REQUIRED',
    'PENDING_BURN_ASSET_PROTECTION_REQUIRED',
    'GENERAL_OBLIGATION_JOURNAL_REVIEW_REQUIRED',
  ]),
  message: 'Inspect your Punk’s wallets before choosing a sacrifice. Public burning is unavailable until complete asset history and protection during wallet confirmation are verified.',
});
