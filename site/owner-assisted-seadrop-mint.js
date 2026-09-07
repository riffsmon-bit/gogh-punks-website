import { keccak256Hex } from "./keccak256.js";
import { readPunkWalletFundsState, waitForPunkWalletTransactionReceipt } from
  "./punk-wallet-funds.js";

const SCHEMA = "GOGH_V2_OWNER_ASSISTED_SEADROP_MINT_V1";
const CHAIN_ID = 4663n;
const SEA_DROP = "0x00005ea00ac477b1030ce78506496e8c2de24bf5";
const FEE_RECIPIENT = "0x0000a26b00c1f0df003000390027140000faa719";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const EXECUTE_SELECTOR = "0x51945447";
const MINT_PUBLIC_SELECTOR = "0x161ac21f";
const GET_PUBLIC_DROP_SELECTOR = "0xbc6a629c";
const GET_MINT_STATS_SELECTOR = "0x840e15d4";
const FEE_ALLOWED_SELECTOR = "0x322e75d1";
const OWNER_OF_SELECTOR = "0x6352211e";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class OwnerAssistedMintError extends Error {
  constructor(code, message) { super(message); this.name = "OwnerAssistedMintError"; this.code = code; }
}
function fail(code, message) { throw new OwnerAssistedMintError(code, message); }
function address(value, label) {
  if (!ADDRESS.test(value ?? "")) fail("INVALID_ARTIFACT", `${label} is invalid`);
  return value.toLowerCase();
}
function word(value) {
  const parsed = BigInt(value);
  if (parsed < 0n || parsed >= 2n ** 256n) fail("INVALID_ARTIFACT", "integer is invalid");
  return parsed.toString(16).padStart(64, "0");
}
function addressWord(value) { return address(value, "ABI address").slice(2).padStart(64, "0"); }
function bytesPayload(value) {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value ?? "")) fail("INVALID_ARTIFACT", "calldata is invalid");
  const body = value.slice(2).toLowerCase();
  return `${word(body.length / 2)}${body}${"0".repeat((64 - body.length % 64) % 64)}`;
}
function encodeMintPublic(collection) {
  return `${MINT_PUBLIC_SELECTOR}${addressWord(collection)}${addressWord(FEE_RECIPIENT)}`
    + `${addressWord(ZERO_ADDRESS)}${word(1)}`;
}
function encodeExecuteMint(account, collection) {
  const inner = encodeMintPublic(collection);
  return `${EXECUTE_SELECTOR}${addressWord(SEA_DROP)}${word(0)}${word(128)}${word(0)}`
    + bytesPayload(inner);
}
function rpc(provider, method, params = []) {
  if (!provider?.request) fail("WALLET_UNAVAILABLE", "wallet provider is unavailable");
  return provider.request({ method, params });
}
function words(value, count, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)
    || value.length < 2 + count * 64) fail("RPC_MALFORMED", `${label} is malformed`);
  return Array.from({ length: count }, (_, index) => BigInt(
    `0x${value.slice(2 + index * 64, 2 + (index + 1) * 64)}`));
}
function decodedAddress(value, label) {
  const [raw] = words(value, 1, label);
  if (raw >= 2n ** 160n) fail("RPC_MALFORMED", `${label} is malformed`);
  return `0x${raw.toString(16).padStart(40, "0")}`;
}

export function validateOwnerAssistedMintArtifact(mint, expected, now = Date.now()) {
  if (!mint || typeof mint !== "object" || Array.isArray(mint)
    || mint.schema !== SCHEMA || mint.version !== 1 || mint.chainId !== 4663
    || mint.quantity !== "1" || mint.mintPriceWei !== "0"
    || !UUID.test(mint.attemptId ?? "") || !/^[0-9a-f]{64}$/.test(mint.idempotencyKey ?? "")
    || !HASH.test(mint.transaction?.dataKeccak256 ?? "")) {
    fail("INVALID_ARTIFACT", "the live mint review is invalid");
  }
  const owner = address(expected?.owner, "expected owner");
  const account = address(expected?.account, "expected Punk Wallet");
  const collection = address(mint.collection, "collection");
  const createdAt = Number(mint.createdAt);
  const expiresAt = Number(mint.expiresAt);
  const nowSeconds = Math.floor(Number(now) / 1_000);
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(expiresAt)
    || createdAt > nowSeconds + 5 || expiresAt <= nowSeconds || expiresAt - createdAt !== 90) {
    fail("EXPIRED_ARTIFACT", "the live mint review expired; prepare it again");
  }
  const data = encodeExecuteMint(account, collection);
  if (address(mint.transaction.from, "transaction owner") !== owner
    || address(mint.transaction.to, "transaction Punk Wallet") !== account
    || mint.transaction.value !== "0x0" || mint.transaction.data !== data
    || mint.transaction.dataKeccak256.toLowerCase() !== keccak256Hex(data)
    || !/^(?:0|[1-9]\d*)$/.test(mint.expectedTokenId ?? "")
    || !/^(?:0|[1-9]\d*)$/.test(mint.maxGasCostWei ?? "")
    || mint.safety?.ownerApprovalRequired !== true || mint.safety?.serverSigner !== false
    || mint.safety?.exactPunkWalletEntryPoint !== true
    || address(mint.safety?.fixedSeaDrop, "fixed SeaDrop") !== SEA_DROP
    || address(mint.safety?.fixedFeeRecipient, "fixed fee recipient") !== FEE_RECIPIENT
    || mint.safety?.quantityOne !== true || mint.safety?.zeroMintPrice !== true
    || address(mint.safety?.nftReceiver, "NFT receiver") !== account
    || mint.safety?.freshBrowserSimulationRequired !== true
    || mint.safety?.submissionPerformed !== false) {
    fail("INVALID_ARTIFACT", "the live mint review does not match this Punk and fixed free-mint call");
  }
  return Object.freeze({ mint, owner, account, collection,
    transaction: Object.freeze({ from: owner, to: account, value: "0x0", data }) });
}

export async function preflightOwnerAssistedMint(provider, mint, expected, recoveryGate) {
  const validated = validateOwnerAssistedMintArtifact(mint, expected);
  const [chainId, accounts] = await Promise.all([
    rpc(provider, "eth_chainId"), rpc(provider, "eth_accounts"),
  ]);
  if (BigInt(chainId) !== CHAIN_ID) fail("WRONG_CHAIN", "switch to Robinhood Chain");
  const selected = Array.isArray(accounts) && ADDRESS.test(accounts[0] ?? "")
    ? accounts[0].toLowerCase() : null;
  if (selected !== validated.owner) fail("OWNER_MISMATCH", "connect the current Punk owner");
  const live = await readPunkWalletFundsState(provider, recoveryGate, String(expected.tokenId));
  if (live.bindings.account !== validated.account || live.bindings.expectedOwner !== validated.owner) {
    fail("OWNER_MISMATCH", "live Punk Wallet authority changed");
  }
  const [dropRaw, statsRaw, latestBlock] = await Promise.all([
    rpc(provider, "eth_call", [{ to: SEA_DROP,
      data: `${GET_PUBLIC_DROP_SELECTOR}${addressWord(validated.collection)}` }, "latest"]),
    rpc(provider, "eth_call", [{ to: validated.collection,
      data: `${GET_MINT_STATS_SELECTOR}${addressWord(validated.account)}` }, "latest"]),
    rpc(provider, "eth_getBlockByNumber", ["latest", false]),
  ]);
  const [price, start, end, walletLimit,, restricted] = words(dropRaw, 6, "public drop");
  const [minted, supply, maximum] = words(statsRaw, 3, "mint stats");
  const blockTime = BigInt(latestBlock?.timestamp ?? "0x0");
  if (price !== 0n) fail("PRICE_CHANGED", "the mint is no longer free");
  if (blockTime < start || blockTime > end) fail("MINT_CLOSED", "the public mint is not open now");
  if (walletLimit === 0n || minted >= walletLimit) fail("WALLET_LIMIT_REACHED", "this Punk already minted its allowance");
  if (supply >= maximum || supply + 1n !== BigInt(mint.expectedTokenId)) {
    fail("SUPPLY_CHANGED", "collection supply changed; prepare a fresh review");
  }
  if (restricted === 1n) {
    const allowedRaw = await rpc(provider, "eth_call", [{ to: SEA_DROP,
      data: `${FEE_ALLOWED_SELECTOR}${addressWord(validated.collection)}${addressWord(FEE_RECIPIENT)}` }, "latest"]);
    if (words(allowedRaw, 1, "fee recipient")[0] !== 1n) fail("FEE_RECIPIENT_BLOCKED", "fee recipient is no longer allowed");
  }
  const [result, gasRaw, gasPriceRaw] = await Promise.all([
    rpc(provider, "eth_call", [validated.transaction, "latest"]),
    rpc(provider, "eth_estimateGas", [validated.transaction]), rpc(provider, "eth_gasPrice"),
  ]);
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]*$/.test(result)) {
    fail("SIMULATION_FAILED", "the exact Punk Wallet mint did not simulate successfully");
  }
  const gasCost = BigInt(gasRaw) * BigInt(gasPriceRaw);
  if (gasCost > BigInt(mint.maxGasCostWei)) fail("GAS_LIMIT_EXCEEDED", "live gas exceeds the confirmed strategy limit");
  return Object.freeze({ ...validated, gasCostWei: gasCost.toString() });
}

export async function submitOwnerAssistedMint(provider, prepared) {
  const hash = await rpc(provider, "eth_sendTransaction", [prepared.transaction]);
  if (!HASH.test(hash ?? "")) fail("SUBMISSION_UNCONFIRMED", "wallet did not return a transaction hash");
  return hash.toLowerCase();
}

export async function confirmOwnerAssistedMint(provider, prepared, hash) {
  const receipt = await waitForPunkWalletTransactionReceipt(provider, hash);
  const rawReceipt = await rpc(provider, "eth_getTransactionReceipt", [hash]);
  const expectedFrom = `0x${"0".repeat(64)}`;
  const expectedTo = `0x${"0".repeat(24)}${prepared.account.slice(2)}`;
  const mintedTokenIds = [];
  for (const log of rawReceipt?.logs ?? []) {
    const topics = log?.topics;
    if (!ADDRESS.test(log?.address ?? "") || log.address.toLowerCase() !== prepared.collection
      || !Array.isArray(topics) || topics.length !== 4
      || String(topics[0]).toLowerCase() !== TRANSFER_TOPIC
      || String(topics[1]).toLowerCase() !== expectedFrom
      || String(topics[2]).toLowerCase() !== expectedTo
      || !/^0x[0-9a-fA-F]{64}$/.test(topics[3] ?? "") || log.data !== "0x") continue;
    mintedTokenIds.push(BigInt(topics[3]));
  }
  if (mintedTokenIds.length !== 1) {
    fail("POSTCONDITION_FAILED", "the confirmed receipt does not contain exactly one NFT mint into the Punk Wallet");
  }
  const mintedTokenId = mintedTokenIds[0].toString();
  const ownerRaw = await rpc(provider, "eth_call", [{ to: prepared.collection,
    data: `${OWNER_OF_SELECTOR}${word(mintedTokenId)}` }, "latest"]);
  if (decodedAddress(ownerRaw, "minted NFT owner") !== prepared.account) {
    fail("POSTCONDITION_FAILED", "the confirmed NFT was not found in the Punk Wallet");
  }
  return Object.freeze({ ...receipt, collection: prepared.collection,
    tokenId: mintedTokenId, expectedTokenId: prepared.mint.expectedTokenId,
    owner: prepared.account });
}
