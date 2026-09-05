import { keccak256Hex } from "./keccak256.js";

export const PEPEMFERS_PLAN = Object.freeze({
  chainId: 4663,
  chainHex: "0x1237",
  owner: "0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6",
  punkCollection: "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6",
  collection: "0xd995aa6ae9d1ea858cc9ee4948c81c17c89273f5",
  collectionRuntimeCodeHash:
    "0xe3e252831cdd0c11e1327d04a57ddd9bfa11ef49d50edb524040d98bfb228bc4",
  seaDrop: "0x00005ea00ac477b1030ce78506496e8c2de24bf5",
  seaDropRuntimeCodeHash:
    "0x53e4b9339cf624803c9a7d0195576cca5b917920813508d86b3eb93dcbabeb5c",
  feeRecipient: "0x0000a26b00c1f0df003000390027140000faa719",
  accountRegistry: "0x7d4f654cd95104dc22c64fc8c70937f32fcbac52",
  accountRegistryRuntimeCodeHash:
    "0x6aa5390e63f46d3712dad94040d41b8051d8d6c273c7bfb28ac7308bae63c645",
  accountImplementation: "0xb24199845ca42966e755b2dad7c8a9a490afeb13",
  accountImplementationRuntimeCodeHash:
    "0x63b26b5f3bce8b3adb52d1c1d9c9067c9c24cc63e5c961a6d9e399dbf4396520",
  publicStart: 1_788_717_600,
  publicEnd: 1_788_721_200,
  maxSupply: 2_450n,
  feeBps: 1_000n,
  batchSize: 10,
  maxGasBudgetWei: 8_000_000_000_000_000n,
  gasReserveBps: 2_000n,
  tokenIds: Object.freeze([
    "93", "94", "95", "96", "97", "1563", "1614", "1615", "1616", "1617",
    "1618", "1620", "1621", "1622", "1623", "1624", "1625", "1626", "1627",
    "1628", "1629", "1630", "1631", "1632", "1633", "1634", "1635", "1636",
    "1637", "1640", "1641", "1642", "1644", "1646", "1647", "1648", "1649",
    "1650", "1651", "1652", "1653", "1656", "1658", "1659", "1660", "1662",
    "1663", "1664", "1665", "1666", "1670", "1671", "1672", "1673", "1674",
    "1675", "1677", "1678", "1679", "1680", "1681", "1682", "1684", "1685",
    "1686", "1688", "1689", "1690", "1691", "1692", "1693", "1694", "1695",
    "1696", "1697", "1698", "1699", "1700", "1702", "1703", "1704", "1705",
    "1706", "1707", "1709", "1710", "1711", "1712", "1713", "1717", "1720",
    "1721", "1723", "1724", "1726", "1728", "1730", "1733", "1739", "1743",
    "1744", "1745", "1750", "1751", "1753", "1754", "1755", "1757", "1758",
    "1760", "1763", "1764", "1769", "1771", "1772", "1773", "1774", "1779",
    "1780", "1783", "1785", "1786", "1788", "1790", "1792", "1793", "1797",
    "4184",
  ]),
});

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SELECTORS = Object.freeze({
  ownerOf: "0x6352211e",
  account: "0x2dd7c658",
  createAccount: "0xcab13915",
  getPublicDrop: "0xbc6a629c",
  getMintStats: "0x840e15d4",
  mintPublic: "0x161ac21f",
  execute: "0x51945447",
});
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;

export class PepemfersMintError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PepemfersMintError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PepemfersMintError(code, message);
}

function address(value, label) {
  if (!ADDRESS.test(value ?? "")) fail("INVALID_ADDRESS", `${label} is invalid`);
  return value.toLowerCase();
}

function word(value) {
  const parsed = BigInt(value);
  if (parsed < 0n || parsed >= 2n ** 256n) fail("INVALID_UINT", "integer is out of range");
  return parsed.toString(16).padStart(64, "0");
}

function addressWord(value, label) {
  return address(value, label).slice(2).padStart(64, "0");
}

function callData(selector, words) {
  return `${selector}${words.join("")}`;
}

function decodeWords(value, minimum, label) {
  if (!HEX.test(value ?? "") || value.length < 2 + minimum * 64) {
    fail("RPC_MALFORMED", `${label} returned malformed data`);
  }
  return Array.from({ length: minimum }, (_, index) => (
    BigInt(`0x${value.slice(2 + index * 64, 2 + (index + 1) * 64)}`)
  ));
}

function decodeAddress(value, label) {
  const [raw] = decodeWords(value, 1, label);
  if (raw >= 2n ** 160n) fail("RPC_MALFORMED", `${label} returned a noncanonical address`);
  return `0x${raw.toString(16).padStart(40, "0")}`;
}

async function rpc(provider, method, params = []) {
  if (!provider?.request) fail("WALLET_UNAVAILABLE", "connect the owner wallet first");
  return provider.request({ method, params });
}

async function call(provider, to, data, from) {
  return rpc(provider, "eth_call", [{ to, data, ...(from ? { from } : {}) }, "latest"]);
}

async function mapConcurrent(values, limit, operation) {
  const output = new Array(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      output[index] = await operation(values[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

export function encodeOwnerOf(tokenId) {
  return callData(SELECTORS.ownerOf, [word(tokenId)]);
}

export function encodeAccount(tokenId) {
  return callData(SELECTORS.account, [word(tokenId)]);
}

export function encodeCreateAccount(tokenId) {
  return callData(SELECTORS.createAccount, [word(tokenId)]);
}

export function encodeGetPublicDrop(collection = PEPEMFERS_PLAN.collection) {
  return callData(SELECTORS.getPublicDrop, [addressWord(collection, "collection")]);
}

export function encodeGetMintStats(minter) {
  return callData(SELECTORS.getMintStats, [addressWord(minter, "minter")]);
}

export function encodeMintPublic() {
  return callData(SELECTORS.mintPublic, [
    addressWord(PEPEMFERS_PLAN.collection, "collection"),
    addressWord(PEPEMFERS_PLAN.feeRecipient, "fee recipient"),
    addressWord(ZERO_ADDRESS, "zero recipient"),
    word(1),
  ]);
}

export function encodePunkExecuteMint() {
  const inner = encodeMintPublic();
  const innerBytes = (inner.length - 2) / 2;
  const innerHex = inner.slice(2);
  const padded = innerHex.padEnd(Math.ceil(innerHex.length / 64) * 64, "0");
  return callData(SELECTORS.execute, [
    addressWord(PEPEMFERS_PLAN.seaDrop, "SeaDrop"),
    word(0),
    word(128),
    word(0),
    word(innerBytes),
    padded,
  ]);
}

export function parsePublicDrop(value) {
  const [mintPrice, startTime, endTime, maxPerWallet, feeBps, restricted] =
    decodeWords(value, 6, "public drop");
  return Object.freeze({ mintPrice, startTime, endTime, maxPerWallet, feeBps,
    restrictFeeRecipients: restricted === 1n });
}

export function parseMintStats(value) {
  const [minterNumMinted, currentTotalSupply, maxSupply] = decodeWords(value, 3, "mint stats");
  return Object.freeze({ minterNumMinted, currentTotalSupply, maxSupply });
}

export function validatePublicDrop(drop, nowSeconds = Math.floor(Date.now() / 1_000),
  { requireOpen = false } = {}) {
  if (drop.mintPrice !== 0n || drop.startTime !== BigInt(PEPEMFERS_PLAN.publicStart)
    || drop.endTime !== BigInt(PEPEMFERS_PLAN.publicEnd) || drop.maxPerWallet !== 1n
    || drop.feeBps !== PEPEMFERS_PLAN.feeBps || drop.restrictFeeRecipients !== true) {
    fail("DROP_CONFIG_CHANGED", "PEPEMFERS public mint configuration changed; minting is blocked");
  }
  if (requireOpen && (BigInt(nowSeconds) < drop.startTime || BigInt(nowSeconds) >= drop.endTime)) {
    fail("MINT_NOT_OPEN", "the verified PEPEMFERS public mint window is not open");
  }
  return drop;
}

export function validateOwnerRoster(payload) {
  const tokens = payload?.candidateTokenIds;
  if (payload?.ok !== true || payload.chainId !== PEPEMFERS_PLAN.chainId
    || address(payload.owner, "roster owner") !== PEPEMFERS_PLAN.owner
    || address(payload.collection, "roster collection") !== PEPEMFERS_PLAN.punkCollection
    || payload.complete !== true || payload.candidateSources?.liveOwnerComplete !== true
    || payload.candidateSources?.liveMulticall !== true || !Array.isArray(tokens)
    || payload.balanceOf !== PEPEMFERS_PLAN.tokenIds.length
    || tokens.length !== PEPEMFERS_PLAN.tokenIds.length
    || tokens.some((token, index) => String(token) !== PEPEMFERS_PLAN.tokenIds[index])) {
    fail("ROSTER_CHANGED", "the live owner-wallet Punk roster no longer matches the 128-Punk plan");
  }
  return Object.freeze([...tokens].map(String));
}

async function verifyRuntime(provider, target, expectedHash, label) {
  const code = await rpc(provider, "eth_getCode", [target, "latest"]);
  if (!HEX.test(code ?? "") || code === "0x" || keccak256Hex(code) !== expectedHash) {
    fail("CODE_MISMATCH", `${label} runtime no longer matches the reviewed deployment`);
  }
}

function transaction(to, data) {
  return Object.freeze({ from: PEPEMFERS_PLAN.owner, to, value: "0x0", data });
}

export async function inspectPepemfersReadiness(provider, fetchFunction = fetch,
  onProgress = () => {}) {
  const [chainHex, accounts] = await Promise.all([
    rpc(provider, "eth_chainId"),
    rpc(provider, "eth_accounts"),
  ]);
  if (BigInt(chainHex) !== BigInt(PEPEMFERS_PLAN.chainId)) {
    fail("WRONG_CHAIN", "select Robinhood Chain (4663)");
  }
  const selected = Array.isArray(accounts) && accounts[0]
    ? address(accounts[0], "selected wallet") : null;
  if (selected !== PEPEMFERS_PLAN.owner) {
    fail("OWNER_MISMATCH", "connect the pinned Gogh Punks owner wallet");
  }
  onProgress("Loading the complete live owner roster…");
  const response = await fetchFunction(
    `/api/broker/owner-punks?owner=${PEPEMFERS_PLAN.owner}&view=reconcile`,
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) fail("ROSTER_UNAVAILABLE", "the complete live owner roster is unavailable");
  const tokenIds = validateOwnerRoster(payload);

  onProgress("Verifying collection, SeaDrop, and Punk Account runtimes…");
  await Promise.all([
    verifyRuntime(provider, PEPEMFERS_PLAN.collection,
      PEPEMFERS_PLAN.collectionRuntimeCodeHash, "PEPEMFERS collection"),
    verifyRuntime(provider, PEPEMFERS_PLAN.seaDrop,
      PEPEMFERS_PLAN.seaDropRuntimeCodeHash, "SeaDrop"),
    verifyRuntime(provider, PEPEMFERS_PLAN.accountRegistry,
      PEPEMFERS_PLAN.accountRegistryRuntimeCodeHash, "Punk Account registry"),
    verifyRuntime(provider, PEPEMFERS_PLAN.accountImplementation,
      PEPEMFERS_PLAN.accountImplementationRuntimeCodeHash, "Punk Account implementation"),
  ]);
  const drop = validatePublicDrop(parsePublicDrop(await call(
    provider, PEPEMFERS_PLAN.seaDrop, encodeGetPublicDrop(),
  )));

  let completed = 0;
  const accountsByPunk = await mapConcurrent(tokenIds, 6, async (tokenId) => {
    const [ownerRaw, accountRaw] = await Promise.all([
      call(provider, PEPEMFERS_PLAN.punkCollection, encodeOwnerOf(tokenId)),
      call(provider, PEPEMFERS_PLAN.accountRegistry, encodeAccount(tokenId)),
    ]);
    if (decodeAddress(ownerRaw, `Punk #${tokenId} owner`) !== PEPEMFERS_PLAN.owner) {
      fail("OWNER_DRIFT", `Punk #${tokenId} is no longer held by the pinned owner wallet`);
    }
    const punkAccount = decodeAddress(accountRaw, `Punk #${tokenId} account`);
    const code = await rpc(provider, "eth_getCode", [punkAccount, "latest"]);
    if (!HEX.test(code ?? "")) fail("RPC_MALFORMED", `Punk #${tokenId} code is malformed`);
    completed += 1;
    onProgress(`Verified ${completed} of ${tokenIds.length} Punk Wallets…`);
    return Object.freeze({ tokenId, account: punkAccount, activated: code !== "0x" });
  });
  const missing = accountsByPunk.filter(({ activated }) => !activated);
  return Object.freeze({ owner: selected, tokenIds, accounts: Object.freeze(accountsByPunk),
    missing: Object.freeze(missing), drop, rosterBlock: payload.diagnostics?.blockNumber ?? null });
}

export async function prepareActivationTransactions(provider, readiness, onProgress = () => {}) {
  const missing = readiness?.missing;
  if (!Array.isArray(missing)) fail("INVALID_STATE", "refresh readiness first");
  let completed = 0;
  return Object.freeze(await mapConcurrent(missing, 4, async ({ tokenId, account }) => {
    const tx = transaction(PEPEMFERS_PLAN.accountRegistry, encodeCreateAccount(tokenId));
    const [simulation, gas] = await Promise.all([
      rpc(provider, "eth_call", [tx, "latest"]),
      rpc(provider, "eth_estimateGas", [tx]),
    ]);
    if (decodeAddress(simulation, `Punk #${tokenId} activation`) !== account
      || BigInt(gas) <= 0n) fail("ACTIVATION_SIMULATION_FAILED",
      `Punk #${tokenId} activation did not simulate successfully`);
    completed += 1;
    onProgress(`Simulated ${completed} of ${missing.length} account activations…`);
    return tx;
  }));
}

function methodUnavailable(error) {
  return [-32601, -32004, 4200].includes(Number(error?.code))
    || /method.*(?:not found|not supported|unavailable)/i.test(String(error?.message ?? ""));
}

async function receipt(provider, hash, onProgress) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await rpc(provider, "eth_getTransactionReceipt", [hash]);
    if (result) {
      if (BigInt(result.status ?? "0x0") !== 1n) fail("TRANSACTION_FAILED", `${hash} reverted`);
      return result;
    }
    onProgress("Waiting for Robinhood Chain confirmation…");
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  fail("CONFIRMATION_TIMEOUT", `confirmation timed out for ${hash}`);
}

async function callsStatus(provider, callId, onProgress) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await rpc(provider, "wallet_getCallsStatus", [callId]);
    const status = Number(result?.status);
    if (status === 200) return result;
    if ([400, 500, 600].includes(status)) fail("BATCH_FAILED", `wallet batch ${callId} failed`);
    onProgress("Waiting for the wallet batch to confirm…");
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  fail("CONFIRMATION_TIMEOUT", `confirmation timed out for wallet batch ${callId}`);
}

export async function submitOwnerCallPlan(provider, calls, onProgress = () => {}, options = {}) {
  if (!Array.isArray(calls) || calls.length === 0) return Object.freeze([]);
  const maxGasBudgetWei = options.maxGasBudgetWei === undefined
    ? null : BigInt(options.maxGasBudgetWei);
  if (maxGasBudgetWei !== null && maxGasBudgetWei <= 0n) {
    fail("INVALID_BUDGET", "gas budget must be positive");
  }
  for (const call of calls) {
    if (address(call?.from, "call sender") !== PEPEMFERS_PLAN.owner
      || !ADDRESS.test(call?.to ?? "") || call.value !== "0x0" || !HEX.test(call.data ?? "")) {
      fail("INVALID_CALL", "a proposed owner-wallet call is malformed");
    }
  }
  const chunks = [];
  for (let offset = 0; offset < calls.length; offset += PEPEMFERS_PLAN.batchSize) {
    chunks.push(calls.slice(offset, offset + PEPEMFERS_PLAN.batchSize));
  }
  const results = [];
  let batchSupported = true;
  let submittedCalls = 0;
  let reservedGasCost = 0n;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (maxGasBudgetWei !== null) {
      const [gasPriceRaw, gasEstimates] = await Promise.all([
        rpc(provider, "eth_gasPrice"),
        mapConcurrent(chunk, 4, (tx) => rpc(provider, "eth_estimateGas", [tx])),
      ]);
      const gasPrice = BigInt(gasPriceRaw);
      const chunkGas = gasEstimates.reduce((total, value) => total + BigInt(value), 0n);
      const chunkReservedCost = chunkGas * gasPrice
        * (10_000n + PEPEMFERS_PLAN.gasReserveBps) / 10_000n;
      if (reservedGasCost + chunkReservedCost > maxGasBudgetWei) {
        onProgress(`Gas rose above the 0.008 ETH ceiling. Stopped after ${submittedCalls} mints.`);
        break;
      }
      reservedGasCost += chunkReservedCost;
    }
    if (batchSupported) {
      let id;
      try {
        onProgress(`Approve wallet batch ${index + 1} of ${chunks.length} (${chunk.length} calls)…`);
        id = await rpc(provider, "wallet_sendCalls", [{
          version: "2.0.0",
          chainId: PEPEMFERS_PLAN.chainHex,
          from: PEPEMFERS_PLAN.owner,
          calls: chunk.map(({ to, value, data }) => ({ to, value, data })),
        }]);
        if (typeof id !== "string" || id.length === 0) fail("SUBMISSION_UNCONFIRMED",
          "wallet did not return a batch identifier");
      } catch (error) {
        if (!methodUnavailable(error)) throw error;
        batchSupported = false;
        onProgress("Wallet batching is unavailable; using standard owner transactions…");
      }
      if (id) {
        // Once a wallet accepts a batch, never retry its calls through another submission path.
        // A status-polling error must stop, because replaying a mint could create duplicates or
        // turn a confirmed first call into a misleading failure on the second attempt.
        await callsStatus(provider, id, onProgress);
        results.push(Object.freeze({ kind: "wallet_sendCalls", id, count: chunk.length }));
        submittedCalls += chunk.length;
        continue;
      }
    }
    for (const tx of chunk) {
      onProgress(`Approve owner transaction ${submittedCalls + 1} of ${calls.length}…`);
      const hash = await rpc(provider, "eth_sendTransaction", [tx]);
      if (!HASH.test(hash ?? "")) fail("SUBMISSION_UNCONFIRMED",
        "wallet did not return a transaction hash");
      await receipt(provider, hash, onProgress);
      results.push(Object.freeze({ kind: "eth_sendTransaction", hash, count: 1 }));
      submittedCalls += 1;
    }
  }
  return Object.freeze(results);
}

export async function prepareMintTransactions(provider, readiness, nowSeconds, onProgress = () => {}) {
  if (!Array.isArray(readiness?.accounts)) {
    fail("ACCOUNTS_NOT_READY", "check the Punk Wallet roster before preparing the mint");
  }
  const activatedAccounts = readiness.accounts.filter(({ activated }) => activated === true);
  if (activatedAccounts.length === 0) fail("NO_ACTIVATED_ACCOUNTS",
    "no activated Punk Wallets are available for the capped mint");
  const drop = validatePublicDrop(parsePublicDrop(await call(
    provider, PEPEMFERS_PLAN.seaDrop, encodeGetPublicDrop(),
  )), nowSeconds, { requireOpen: true });
  const mintData = encodePunkExecuteMint();
  let completed = 0;
  const prepared = await mapConcurrent(activatedAccounts, 4, async ({ tokenId, account }) => {
    const stats = parseMintStats(await call(
      provider, PEPEMFERS_PLAN.collection, encodeGetMintStats(account),
    ));
    if (stats.maxSupply !== PEPEMFERS_PLAN.maxSupply) {
      fail("SUPPLY_CHANGED", "PEPEMFERS max supply changed; minting is blocked");
    }
    if (stats.currentTotalSupply >= stats.maxSupply) {
      fail("SOLD_OUT", "PEPEMFERS sold out before this batch could be prepared");
    }
    if (stats.minterNumMinted !== 0n) {
      completed += 1;
      onProgress(`Checked ${completed} of ${activatedAccounts.length} activated Punk Wallets…`);
      return Object.freeze({ tokenId, account, alreadyMinted: true, transaction: null, gas: 0n });
    }
    const tx = transaction(account, mintData);
    const [simulation, gas] = await Promise.all([
      rpc(provider, "eth_call", [tx, "latest"]),
      rpc(provider, "eth_estimateGas", [tx]),
    ]);
    if (!HEX.test(simulation ?? "") || BigInt(gas) <= 0n) {
      fail("MINT_SIMULATION_FAILED", `Punk #${tokenId} mint did not simulate successfully`);
    }
    completed += 1;
    onProgress(`Simulated ${completed} of ${activatedAccounts.length} activated Punk Wallet mints…`);
    return Object.freeze({ tokenId, account, alreadyMinted: false,
      transaction: tx, gas: BigInt(gas) });
  });
  const gasPrice = BigInt(await rpc(provider, "eth_gasPrice"));
  let reservedGasCost = 0n;
  const selected = [];
  for (const entry of prepared) {
    if (!entry.transaction) continue;
    const entryCost = entry.gas * gasPrice
      * (10_000n + PEPEMFERS_PLAN.gasReserveBps) / 10_000n;
    if (reservedGasCost + entryCost > PEPEMFERS_PLAN.maxGasBudgetWei) break;
    reservedGasCost += entryCost;
    selected.push(entry);
  }
  if (selected.length === 0 && prepared.some(({ transaction: tx }) => tx)) {
    fail("GAS_BUDGET_TOO_LOW", "live gas is too high for even one mint under the 0.008 ETH ceiling");
  }
  return Object.freeze({ drop, prepared: Object.freeze(prepared),
    calls: Object.freeze(selected.map(({ transaction: tx }) => tx)),
    alreadyMinted: prepared.filter((entry) => entry.alreadyMinted).length,
    skippedInactive: readiness.accounts.length - activatedAccounts.length,
    skippedForBudget: prepared.filter(({ transaction: tx }) => tx).length - selected.length,
    gasPrice, reservedGasCost });
}

function setupPage(windowObject = window, documentObject = document) {
  const status = documentObject.querySelector("[data-pepemfers-status]");
  if (!status) return;
  const prepareButton = documentObject.querySelector("[data-pepemfers-prepare]");
  const mintButton = documentObject.querySelector("[data-pepemfers-mint]");
  const roster = documentObject.querySelector("[data-pepemfers-roster]");
  const countdown = documentObject.querySelector("[data-pepemfers-countdown]");
  const state = { readiness: null, busy: false };
  const setStatus = (message) => { status.textContent = message; };
  const provider = () => windowObject.__GOGH_WALLET_PROVIDER__;

  function render() {
    const activated = state.readiness?.accounts?.filter(({ activated: ready }) => ready).length ?? 0;
    prepareButton.disabled = state.busy;
    mintButton.disabled = state.busy || !state.readiness || activated === 0
      || Date.now() < PEPEMFERS_PLAN.publicStart * 1_000
      || Date.now() >= PEPEMFERS_PLAN.publicEnd * 1_000;
    if (state.readiness) {
      roster.textContent = `${state.readiness.accounts.length} verified · ${activated} already activated`;
    }
  }

  async function refresh() {
    state.busy = true;
    render();
    try {
      state.readiness = await inspectPepemfersReadiness(provider(), (...args) => fetch(...args),
        setStatus);
      const activated = state.readiness.accounts.length - state.readiness.missing.length;
      setStatus(`${activated} already-activated Punk Wallets are eligible for the capped plan. `
        + `${state.readiness.missing.length} inactive wallets will be skipped to avoid activation gas.`);
    } catch (error) {
      state.readiness = null;
      setStatus(`${error.message}. Nothing was submitted.`);
    } finally {
      state.busy = false;
      render();
    }
  }

  prepareButton.addEventListener("click", refresh);
  mintButton.addEventListener("click", async () => {
    state.busy = true;
    render();
    try {
      setStatus("Revalidating the live roster and every immutable contract binding…");
      state.readiness = await inspectPepemfersReadiness(provider(), (...args) => fetch(...args),
        setStatus);
      const plan = await prepareMintTransactions(provider(), state.readiness,
        Math.floor(Date.now() / 1_000), setStatus);
      if (plan.calls.length === 0) {
        setStatus("Every activated Punk Wallet in this capped plan has already minted PEPEMFERS.");
      } else {
        setStatus(`${plan.calls.length} exact free mints fit the 0.008 ETH ceiling with reserve. Opening owner-wallet approvals…`);
        const submitted = await submitOwnerCallPlan(provider(), plan.calls, setStatus,
          { maxGasBudgetWei: PEPEMFERS_PLAN.maxGasBudgetWei });
        const confirmed = submitted.reduce((total, entry) => total + entry.count, 0);
        setStatus(`Submitted and confirmed ${confirmed} Punk Wallet mints within the gas plan. `
          + `${plan.skippedInactive} inactive and ${plan.skippedForBudget} over-budget wallets were skipped.`);
      }
    } catch (error) {
      setStatus(`${error.message}. Remaining calls stopped; no bypass was attempted.`);
    } finally {
      state.busy = false;
      render();
    }
  });

  const tick = () => {
    const now = Date.now();
    const start = PEPEMFERS_PLAN.publicStart * 1_000;
    const end = PEPEMFERS_PLAN.publicEnd * 1_000;
    if (now >= end) countdown.textContent = "Public mint window ended";
    else if (now >= start) countdown.textContent = "PUBLIC MINT OPEN · closes at 3:00 PM EDT";
    else {
      const seconds = Math.max(0, Math.floor((start - now) / 1_000));
      const hours = Math.floor(seconds / 3_600);
      const minutes = Math.floor((seconds % 3_600) / 60);
      const remainder = seconds % 60;
      countdown.textContent = `${hours}h ${String(minutes).padStart(2, "0")}m ${String(remainder).padStart(2, "0")}s until public mint`;
    }
    render();
  };
  tick();
  windowObject.setInterval(tick, 1_000);
  windowObject.addEventListener("gogh:wallet-state", () => {
    state.readiness = null;
    setStatus("Wallet state changed. Run the readiness check again.");
    render();
  });
  render();
}

if (typeof window !== "undefined" && typeof document !== "undefined") setupPage();
