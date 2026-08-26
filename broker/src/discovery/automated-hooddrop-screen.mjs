import { encodeFunctionData, getAddress, isAddress, keccak256 } from "viem";

import { canonicalJson, parseCanonicalJson } from "../scout/canonical-json.mjs";

export const HOOD_DROP_CONTROLLER = "0x26b10b0c7c0f794375593f00222fd960fac22f16";
export const HOOD_DROP_CONTROLLER_CODE_HASH =
  "0x722dc2f13ebf38431d43e12e0b1994060ec3ab14ecf45af5617d5d1ca2ca4fce";
export const HOOD_DROP_MINT_ABI = Object.freeze([{
  type: "function",
  name: "mint",
  stateMutability: "payable",
  inputs: [
    { name: "token", type: "address" },
    { name: "roundId", type: "uint256" },
    { name: "stageId", type: "uint32" },
    { name: "quantity", type: "uint256" },
    { name: "proof", type: "bytes32[]" },
  ],
  outputs: [],
}]);

const ZERO_HASH = `0x${"00".repeat(32)}`;

function fail(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function snapshot(value, label) {
  try {
    return parseCanonicalJson(canonicalJson(value));
  } catch {
    fail("INVALID_JSON", `${label} must be strict canonical JSON`);
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_SCHEMA", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_SCHEMA", `${label} contains missing or unknown fields`);
  }
}

function address(value, label) {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    fail("INVALID_ADDRESS", `${label} must be an exact address`);
  }
  const normalized = getAddress(value).toLowerCase();
  if (/^0x0{40}$/.test(normalized)) fail("INVALID_ADDRESS", `${label} cannot be zero`);
  return normalized;
}

function hash(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)
    || value === ZERO_HASH) fail("INVALID_HASH", `${label} must be a nonzero lowercase hash`);
  return value;
}

function decimal(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail("INVALID_INTEGER", `${label} must be a canonical unsigned decimal string`);
  }
  return BigInt(value);
}

/**
 * Screens already dual-RPC-equal HoodDrop state. This function performs no RPC,
 * signing, simulation, or submission; callers must provide a fresh confirmed
 * state snapshot and must still simulate the adapter/account route immediately
 * before any transaction.
 */
export function screenHoodDropFreeMintCandidate(candidateInput, stateInput) {
  const candidate = snapshot(candidateInput, "candidate");
  const state = snapshot(stateInput, "state");
  exactKeys(candidate, [
    "chainId", "controller", "controllerCodeHash", "collection",
    "collectionRuntimeCodeHash", "account", "roundId", "stageId", "tokenId",
  ], "candidate");
  exactKeys(state, [
    "checkedAt", "blockNumber", "blockHash", "blockTimestamp", "currentRoundId",
    "round", "stage", "mintedByWallet", "mintStats",
  ], "state");
  exactKeys(state.round, ["maxTokenSupplyForRound", "exists", "active", "paused"], "state.round");
  exactKeys(state.stage, [
    "startTime", "endTime", "maxPerWallet", "mintPriceWei", "merkleRoot",
    "allowlist", "exists",
  ], "state.stage");
  exactKeys(state.mintStats, ["minterMinted", "currentTotalSupply", "maxSupply"], "state.mintStats");

  if (candidate.chainId !== 4663) fail("WRONG_CHAIN", "HoodDrop candidate must target Robinhood");
  if (address(candidate.controller, "candidate.controller") !== HOOD_DROP_CONTROLLER) {
    fail("WRONG_CONTROLLER", "candidate must use the reviewed HoodDrop V2 controller");
  }
  if (hash(candidate.controllerCodeHash, "candidate.controllerCodeHash")
    !== HOOD_DROP_CONTROLLER_CODE_HASH) fail("CONTROLLER_CODE_MISMATCH", "controller runtime is not reviewed");
  const collection = address(candidate.collection, "candidate.collection");
  const collectionRuntimeCodeHash = hash(
    candidate.collectionRuntimeCodeHash,
    "candidate.collectionRuntimeCodeHash",
  );
  const account = address(candidate.account, "candidate.account");
  const roundId = decimal(candidate.roundId, "candidate.roundId");
  const stageId = decimal(candidate.stageId, "candidate.stageId");
  const tokenId = decimal(candidate.tokenId, "candidate.tokenId");
  if (stageId > 0xffff_ffffn) fail("INVALID_STAGE", "stageId exceeds uint32");

  const blockNumber = decimal(state.blockNumber, "state.blockNumber");
  const blockTimestamp = decimal(state.blockTimestamp, "state.blockTimestamp");
  hash(state.blockHash, "state.blockHash");
  const checkedAt = Date.parse(state.checkedAt);
  if (!Number.isFinite(checkedAt) || new Date(checkedAt).toISOString() !== state.checkedAt) {
    fail("INVALID_TIME", "state.checkedAt must be canonical UTC ISO");
  }
  if (decimal(state.currentRoundId, "state.currentRoundId") !== roundId
    || state.round.exists !== true || state.round.active !== true) {
    fail("ROUND_NOT_ACTIVE", "reviewed HoodDrop round is not current and active");
  }
  if (state.round.paused !== false) fail("ROUND_PAUSED", "reviewed HoodDrop round is paused");
  const roundMaximum = decimal(
    state.round.maxTokenSupplyForRound,
    "state.round.maxTokenSupplyForRound",
  );

  if (state.stage.exists !== true || state.stage.allowlist !== false
    || state.stage.merkleRoot !== ZERO_HASH) {
    fail("STAGE_NOT_PUBLIC", "HoodDrop stage must be public with an empty proof root");
  }
  if (decimal(state.stage.mintPriceWei, "state.stage.mintPriceWei") !== 0n) {
    fail("STAGE_NOT_FREE", "HoodDrop stage price must equal zero");
  }
  const startTime = decimal(state.stage.startTime, "state.stage.startTime");
  const endTime = decimal(state.stage.endTime, "state.stage.endTime");
  if (blockTimestamp < startTime || (endTime !== 0n && blockTimestamp >= endTime)) {
    fail("STAGE_NOT_ACTIVE", "HoodDrop stage is not active at the confirmed block");
  }
  const walletLimit = decimal(state.stage.maxPerWallet, "state.stage.maxPerWallet");
  const accountMints = decimal(state.mintedByWallet, "state.mintedByWallet");
  if (walletLimit !== 0n && accountMints >= walletLimit) {
    fail("WALLET_LIMIT_REACHED", "HoodDrop wallet mint limit is exhausted");
  }

  const minterMinted = decimal(state.mintStats.minterMinted, "state.mintStats.minterMinted");
  const totalSupply = decimal(state.mintStats.currentTotalSupply, "state.mintStats.currentTotalSupply");
  const maxSupply = decimal(state.mintStats.maxSupply, "state.mintStats.maxSupply");
  if (minterMinted > totalSupply || totalSupply >= roundMaximum || totalSupply >= maxSupply) {
    fail("SUPPLY_EXHAUSTED", "HoodDrop collection or round has no safe remaining supply");
  }
  if (tokenId !== totalSupply + 1n) fail("WRONG_TOKEN_ID", "candidate tokenId is not the exact next token");

  const callData = encodeFunctionData({
    abi: HOOD_DROP_MINT_ABI,
    functionName: "mint",
    args: [getAddress(collection), roundId, Number(stageId), 1n, []],
  });
  return Object.freeze({
    schema: "GOGH_AUTOMATED_HOODDROP_FREE_MINT_SCREEN_V1",
    version: 1,
    chainId: 4663,
    checkedAt: state.checkedAt,
    pinnedBlock: { number: blockNumber.toString(), hash: state.blockHash, timestamp: blockTimestamp.toString() },
    controller: HOOD_DROP_CONTROLLER,
    controllerCodeHash: HOOD_DROP_CONTROLLER_CODE_HASH,
    collection,
    collectionRuntimeCodeHash,
    account,
    roundId: roundId.toString(),
    stageId: stageId.toString(),
    tokenId: tokenId.toString(),
    quantity: 1,
    valueWei: "0",
    calldata: callData,
    calldataKeccak256: keccak256(callData),
    publicStage: true,
    allowlistProof: [],
    approvalsRequired: false,
    arbitraryCalldataAccepted: false,
    submissionPerformed: false,
    mandatoryNextGate: "DUAL_RPC_CURRENT_HEAD_RECHECK_AND_FULL_PUNK_ACCOUNT_SIMULATION",
  });
}
