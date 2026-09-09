// Advisory preflight only. NEVER use a browser snapshot as burn authorization.
// Production burns remain locked until complete asset/state safety is established.
export const BURN_WALLET_ROLES = Object.freeze(['V1', 'V2', 'V3', 'AGENT']);
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
const positive = (value) => UINT.test(String(value)) && BigInt(value) > 0n;
const count = (value) => Number.isSafeInteger(value) && value >= 0;

export function assessSacrifice(snapshot, { now = Date.now() } = {}) {
  const reasons = [];
  const add = (code, message, wallet = null) => reasons.push({ code, message, wallet });
  if (!snapshot || typeof snapshot !== 'object') snapshot = {};
  const { owner, burnOwner, trainOwner, punkToBurn, punkToTrain } = snapshot;
  if (![owner, burnOwner, trainOwner].every((x) => ADDRESS.test(x ?? ''))
    || owner.toLowerCase() !== burnOwner.toLowerCase()
    || owner.toLowerCase() !== trainOwner.toLowerCase()) {
    add('OWNERSHIP_UNCONFIRMED', 'The current owner must own both Punks.');
  }
  if (![punkToBurn, punkToTrain].every((x) => UINT.test(String(x)))) {
    add('INVALID_TOKEN', 'Both token IDs must be verified.');
  } else if (String(punkToBurn) === String(punkToTrain)) {
    add('SAME_TOKEN', 'A Punk cannot sacrifice itself for training.');
  }
  if (snapshot.burnTokenExists !== true || snapshot.trainTokenExists !== true) {
    add('TOKEN_UNAVAILABLE', 'Both Punks must still exist.');
  }
  if (!Number.isSafeInteger(snapshot.checkedAt) || !Number.isSafeInteger(now)
    || now < snapshot.checkedAt || now - snapshot.checkedAt > 30_000) {
    add('STALE_CHECK', 'Refresh wallet and ownership checks before continuing.');
  }
  if (snapshot.chainId !== 4663) add('WRONG_CHAIN', 'Verify the Robinhood Chain wallet inventory.');
  for (const field of ['openMissions', 'activeAutomation', 'unsettledTransactions', 'legacyLocks']) {
    if (!count(snapshot[field])) add('STATE_UNKNOWN', `${field} has not been verified.`);
    else if (snapshot[field] > 0) add('UNRESOLVED_STATE', `Resolve ${field} before sacrifice.`);
  }
  const wallets = Array.isArray(snapshot.wallets) ? snapshot.wallets : [];
  for (const role of BURN_WALLET_ROLES) {
    const matching = wallets.filter((wallet) => wallet?.role === role);
    if (matching.length !== 1) {
      add('WALLET_MISSING', `Exactly one verified ${role} wallet inventory is required.`);
      continue;
    }
    const wallet = matching[0];
    if (!ADDRESS.test(wallet.address ?? '') || wallet.checkedAt !== snapshot.checkedAt
      || wallet.blockHash !== snapshot.blockHash || !/^0x[0-9a-f]{64}$/i.test(wallet.blockHash ?? '')) {
      add('WALLET_UNVERIFIED', `${role} wallet identity or snapshot is unverified.`, wallet.address);
    }
    for (const field of ['nativeWei', 'entryPointDepositWei']) {
      if (!UINT.test(String(wallet[field]))) add('BALANCE_UNKNOWN', `${role} ${field} is unknown.`, wallet.address);
      else if (positive(wallet[field])) add('ASSETS_PRESENT', `${role} has ${field}; withdraw it first.`, wallet.address);
    }
    for (const field of ['nftCount', 'erc20AssetCount', 'otherAssetCount']) {
      if (!count(wallet[field])) add('ASSET_COUNT_UNKNOWN', `${role} ${field} is unknown.`, wallet.address);
      else if (wallet[field] > 0) add('ASSETS_PRESENT', `${role} has ${field}; review and withdraw first.`, wallet.address);
    }
    if (wallet.inventoryComplete !== true) {
      add('INVENTORY_INCOMPLETE', `${role} asset inventory is incomplete; zero ETH does not mean empty.`, wallet.address);
    }
  }
  if (wallets.some((wallet) => !BURN_WALLET_ROLES.includes(wallet?.role))) {
    add('UNREVIEWED_WALLET', 'An additional wallet relationship requires review.');
  }
  return Object.freeze({
    status: reasons.length ? 'BLOCKED' : 'CHECKS_PASSED_PRODUCTION_LOCKED',
    canBurn: false,
    productionBurnEnabled: false,
    reasons: Object.freeze(reasons),
    warning: 'Permanent sacrifice destroys the NFT. Wallet assets are NOT transferred and may become inaccessible.',
    confirmationText: UINT.test(String(punkToBurn)) ? `BURN ${punkToBurn}` : null,
    nextAction: reasons.some((r) => r.code === 'ASSETS_PRESENT') ? 'REVIEW_WALLET_AND_WITHDRAW' : 'REVIEW_SAFETY_CHECKS',
  });
}
