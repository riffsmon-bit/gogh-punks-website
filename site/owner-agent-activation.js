const ADDRESS = /^0x[0-9a-f]{40}$/;
const DATA = /^0x[0-9a-f]{8,}$/;

function lowerAddress(value) {
  return typeof value === "string" && ADDRESS.test(value.toLowerCase())
    ? value.toLowerCase() : null;
}

export function validateOwnerSetupArtifact(artifact, expected) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new TypeError("The reviewed activation plan was invalid");
  }
  const tokenId = String(artifact.punk?.tokenId ?? "");
  const owner = lowerAddress(artifact.punk?.expectedOwner);
  const transactions = artifact.setupTransactions;
  if (tokenId !== String(expected.tokenId) || owner !== lowerAddress(expected.owner)
    || !Array.isArray(transactions) || transactions.length < 1 || transactions.length > 3) {
    throw new TypeError("The reviewed activation plan did not match this Punk and owner");
  }
  const validateTransactions = (values, label, minimum, maximum) => {
    if (!Array.isArray(values) || values.length < minimum || values.length > maximum) {
      throw new TypeError(`The reviewed ${label} transaction plan was invalid`);
    }
    for (const transaction of values) {
      if (!transaction || lowerAddress(transaction.from) !== owner
        || !lowerAddress(transaction.to) || !DATA.test(String(transaction.data ?? "").toLowerCase())
        || !["0", "0x0"].includes(String(transaction.value ?? "0"))) {
        throw new TypeError(`The reviewed ${label} transaction was invalid`);
      }
    }
    return Object.freeze(values.map((transaction) => Object.freeze({ ...transaction,
      from: transaction.from.toLowerCase(), to: transaction.to.toLowerCase(),
      data: transaction.data.toLowerCase() })));
  };
  const setupTransactions = validateTransactions(transactions, "activation", 1, 3);
  const stopTransactions = artifact.stopTransactions === undefined
    ? undefined : validateTransactions(artifact.stopTransactions, "stop", 1, 2);
  return Object.freeze({ ...artifact, setupTransactions,
    ...(stopTransactions ? { stopTransactions } : {}) });
}

export async function requestOwnerSetupArtifact(fetchFunction, selection) {
  const params = new URLSearchParams({ tokenId: String(selection.tokenId),
    cap: String(selection.cap), days: String(selection.days) });
  const response = await fetchFunction(`/api/broker/autonomy-v3-owner-setup?${params}`, {
    headers: { accept: "application/json" }, cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.message ?? "Art Broker activation is temporarily unavailable");
  }
  return validateOwnerSetupArtifact(payload.artifact, selection);
}

export async function waitForOwnerSetupReceipt(provider, hash, isCurrent, options = {}) {
  const attempts = options.attempts ?? 45;
  const delay = options.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!isCurrent()) throw new Error("The selected wallet or Punk changed while confirming");
    const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] });
    if (receipt) {
      if (BigInt(receipt.status) !== 1n) throw new Error("An activation transaction reverted");
      return receipt;
    }
    await delay(2_000);
  }
  throw new Error("The activation transaction is still pending. Check your wallet before retrying");
}

export async function submitOwnerSetupTransactions(provider, artifact, expected, options = {}) {
  const plan = validateOwnerSetupArtifact(artifact, expected);
  return submitReviewedTransactions(provider, plan.setupTransactions, expected, options, "activation");
}

async function submitReviewedTransactions(provider, transactions, expected, options, label) {
  const originalChain = await provider.request({ method: "eth_chainId", params: [] });
  if (Number.parseInt(originalChain, 16) !== 4663) {
    throw new Error("Switch your wallet to Robinhood Chain");
  }
  const requestedAccounts = await provider.request({ method: "eth_requestAccounts", params: [] });
  if (lowerAddress(requestedAccounts?.[0]) !== lowerAddress(expected.owner)) {
    throw new Error("Connect the wallet that currently owns this Punk");
  }
  const isCurrent = options.isCurrent ?? (() => true);
  const waitForReceipt = options.waitForReceipt ?? waitForOwnerSetupReceipt;
  const hashes = [];
  for (let index = 0; index < transactions.length; index += 1) {
    const transaction = transactions[index];
    const [freshChain, freshAccounts] = await Promise.all([
      provider.request({ method: "eth_chainId", params: [] }),
      provider.request({ method: "eth_accounts", params: [] }),
    ]);
    if (!isCurrent() || freshChain !== originalChain
      || lowerAddress(freshAccounts?.[0]) !== transaction.from) {
      throw new Error("The selected wallet, network, or Punk changed during activation");
    }
    options.onProgress?.({ phase: "wallet", index: index + 1,
      total: transactions.length, transaction, label });
    const request = Object.freeze({ from: transaction.from, to: transaction.to,
      value: "0x0", data: transaction.data });
    await provider.request({ method: "eth_call", params: [request, "latest"] });
    const hash = await provider.request({ method: "eth_sendTransaction", params: [request] });
    hashes.push(hash);
    options.onProgress?.({ phase: "confirming", index: index + 1,
      total: transactions.length, transaction, hash, label });
    await waitForReceipt(provider, hash, isCurrent);
    options.onProgress?.({ phase: "confirmed", index: index + 1,
      total: transactions.length, transaction, hash, label });
  }
  return Object.freeze({ hashes: Object.freeze(hashes) });
}

export async function submitOwnerStopTransactions(provider, artifact, expected, options = {}) {
  const plan = validateOwnerSetupArtifact(artifact, expected);
  if (!plan.stopTransactions) throw new TypeError("The reviewed stop transaction plan was missing");
  return submitReviewedTransactions(provider, plan.stopTransactions, expected, options, "stop");
}
