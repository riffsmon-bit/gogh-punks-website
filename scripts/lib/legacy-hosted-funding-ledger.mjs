import { createHash } from "node:crypto";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;

function wei(value, label, { positive = false } = {}) {
  const text = String(value ?? "");
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(text) || (positive && text === "0")) {
    throw new TypeError(`${label} is invalid`);
  }
  return BigInt(text);
}

function address(value, label, nullable = false) {
  if (nullable && value == null) return null;
  const normalized = String(value ?? "").toLowerCase();
  if (!ADDRESS.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function hash(value, label) {
  const normalized = String(value ?? "").toLowerCase();
  if (!HASH.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function tokenId(value) {
  const normalized = String(value ?? "");
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(normalized)) {
    throw new TypeError("Punk token ID is invalid");
  }
  return normalized;
}

function iso(value, label) {
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new TypeError(`${label} is invalid`);
  return result.toISOString();
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0n);
}

function deterministicId(prefix, values) {
  return `${prefix}:${createHash("sha256").update(values.join("|")).digest("hex")}`;
}

function verifiedDeposit(row, evidence) {
  return evidence?.status === "CONFIRMED"
    && evidence.transactionHash === row.transactionHash
    && evidence.from === row.ownerAddress
    && evidence.to === row.agentAddress
    && evidence.valueWei === row.amountWei
    && evidence.input === "0x";
}

function normalizeSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("ledger snapshot is invalid");
  }
  const deposits = (input.deposits ?? []).map((row) => Object.freeze({
    transactionHash: hash(row.transactionHash ?? row.transaction_hash, "deposit transaction hash"),
    punkTokenId: tokenId(row.punkTokenId ?? row.punk_token_id),
    ownerAddress: address(row.ownerAddress ?? row.owner_address, "deposit owner"),
    agentAddress: address(row.agentAddress ?? row.agent_address, "deposit agent"),
    amountWei: wei(row.amountWei ?? row.amount_wei, "deposit amount", { positive: true }).toString(),
    confirmedAt: iso(row.confirmedAt ?? row.confirmed_at, "deposit confirmation"),
  }));
  const accounts = (input.accounts ?? []).map((row) => Object.freeze({
    punkTokenId: tokenId(row.punkTokenId ?? row.punk_token_id),
    ownerSnapshot: address(row.ownerSnapshot ?? row.owner_snapshot, "account owner"),
    creditedWei: wei(row.creditedWei ?? row.credited_wei, "credited amount").toString(),
    spentWei: wei(row.spentWei ?? row.spent_wei, "spent amount").toString(),
  }));
  const usage = (input.usage ?? []).map((row) => Object.freeze({
    transactionHash: hash(row.transactionHash ?? row.transaction_hash, "usage transaction hash"),
    punkTokenId: tokenId(row.punkTokenId ?? row.punk_token_id),
    actualCostWei: wei(row.actualCostWei ?? row.actual_cost_wei, "actual gas cost").toString(),
    chargedWei: wei(row.chargedWei ?? row.charged_wei, "charged gas cost").toString(),
  }));
  const refunds = (input.refunds ?? []).map((row) => Object.freeze({
    punkTokenId: tokenId(row.punkTokenId ?? row.punk_token_id),
    requestedWei: wei(row.requestedWei ?? row.requested_wei, "refund amount").toString(),
    state: String(row.state ?? ""),
    transactionHash: row.transactionHash ?? row.transaction_hash ?? null,
  }));
  const currentOwners = Object.fromEntries(Object.entries(input.currentOwners ?? {})
    .map(([key, value]) => [tokenId(key), address(value, "current Punk owner")]));
  const punkWallets = Object.fromEntries(Object.entries(input.punkWallets ?? {})
    .map(([key, value]) => [tokenId(key), address(value, "Punk Wallet")]));
  const depositEvidence = Object.fromEntries(Object.entries(input.depositEvidence ?? {})
    .map(([key, value]) => [hash(key, "deposit evidence key"), Object.freeze({
      status: String(value?.status ?? ""),
      transactionHash: hash(value?.transactionHash ?? key, "deposit evidence hash"),
      from: address(value?.from, "deposit evidence sender"),
      to: address(value?.to, "deposit evidence recipient"),
      valueWei: wei(value?.valueWei, "deposit evidence value").toString(),
      input: String(value?.input ?? "").toLowerCase(),
      blockNumber: String(value?.blockNumber ?? ""),
    })]));
  const usageEvidence = Object.fromEntries(Object.entries(input.usageEvidence ?? {})
    .map(([key, value]) => [hash(key, "usage evidence key"), Object.freeze({
      status: String(value?.status ?? ""),
      transactionHash: hash(value?.transactionHash ?? key, "usage evidence hash"),
      valueWei: wei(value?.valueWei ?? "0", "usage transaction value").toString(),
      gasCostWei: wei(value?.gasCostWei, "usage receipt gas cost").toString(),
    })]));
  const hostedWallets = (input.hostedWallets ?? []).map((row) => Object.freeze({
    laneId: Number(row.laneId ?? row.lane_id),
    address: address(row.address, "hosted wallet"),
    balanceWei: wei(row.balanceWei ?? row.balance_wei, "hosted balance").toString(),
  }));
  if (hostedWallets.some(({ laneId }) => !Number.isInteger(laneId) || laneId < 1 || laneId > 6)) {
    throw new TypeError("hosted lane ID is invalid");
  }
  for (const [label, values] of [
    ["deposit transaction", deposits.map(({ transactionHash }) => transactionHash)],
    ["usage transaction", usage.map(({ transactionHash }) => transactionHash)],
    ["gas account", accounts.map(({ punkTokenId: value }) => value)],
    ["hosted lane", hostedWallets.map(({ laneId }) => String(laneId))],
  ]) {
    if (new Set(values).size !== values.length) throw new TypeError(`${label} is duplicated`);
  }
  return Object.freeze({ deposits, accounts, usage, refunds, currentOwners, punkWallets,
    depositEvidence, usageEvidence, hostedWallets,
    snapshotBlock: String(input.snapshotBlock ?? "UNPINNED"),
    hostedHistoryComplete: input.hostedHistoryComplete === true });
}

export function buildLegacyHostedFundingLedger(input, options = {}) {
  const snapshot = normalizeSnapshot(input);
  const generatedAt = iso(options.generatedAt ?? new Date(), "ledger generation time");
  const depositsByPunk = new Map();
  for (const row of snapshot.deposits) {
    const values = depositsByPunk.get(row.punkTokenId) ?? [];
    values.push(row);
    depositsByPunk.set(row.punkTokenId, values);
  }
  const usageByPunk = new Map();
  for (const row of snapshot.usage) {
    const values = usageByPunk.get(row.punkTokenId) ?? [];
    values.push(row);
    usageByPunk.set(row.punkTokenId, values);
  }
  const refundsByPunk = new Map();
  for (const row of snapshot.refunds.filter(({ state }) => state === "CONFIRMED")) {
    const values = refundsByPunk.get(row.punkTokenId) ?? [];
    values.push(row);
    refundsByPunk.set(row.punkTokenId, values);
  }

  const entries = snapshot.accounts.map((account) => {
    const deposits = depositsByPunk.get(account.punkTokenId) ?? [];
    const usage = usageByPunk.get(account.punkTokenId) ?? [];
    const refunds = refundsByPunk.get(account.punkTokenId) ?? [];
    const credited = wei(account.creditedWei, "credited amount");
    const charged = wei(account.spentWei, "spent amount");
    const refunded = sum(refunds.map(({ requestedWei }) => wei(requestedWei, "refund amount")));
    if (charged + refunded > credited) throw new TypeError("user balance is over-settled");
    const remaining = credited - charged - refunded;
    const currentOwner = snapshot.currentOwners[account.punkTokenId] ?? null;
    const punkWallet = snapshot.punkWallets[account.punkTokenId] ?? null;
    const depositProofs = deposits.map((deposit) => ({
      transactionHash: deposit.transactionHash,
      verified: verifiedDeposit(deposit, snapshot.depositEvidence[deposit.transactionHash]),
    }));
    const usageProofs = usage.map((record) => {
      const evidence = snapshot.usageEvidence[record.transactionHash];
      return {
        transactionHash: record.transactionHash,
        verified: evidence?.status === "CONFIRMED"
          && evidence.gasCostWei === record.actualCostWei,
        mintValueWei: evidence?.valueWei ?? null,
      };
    });
    const ownershipVerified = currentOwner !== null;
    const punkWalletVerified = punkWallet !== null;
    const depositsVerified = deposits.length > 0 && depositProofs.every(({ verified }) => verified);
    const usageVerified = usageProofs.every(({ verified }) => verified);
    const accountingMatchesDeposits = sum(deposits.map(({ amountWei }) =>
      wei(amountWei, "deposit amount"))) === credited;
    const evidenceComplete = ownershipVerified && punkWalletVerified && depositsVerified
      && usageVerified && accountingMatchesDeposits;
    const classification = evidenceComplete ? "USER_REFUNDABLE"
      : "AMBIGUOUS_REQUIRES_REVIEW";
    const ownerWallet = currentOwner ?? account.ownerSnapshot;
    const mintValueSpent = sum(usageProofs.map(({ mintValueWei }) =>
      mintValueWei === null ? 0n : wei(mintValueWei, "mint value")));
    return Object.freeze({
      ownerWallet,
      ownerSnapshot: account.ownerSnapshot,
      punkTokenId: account.punkTokenId,
      punkWallet,
      fundingSource: "USER_HOSTED_AGENT_DEPOSIT",
      depositTxHashes: deposits.map(({ transactionHash }) => transactionHash),
      depositAmountWei: sum(deposits.map(({ amountWei }) =>
        wei(amountWei, "deposit amount"))).toString(),
      depositTimestamp: deposits.length === 0 ? null : deposits[0].confirmedAt,
      recordedCreditWei: credited.toString(),
      gasSpentWei: sum(usage.map(({ actualCostWei }) =>
        wei(actualCostWei, "gas amount"))).toString(),
      mintValueSpentWei: mintValueSpent.toString(),
      priorityFeesSpentWei: charged.toString(),
      refundsAlreadyIssuedWei: refunded.toString(),
      remainingUserBalanceWei: remaining.toString(),
      projectSubsidyWei: "0",
      classification,
      migrationEligible: evidenceComplete && punkWallet !== null && remaining > 0n,
      refundEligible: evidenceComplete && remaining > 0n,
      evidence: Object.freeze({ depositProofs, usageProofs, ownershipVerified,
        punkWalletVerified, accountingMatchesDeposits }),
      confidence: evidenceComplete ? "VERIFIED" : "REQUIRES_REVIEW",
    });
  });

  const totalHistoricalInflows = sum(snapshot.deposits.map(({ amountWei }) =>
    wei(amountWei, "deposit amount")));
  const totalConfirmedGasSpend = sum(snapshot.usage.map(({ actualCostWei }) =>
    wei(actualCostWei, "gas amount")));
  const totalConfirmedMintValueSpend = sum(Object.values(snapshot.usageEvidence).map(({ valueWei }) =>
    wei(valueWei, "mint value")));
  const totalRefunds = sum(snapshot.refunds.filter(({ state }) => state === "CONFIRMED")
    .map(({ requestedWei }) => wei(requestedWei, "refund amount")));
  const expectedUserBalance = sum(entries.map(({ remainingUserBalanceWei }) =>
    wei(remainingUserBalanceWei, "remaining user balance")));
  const actualHostedBalance = sum(snapshot.hostedWallets.map(({ balanceWei }) =>
    wei(balanceWei, "hosted wallet balance")));
  const ambiguousEntryBalance = sum(entries.filter(({ classification }) =>
    classification === "AMBIGUOUS_REQUIRES_REVIEW").map(({ remainingUserBalanceWei }) =>
    wei(remainingUserBalanceWei, "ambiguous amount")));
  const verifiedUserBalance = expectedUserBalance - ambiguousEntryBalance;
  const coverageDifference = actualHostedBalance - expectedUserBalance;

  const manifests = entries.filter(({ remainingUserBalanceWei }) =>
    wei(remainingUserBalanceWei, "remaining amount") > 0n).map((entry) => {
    const seed = ["4663", entry.ownerWallet, entry.punkTokenId,
      entry.remainingUserBalanceWei, snapshot.snapshotBlock];
    const idempotencyKey = deterministicId("legacy-balance", seed);
    return Object.freeze({
      idempotencyKey,
      status: "DRY_RUN_ONLY",
      broadcastAuthorized: false,
      ownerWallet: entry.ownerWallet,
      punkTokenId: entry.punkTokenId,
      amountWei: entry.remainingUserBalanceWei,
      reason: "LEGACY_HOSTED_BALANCE",
      sourceTransactions: entry.depositTxHashes,
      options: Object.freeze([
        Object.freeze({ type: "REFUND_TO_OWNER", destination: entry.ownerWallet }),
        Object.freeze({ type: "FUND_PUNK_WALLET", destination: entry.punkWallet,
          available: entry.migrationEligible }),
      ]),
      selectedOption: null,
    });
  });

  const accountingEquation = totalHistoricalInflows - totalConfirmedGasSpend
    - totalConfirmedMintValueSpend - totalRefunds;
  const finalSweepReady = snapshot.hostedHistoryComplete && expectedUserBalance === 0n
    && ambiguousEntryBalance === 0n && coverageDifference >= 0n;
  return Object.freeze({
    schema: "GOGH_LEGACY_HOSTED_FUNDING_LEDGER_V1",
    version: 1,
    generatedAt,
    chainId: 4663,
    snapshotBlock: snapshot.snapshotBlock,
    dryRun: true,
    broadcastAuthorized: false,
    hostedHistoryComplete: snapshot.hostedHistoryComplete,
    finalSweepReady,
    entries: Object.freeze(entries),
    manifests: Object.freeze(manifests),
    hostedWallets: Object.freeze(snapshot.hostedWallets),
    totals: Object.freeze({
      totalHistoricalInflowsWei: totalHistoricalInflows.toString(),
      totalConfirmedGasSpendWei: totalConfirmedGasSpend.toString(),
      totalConfirmedMintValueSpendWei: totalConfirmedMintValueSpend.toString(),
      totalRefundsAlreadyIssuedWei: totalRefunds.toString(),
      totalOtherProvenOutflowsWei: "0",
      expectedRemainingBalanceWei: accountingEquation.toString(),
      recordedUserLiabilityWei: expectedUserBalance.toString(),
      actualOnchainHostedWalletBalanceWei: actualHostedBalance.toString(),
      coverageDifferenceWei: coverageDifference.toString(),
      totalUserRefundableWei: verifiedUserBalance.toString(),
      totalUserMigratableWei: verifiedUserBalance.toString(),
      userChoicesAreMutuallyExclusive: true,
      totalProjectOwnedWei: "0",
      totalAmbiguousWei: ambiguousEntryBalance.toString(),
    }),
    assertions: Object.freeze({
      depositsEqualCredits: totalHistoricalInflows === sum(snapshot.accounts.map(({ creditedWei }) =>
        wei(creditedWei, "credited amount"))),
      chargedEqualsRecordedPriorityGas: sum(snapshot.accounts.map(({ spentWei }) =>
        wei(spentWei, "spent amount"))) === sum(snapshot.usage.map(({ chargedWei }) =>
        wei(chargedWei, "charged gas"))),
      expectedBalanceEqualsActual: accountingEquation === actualHostedBalance,
      userLiabilitiesCovered: actualHostedBalance >= expectedUserBalance,
      noBroadcastCapability: true,
    }),
  });
}
