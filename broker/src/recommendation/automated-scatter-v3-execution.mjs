import {
  decodeFunctionData, encodeFunctionData, getAddress, isAddress, keccak256,
} from "viem";

import { AUTOMATED_ACCOUNT_EXECUTION_ABI } from
  "./automated-seadrop-v3-execution-batch.mjs";
import { canonicalJson, parseCanonicalJson } from "../scout/canonical-json.mjs";

export const AUTOMATED_SCATTER_TARGETS_ENV =
  "BROKER_AUTOMATION_V3_SCATTER_TARGETS_JSON";
export const SCATTER_MINT_SELECTOR = "0x4a21a2df";
export const SCATTER_ARCHETYPE_IMPLEMENTATION =
  "0xb195891c61c68bd518cbe66f176bed204a222b54";
export const SCATTER_ARCHETYPE_IMPLEMENTATION_CODE_HASH =
  "0x51f009ed661c60923fea65913c59ee3271ada196bd60a64f2c3f1dda9485e40a";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_TARGETS = 8;

function fail(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function snapshot(value, label) {
  try {
    const serialized = canonicalJson(value);
    structuredClone(value);
    return parseCanonicalJson(serialized);
  } catch {
    fail("INVALID_SCATTER_EXECUTION", `${label} must be immutable plain JSON`);
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_SCATTER_TARGETS", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_SCATTER_TARGETS", `${label} contains missing or unknown fields`);
  }
}

function address(value, label) {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    fail("INVALID_SCATTER_TARGETS", `${label} must be an exact EVM address`);
  }
  const normalized = getAddress(value).toLowerCase();
  if (normalized === ZERO_ADDRESS) {
    fail("INVALID_SCATTER_TARGETS", `${label} cannot be zero`);
  }
  return normalized;
}

function hash(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)
    || /^0x0{64}$/.test(value)) {
    fail("INVALID_SCATTER_TARGETS", `${label} must be nonzero lowercase bytes32`);
  }
  return value;
}

function bytes32(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) {
    fail("INVALID_SCATTER_TARGETS", `${label} must be lowercase bytes32`);
  }
  return value;
}

function decimal(value, label, bits = 256) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail("INVALID_SCATTER_EXECUTION", `${label} must be canonical decimal`);
  }
  const parsed = BigInt(value);
  if (parsed >= 1n << BigInt(bits)) {
    fail("INVALID_SCATTER_EXECUTION", `${label} is out of range`);
  }
  return parsed;
}

export function configuredScatterTargets(environment = {}) {
  const raw = environment[AUTOMATED_SCATTER_TARGETS_ENV];
  if (raw === undefined || raw === "") return Object.freeze([]);
  if (typeof raw !== "string" || raw.length > 8_192 || raw.trim() !== raw) {
    fail("INVALID_SCATTER_TARGETS", `${AUTOMATED_SCATTER_TARGETS_ENV} is malformed`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("INVALID_SCATTER_TARGETS", `${AUTOMATED_SCATTER_TARGETS_ENV} must be JSON`);
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_TARGETS) {
    fail("INVALID_SCATTER_TARGETS", `Scatter target count must be 0 through ${MAX_TARGETS}`);
  }
  const targets = parsed.map((target, index) => {
    exactKeys(
      target,
      ["collection", "adapter", "adapterCodeHash", "publicInviteKey"],
      `targets[${index}]`,
    );
    const collection = address(target.collection, `targets[${index}].collection`);
    const adapter = address(target.adapter, `targets[${index}].adapter`);
    if (collection === adapter) {
      fail("INVALID_SCATTER_TARGETS", "Scatter collection and adapter must be distinct");
    }
    const publicInviteKey = bytes32(
      target.publicInviteKey,
      `targets[${index}].publicInviteKey`,
    );
    if (BigInt(publicInviteKey) > 255n) {
      fail("INVALID_SCATTER_TARGETS", "Scatter invite key must be public (0 through 255)");
    }
    return Object.freeze({
      collection,
      adapter,
      adapterCodeHash: hash(
        target.adapterCodeHash,
        `targets[${index}].adapterCodeHash`,
      ),
      publicInviteKey,
    });
  });
  const collections = targets.map(({ collection }) => collection);
  const adapters = targets.map(({ adapter }) => adapter);
  if (new Set(collections).size !== collections.length
    || new Set(adapters).size !== adapters.length) {
    fail("INVALID_SCATTER_TARGETS", "Scatter targets cannot duplicate a collection or adapter");
  }
  return Object.freeze(targets);
}

export function buildAutomatedScatterV3Execution(input) {
  const clean = snapshot(input, "execution");
  exactKeys(clean, [
    "target", "account", "agent", "expectedOwner", "nonce", "policyVersion",
    "tokenId", "createdAt", "expiresAt", "opportunityId", "reasoningHash",
  ], "execution");
  const target = clean.target;
  exactKeys(
    target,
    ["collection", "adapter", "adapterCodeHash", "publicInviteKey"],
    "execution.target",
  );
  const collection = address(target.collection, "execution.target.collection");
  const adapter = address(target.adapter, "execution.target.adapter");
  const account = address(clean.account, "execution.account");
  const agent = address(clean.agent, "execution.agent");
  const expectedOwner = address(clean.expectedOwner, "execution.expectedOwner");
  const nonce = decimal(clean.nonce, "execution.nonce");
  const policyVersion = decimal(clean.policyVersion, "execution.policyVersion", 64);
  const tokenId = decimal(clean.tokenId, "execution.tokenId");
  const createdAt = decimal(clean.createdAt, "execution.createdAt", 64);
  const expiresAt = decimal(clean.expiresAt, "execution.expiresAt", 64);
  if (tokenId === 0n || expiresAt <= createdAt || expiresAt - createdAt > 120n) {
    fail("INVALID_SCATTER_EXECUTION", "Scatter token and intent window must be bounded");
  }
  const opportunityId = hash(clean.opportunityId, "execution.opportunityId");
  const reasoningHash = hash(clean.reasoningHash, "execution.reasoningHash");
  const adapterCodeHash = hash(target.adapterCodeHash, "execution.target.adapterCodeHash");
  const intent = {
    account,
    chainId: 4663n,
    expectedOwner,
    nonce,
    policyVersion,
    opportunityType: 2,
    assetStandard: 0,
    adapter,
    venue: collection,
    collection,
    tokenId,
    assetAmount: 1n,
    currency: ZERO_ADDRESS,
    expectedPrice: 0n,
    maxPrice: 0n,
    maxSlippageBps: 0,
    createdAt,
    expiresAt,
    opportunityId,
    reasoningHash,
    adapterCodeHash,
  };
  const data = encodeFunctionData({
    abi: AUTOMATED_ACCOUNT_EXECUTION_ABI,
    functionName: "executeAutonomousAcquisition",
    args: [intent, "0x"],
  });
  const decoded = decodeFunctionData({ abi: AUTOMATED_ACCOUNT_EXECUTION_ABI, data });
  if (decoded.functionName !== "executeAutonomousAcquisition"
    || decoded.args[1] !== "0x"
    || decoded.args[0].account.toLowerCase() !== account
    || decoded.args[0].adapter.toLowerCase() !== adapter
    || decoded.args[0].venue.toLowerCase() !== collection
    || decoded.args[0].collection.toLowerCase() !== collection
    || decoded.args[0].tokenId !== tokenId
    || decoded.args[0].expectedPrice !== 0n
    || decoded.args[0].maxPrice !== 0n) {
    fail("INVALID_SCATTER_EXECUTION", "canonical Scatter calldata decode check failed");
  }
  return Object.freeze({
    from: agent,
    to: account,
    value: "0",
    data,
    dataKeccak256: keccak256(data),
    collection,
    adapter,
    tokenId: tokenId.toString(),
    nonce: nonce.toString(),
    policyVersion: policyVersion.toString(),
    expiresAt: expiresAt.toString(),
  });
}
