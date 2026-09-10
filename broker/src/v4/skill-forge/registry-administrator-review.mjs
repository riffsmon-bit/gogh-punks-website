// Review-only selection and fee arithmetic. Nothing here can authorize or send.
import { getAddress } from 'viem';
import { manifestHash } from './capability-resolver.mjs';
import { validateRegistryCanaryProposal } from './registry-canary.mjs';
const FALSE_FLAGS = ['securityReviewComplete', 'feeBudgetApproved', 'deploymentAuthorized', 'configurationAuthorized',
  'productionTrainingAuthorized', 'productionBurnAuthorized', 'walletDelegationChangeAuthorized'];
const uint = value => typeof value === 'string' && /^(0|[1-9]\d{0,30})$/.test(value);
export function validateAdministratorSelection(selection) {
  const keys = ['schemaVersion', 'status', 'chainId', 'collection', 'administrator', 'selectedOn', 'ownerSelectionConfirmed',
    'decisionScope', 'notes', ...FALSE_FLAGS];
  if (!selection || Object.getPrototypeOf(selection) !== Object.prototype || Object.getOwnPropertySymbols(selection).length
    || Object.keys(selection).sort().join(',') !== keys.sort().join(',')
    || Object.values(Object.getOwnPropertyDescriptors(selection)).some(d => d.get || d.set)
    || selection.schemaVersion !== 'GOGH_FORGE_REGISTRY_ADMIN_SELECTION_V1'
    || selection.status !== 'OWNER_SELECTED_SUBJECT_TO_SECURITY_REVIEW' || selection.chainId !== 4663
    || selection.collection !== '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6' || selection.ownerSelectionConfirmed !== true
    || FALSE_FLAGS.some(key => selection[key] !== false)
    || getAddress(selection.administrator) !== selection.administrator
    || /^0x0{40}$/.test(selection.administrator)) throw Error('INVALID_ADMINISTRATOR_SELECTION');
  return { administrator: selection.administrator, selectionHash: manifestHash(selection), ownerSelected: true,
    securityReviewComplete: false, deploymentAuthorized: false };
}
export function buildRegistryFeeReview({ inputs, proposal, selection, observations, observedGasPriceWei }) {
  validateRegistryCanaryProposal(proposal, inputs);
  const selected = validateAdministratorSelection(selection);
  if (selected.administrator !== proposal.guardianProposal || !uint(observedGasPriceWei)
    || BigInt(observedGasPriceWei) <= 0n || BigInt(observedGasPriceWei) > 10_000_000_000n
    || !Array.isArray(observations) || observations.length !== 8) throw Error('INVALID_FEE_REVIEW');
  const maxFee = BigInt(observedGasPriceWei) * 2n;
  const steps = observations.map((o, i) => {
    const expected = proposal.transactions[i];
    if (!o || o.nonce !== expected.nonce || o.dataHash !== manifestHash(expected)
      || !uint(o.localGasEstimate) || !uint(o.parentGasEstimate) || !uint(o.publicCreationGasEstimate)
      || BigInt(o.localGasEstimate) <= 0n || (i === 0) !== (BigInt(o.publicCreationGasEstimate) > 0n)) throw Error('INVALID_FEE_OBSERVATION');
    const composed = BigInt(o.localGasEstimate) + BigInt(o.parentGasEstimate);
    const gasEstimate = composed > BigInt(o.publicCreationGasEstimate) ? composed : BigInt(o.publicCreationGasEstimate);
    // Proposed headroom, never an owner-approved spend limit. All arithmetic is integer wei/gas.
    const gasLimit = (gasEstimate * 3n + 1n) / 2n;
    if (gasLimit > 2_000_000n) throw Error('FEE_REVIEW_GAS_LIMIT_EXCEEDED');
    return { label: expected.label, nonce: expected.nonce, transactionIntentHash: manifestHash(expected),
      localGasEstimate: o.localGasEstimate, parentGasEstimate: o.parentGasEstimate,
      publicCreationGasEstimate: o.publicCreationGasEstimate, composedGasEstimate: String(gasEstimate),
      proposedGasLimit: String(gasLimit), proposedMaxFeePerGasWei: String(maxFee), proposedMaxPriorityFeePerGasWei: '0',
      proposedMaximumFeeWei: String(gasLimit * maxFee) };
  });
  const body = { schemaVersion: 'GOGH_REGISTRY_FEE_REVIEW_V1', status: 'PROPOSED_NOT_AUTHORIZED',
    selectionHash: selected.selectionHash, proposalHash: proposal.proposalHash, administrator: selected.administrator,
    chainId: 4663, expiresAt: proposal.expiresAt, observedGasPriceWei, steps,
    proposedMaximumTotalWei: String(steps.reduce((sum, step) => sum + BigInt(step.proposedMaximumFeeWei), 0n)),
    model: 'LOCAL_SEQUENTIAL_EXECUTION_PLUS_PUBLIC_NITRO_PARENT_GAS_COMPONENT',
    allStepsPubliclySimulated: false, feeBudgetApproved: false, canBroadcast: false,
    productionTrainingAuthorized: false, productionBurnAuthorized: false,
    limitations: ['Anvil does not reproduce all ArbOS execution behavior.', 'Parent-data gas is a live estimate and may change.',
      'Re-estimate every public transaction against its actual preceding confirmed state before signing.',
      'The numeric ceiling only bounds the eight exact transactions with these gas and fee caps; no retries or replacements are authorized.'] };
  return { ...body, reviewHash: manifestHash(body) };
}
export function validateRegistryFeeReview({ inputs, proposal, selection, feeReview }) {
  if (!feeReview || !Array.isArray(feeReview.steps)) throw Error('INVALID_FEE_REVIEW');
  const expected = buildRegistryFeeReview({ inputs, proposal, selection,
    observedGasPriceWei: feeReview.observedGasPriceWei, observations: feeReview.steps.map(step => ({
      nonce: step.nonce, dataHash: step.transactionIntentHash, localGasEstimate: step.localGasEstimate,
      parentGasEstimate: step.parentGasEstimate, publicCreationGasEstimate: step.publicCreationGasEstimate })) });
  if (manifestHash(expected) !== manifestHash(feeReview)) throw Error('FEE_REVIEW_MISMATCH');
  return expected;
}
export function assertRegistryTransactionFeeLimits(transaction, step) {
  if (transaction.type !== 'eip1559' || transaction.authorizationList?.length || transaction.value !== 0n
    || typeof transaction.gas !== 'bigint' || transaction.gas <= 0n || transaction.gas > BigInt(step.proposedGasLimit)
    || typeof transaction.maxFeePerGas !== 'bigint' || transaction.maxFeePerGas <= 0n
    || transaction.maxFeePerGas > BigInt(step.proposedMaxFeePerGasWei) || transaction.maxPriorityFeePerGas !== 0n) {
    throw Error('REGISTRY_TRANSACTION_FEE_LIMIT_EXCEEDED');
  }
  // Identity and canonical receipt checks remain mandatory in verifyRegistryCanary.
  return true;
}
