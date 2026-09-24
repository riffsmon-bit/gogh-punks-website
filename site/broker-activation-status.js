// Display only: derive a guided setup view from an existing authenticated status
// read. No network requests, wallet calls, or activation authority are created.
const FRESH_MS = 90_000;
const PENDING = ['SIGNED', 'SUBMITTED', 'PENDING_RECEIPT', 'RECONCILIATION_REQUIRED'];
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value)
  && !/^0x0{40}$/i.test(value) ? value.toLowerCase() : null;
const token = value => typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value) ? value : null;
const wei = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value)
  && BigInt(value) < 2n ** 256n ? BigInt(value) : null;
const eth = value => {
  const digits = value.toString().padStart(19, '0');
  const fraction = digits.slice(-18).replace(/0+$/, '');
  return `${digits.slice(0, -18)}${fraction ? `.${fraction}` : ''} ETH`;
};

// Starting a mission is separate from wallet creation and funding. This is a
// fail-closed UI precondition, not a replacement for the worker's live policy.
export function missionFundingReadiness({ owner, chainId, tokenId, account, intent, now = Date.now() } = {}) {
  const currentOwner = address(owner), runtime = account?.runtime;
  const blocked = (action, detail) => ({ ready: false, action, detail });
  if (!currentOwner || chainId !== 4663 || !token(String(tokenId)) || account?.ok !== true || account.error
    || address(account.owner) !== currentOwner || String(account.tokenId) !== String(tokenId)
    || account.chainId !== undefined && account.chainId !== 4663
    || !Number.isFinite(now) || !Number.isFinite(account.receivedAt) || account.receivedAt > now || now - account.receivedAt > FRESH_MS
    || address(intent?.expectedOwner) !== currentOwner || String(intent?.punkTokenId) !== String(tokenId)
    || typeof runtime?.accountCreated !== 'boolean' || typeof runtime.sessionActive !== 'boolean') {
    return blocked('CHECK', 'Check this Punk’s current wallet and gas before starting. Your mission draft is saved.');
  }
  if (!runtime.accountCreated && !runtime.sessionActive) {
    return blocked('SETUP', 'First create this Punk’s Agent wallet in Fund, then add gas. Wallet creation does not start a mission. Your draft is saved.');
  }
  if (!runtime.accountCreated || address(runtime.owner) !== currentOwner || !address(runtime.account)) {
    return blocked('CHECK', 'The Agent wallet or its current owner could not be verified. Recheck before starting.');
  }
  if (runtime.sessionActive) return blocked('STATUS', 'This Punk already has a mission permission. You can add gas without recalling it. To replace its rules, recall it first.');
  const balance = wei(runtime.nativeBalance), reserve = wei(intent.minimumReserveWei);
  if (balance === null || reserve === null) return blocked('CHECK', 'The Agent gas balance or protected reserve could not be verified. Recheck before starting.');
  if (balance <= reserve) return blocked('FUND', `Fund the Agent wallet before starting. It has ${eth(balance)} and your protected reserve is ${eth(reserve)}. Add ETH above that reserve, or review a lower reserve. Your draft is saved.`);
  return { ready: true, action: 'MISSION', detail: 'Agent wallet and gas checked. Review your rules, then choose Start mission. Funding grants no mint permission.' };
}

export function punkActivationStatus({ owner, chainId, tokenId, account, strategy, now = Date.now() } = {}) {
  const steps = [
    { id: 'CHECK', label: 'Check this Punk', status: 'CURRENT', detail: 'Sign in and check its current owner, Agent wallet and permission.', action: 'CHECK' },
    { id: 'SETUP', label: 'Prepare its gas wallet', status: 'PENDING', detail: 'Create the Agent wallet if needed. This one-time wallet confirmation pays a network fee only; it does not start a mission or grant mint permission.', action: 'SETUP' },
    { id: 'FUND', label: 'Fund Agent gas', status: 'PENDING', detail: 'The Agent wallet needs ETH for network fees. Its gas balance is separate from the Punk Wallet.', action: 'FUND' },
    { id: 'MISSION', label: 'Review rules and start mission', status: 'PENDING', detail: 'After funding, review your limits and choose Start mission. Its separate wallet confirmation grants the bounded mint permission.', action: 'MISSION' },
    { id: 'WORKER', label: 'Check automatic minting', status: 'PENDING', detail: 'Verify the worker and its latest check before assuming this Punk is hunting.', action: 'STATUS' },
  ];
  const [check, setup, fund, missionStep, worker] = steps;
  let balances = null;
  const result = (status, label, detail, tone = 'warning') => Object.freeze({ status, label, detail, tone,
    balances: balances && Object.freeze(balances), steps: Object.freeze(steps.map(step => Object.freeze({ ...step }))) });
  const ownerAddress = address(owner), id = token(tokenId), runtime = account?.runtime;
  if (!ownerAddress || chainId !== 4663 || !id || !Number.isFinite(now) || account?.ok !== true || account.error
    || address(account.owner) !== ownerAddress || String(account.tokenId) !== id
    || account.chainId !== undefined && account.chainId !== 4663
    || !Number.isFinite(account.receivedAt) || account.receivedAt > now || now - account.receivedAt > FRESH_MS
    || typeof runtime?.accountCreated !== 'boolean' || typeof runtime.sessionActive !== 'boolean'
    || runtime.accountCreated && address(runtime.owner) !== ownerAddress
    || runtime.owner !== undefined && address(runtime.owner) !== ownerAddress
    || account.readiness?.databaseReady === false) {
    return result('UNKNOWN', 'STATUS NOT VERIFIED', 'Check this Punk’s status. Missing or outdated information does not mean its Agent wallet is inactive.');
  }
  check.status = 'COMPLETE'; check.detail = 'Current ownership and Agent wallet status checked.';
  if (!runtime.accountCreated) {
    if (runtime.sessionActive) {
      check.status = 'BLOCKED'; check.detail = 'Wallet and permission information disagree. Recheck before continuing.';
      return result('UNKNOWN', 'STATUS NOT VERIFIED', check.detail);
    }
    setup.status = 'CURRENT';
    return result('SETUP_REQUIRED', 'GAS WALLET NOT CREATED', 'Start in Fund: create its Agent wallet, then add gas. Review your rules and start the mission only when you are ready.', 'idle');
  }
  if (!address(runtime.account)) {
    check.status = 'BLOCKED'; check.detail = 'The Agent wallet address could not be verified. Check again.';
    return result('UNKNOWN', 'STATUS NOT VERIFIED', check.detail);
  }
  setup.status = 'COMPLETE'; setup.detail = 'This Punk’s Agent wallet exists. It does not need to be created again.';
  const mission = account.mission;
  const missionOwnerMatches = mission?.intent && address(mission.intent.expectedOwner) === ownerAddress
    && String(mission.intent.punkTokenId) === id;
  const missionAccountMatches = address(mission?.account) === address(runtime.account);
  const livePermission = runtime.sessionActive === true;
  const linkedMission = missionOwnerMatches && missionAccountMatches && mission?.status === 'ACTIVE';
  const until = Date.parse(mission?.validUntil), after = Date.parse(mission?.validAfter);
  const missionVerified = livePermission && linkedMission && Number.isFinite(until) && until > now
    && Number.isFinite(after) && after < until;
  if (missionVerified) {
    missionStep.status = 'COMPLETE'; missionStep.detail = 'The current owner’s mission permission is confirmed. Funding may still be needed; do not authorize it again.';
  } else if (livePermission) {
    missionStep.status = 'BLOCKED'; missionStep.action = 'CHECK';
    missionStep.detail = 'A wallet permission exists, but its matching current mission could not be verified. Check status before requesting another.';
  } else {
    missionStep.detail = mission?.intent && !missionOwnerMatches
      ? 'A previous owner’s mission does not grant you active automation. Review and authorize your own mission.'
      : mission?.status === 'COMPLETED' ? 'The last mission completed. Review and authorize a new mission to continue.'
        : 'There is no active mint permission. Review your limits and authorize a mission in your wallet.';
  }
  const native = wei(runtime.nativeBalance), deposit = wei(runtime.entryPointDeposit);
  const saved = strategy?.intent ?? strategy;
  const savedMatches = saved && (saved.expectedOwner === undefined || address(saved.expectedOwner) === ownerAddress)
    && (saved.punkTokenId === undefined || String(saved.punkTokenId) === id);
  const policyReserve = wei(livePermission ? missionOwnerMatches ? mission.intent.minimumReserveWei : null
    : savedMatches ? saved.minimumReserveWei : null);
  const permissionReserve = livePermission ? wei(runtime.session?.minimumNativeReserveWei) : null;
  const reserve = livePermission ? policyReserve !== null && permissionReserve !== null
    ? policyReserve > permissionReserve ? policyReserve : permissionReserve : null : policyReserve;
  if (native !== null && deposit !== null) {
    balances = { nativeBalanceWei: native.toString(), gasDepositWei: deposit.toString(),
      totalGasWei: (native + deposit).toString(), reserveWei: reserve?.toString() ?? null,
      availableNativeWei: reserve === null ? null : (native > reserve ? native - reserve : 0n).toString() };
    fund.detail = `Agent ETH: ${eth(native)}. Prepaid gas: ${eth(deposit)}.${reserve === null ? ' The mission review sets the protected reserve.' : ` Protected Agent ETH: ${eth(reserve)}.`}`;
    fund.status = native + deposit > 0n && (reserve === null || native > reserve) ? 'COMPLETE' : 'CURRENT';
  } else {
    fund.status = 'BLOCKED'; fund.action = 'CHECK';
    fund.detail = 'The Agent gas balance is not verified. Check it before sending funds.';
  }
  if (PENDING.includes(mission?.latestOperation?.state)) {
    worker.status = mission.latestOperation.state === 'RECONCILIATION_REQUIRED' ? 'BLOCKED' : 'CURRENT';
    worker.detail = 'An existing mint is awaiting its result. Check Activity; do not restart or submit another copy.';
    return result('MINT_PENDING', 'MINT RESULT PENDING', worker.detail, 'idle');
  }
  if (livePermission && !missionVerified) return result('PERMISSION_UNVERIFIED', 'CHECK MISSION PERMISSION', missionStep.detail);
  if (native === null || deposit === null) return result('GAS_UNVERIFIED', 'CHECK AGENT GAS', fund.detail);
  if (livePermission && reserve === null) {
    fund.status = 'BLOCKED'; fund.action = 'CHECK'; fund.detail = 'The active mission’s protected reserve could not be verified. Recheck its rules before funding or assuming it can spend.';
    return result('GAS_UNVERIFIED', 'CHECK MISSION RESERVE', fund.detail);
  }
  if (native + deposit === 0n) {
    fund.status = 'CURRENT';
    return result('GAS_REQUIRED', 'NEEDS AGENT GAS', `${missionVerified ? 'Mission permission is already confirmed. Add gas without recalling it; this mission may resume when funded.' : 'Add ETH to its Agent wallet for network fees, then review and start a mission. Funding grants no mint permission.'}`);
  }
  if (reserve !== null && native <= reserve) {
    fund.status = 'CURRENT';
    return result('RESERVE_REACHED', 'RESERVE REACHED', `${fund.detail} The current worker checks Agent ETH above the reserve; prepaid gas alone does not satisfy that check. Add Agent ETH or review different rules.`, 'warning');
  }
  if (native === 0n) {
    fund.status = 'CURRENT';
    return result('NATIVE_GAS_REQUIRED', 'NEEDS AGENT ETH', `${fund.detail} The current worker also checks ETH in the Agent wallet before minting. Add Agent ETH before authorizing a mission.`);
  }
  if (!livePermission) {
    if (account.readiness?.setupAvailable !== true) {
      missionStep.status = 'BLOCKED'; missionStep.action = 'CHECK';
      return result('MISSION_BLOCKED', 'MISSION SETUP UNAVAILABLE', 'Its Agent wallet is funded, but mission setup is unavailable. Check readiness; no new mint permission is active.');
    }
    missionStep.status = 'CURRENT';
    return result('MISSION_REQUIRED', 'AUTHORIZE A MISSION', missionStep.detail, 'idle');
  }
  if (account.worker?.enabled !== true) {
    worker.status = 'BLOCKED'; worker.detail = 'Mission permission exists, but automatic checks are paused or unavailable. Check status; another wallet signature will not restart the worker.';
    return result('WORKER_PAUSED', 'WORKER PAUSED', worker.detail);
  }
  if (account.readiness?.automaticExecutionReady !== true || !Array.isArray(account.readiness?.blockers)
    || account.readiness.blockers.length > 0) {
    worker.status = 'BLOCKED'; worker.detail = 'The worker is not ready for automatic minting. Check readiness for the remaining requirement.';
    return result('NEEDS_ATTENTION', 'CHECK WORKER READINESS', worker.detail);
  }
  if (after > now) {
    worker.status = 'CURRENT'; worker.detail = 'Permission is confirmed. Automatic minting waits for your approved start time.';
    return result('WAITING_FOR_START', 'WAITING FOR START', worker.detail, 'idle');
  }
  const checked = Date.parse(mission.lastCheckedAt), failed = Date.parse(mission.lastFailedAt);
  if (Number.isFinite(failed) && (failed > now || !Number.isFinite(checked) || failed >= checked)) {
    worker.status = 'BLOCKED'; worker.detail = 'The latest worker check failed or could not be verified. Open Activity; hunting is not confirmed.';
    return result('NEEDS_ATTENTION', 'LAST CHECK FAILED', worker.detail);
  }
  if (!mission.lastCheckedAt && now - after <= 180_000) {
    worker.status = 'CURRENT'; worker.detail = 'Setup, gas and permission are checked. Waiting for the worker’s first successful check.';
    return result('WAITING_FOR_FIRST_CHECK', 'WAITING FOR FIRST CHECK', worker.detail, 'idle');
  }
  if (!Number.isFinite(checked) || checked > now || now - checked > 180_000) {
    worker.status = 'BLOCKED'; worker.detail = 'No recent successful worker check is verified. Check Activity before assuming this Punk is hunting.';
    return result('CHECK_OVERDUE', 'CHECK OVERDUE', worker.detail);
  }
  worker.status = 'COMPLETE'; worker.detail = 'A recent successful worker check is verified. Each mint still requires its own policy checks and simulation.';
  return result('ACTIVE', 'LOOKING FOR MINTS', 'The Agent wallet, gas, current-owner permission and recent worker check are verified. Eligible free mints remain subject to all your limits.', 'active');
}
