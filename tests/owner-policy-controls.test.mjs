import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  decodeFunctionData,
  encodeFunctionData,
  encodeFunctionResult,
  keccak256,
  parseAbi,
} from "viem";
import { ownerPolicySnapshot } from
  "../netlify/functions/broker-owner-policy-status.mjs";
import {
  decodePolicyResult,
  encodeDailyCapUpdate,
  prepareDailyCapUpdate,
  prepareEmergencyPause,
  prepareOwnerFunds,
  prepareRevokeAllAgents,
  readOwnerPolicyState,
  submitOwnerAction,
  validateOwnerPolicyGate,
} from "../site/owner-policy-controls.js";

const OWNER = "0x1234567890123456789012345678901234567890";
const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const REGISTRY = "0x1111111111111111111111111111111111111111";
const IMPLEMENTATION = "0x2222222222222222222222222222222222222222";
const POLICY = "0x3333333333333333333333333333333333333333";
const AGENTS = "0x4444444444444444444444444444444444444444";
const ADAPTERS = "0x5555555555555555555555555555555555555555";
const CANONICAL = "0x6666666666666666666666666666666666666666";
const ACCOUNT = "0x7777777777777777777777777777777777777777";
const TX_HASH = `0x${"88".repeat(32)}`;
const CODE_BY_ADDRESS = new Map([
  [REGISTRY, "0x6001"], [IMPLEMENTATION, "0x6002"], [POLICY, "0x6003"],
  [AGENTS, "0x6004"], [ADAPTERS, "0x6005"], [CANONICAL, "0x6006"],
  [ACCOUNT, "0x6007"],
]);
const ABI = parseAbi([
  "function policy(address) view returns (((uint8 mode,uint256 maxSpendPerTransaction,uint256 maxSpendPerDay,uint256 maxSpendPerWeek,uint256 maxMintPrice,uint256 maxSecondaryPurchasePrice,uint256 minimumNativeReserve,uint32 maxAcquisitionsPerDay,uint32 maxIntentAge,uint16 maxSlippageBps,bool requireCollectionAllowlist,bool allowUnknownCollections) config,address configuredBy,uint64 version,uint64 permissionGeneration,bool accountPaused))",
  "function configurePolicy(address account,(uint8 mode,uint256 maxSpendPerTransaction,uint256 maxSpendPerDay,uint256 maxSpendPerWeek,uint256 maxMintPrice,uint256 maxSecondaryPurchasePrice,uint256 minimumNativeReserve,uint32 maxAcquisitionsPerDay,uint32 maxIntentAge,uint16 maxSlippageBps,bool requireCollectionAllowlist,bool allowUnknownCollections) config)",
  "function acquisitionUsage(address) view returns ((uint64 dayBucket,uint32 acquisitionsToday))",
  "function mintControls(address) view returns ((bool ownerApprovedMints,bool autonomousFreeMints,bool autonomousPaidMints))",
  "function effectiveMode(address) view returns (uint8)",
  "function globallyPaused() view returns (bool)",
  "function token() view returns (uint256 chainId,address tokenContract,uint256 tokenId)",
]);

function surface() {
  return {
    deploymentStatus: "DEPLOYED",
    accountRegistry: REGISTRY,
    accountImplementation: IMPLEMENTATION,
    policyModule: POLICY,
    agentRegistry: AGENTS,
    adapterRegistry: ADAPTERS,
  };
}

function manifest() {
  const record = (target) => ({ runtimeBytecodeHash: keccak256(CODE_BY_ADDRESS.get(target)) });
  return { contracts: {
    GoghPunkAccountRegistry: record(REGISTRY), GoghPunkAccountV1: record(IMPLEMENTATION),
    BrokerPolicyModule: record(POLICY), ArtAgentRegistry: record(AGENTS),
    ArtAdapterRegistry: record(ADAPTERS),
  } };
}

function gate() {
  const value = ownerPolicySnapshot(surface(), manifest());
  return Object.freeze({
    ...value,
    bindings: Object.freeze({
      ...value.bindings,
      canonicalERC6551Registry: CANONICAL,
      canonicalERC6551RegistryRuntimeCodeHash: keccak256(CODE_BY_ADDRESS.get(CANONICAL)),
    }),
  });
}

const POLICY_VALUE = {
  config: {
    mode: 3,
    maxSpendPerTransaction: 0n,
    maxSpendPerDay: 0n,
    maxSpendPerWeek: 0n,
    maxMintPrice: 0n,
    maxSecondaryPurchasePrice: 0n,
    minimumNativeReserve: 123n,
    maxAcquisitionsPerDay: 1,
    maxIntentAge: 120,
    maxSlippageBps: 0,
    requireCollectionAllowlist: true,
    allowUnknownCollections: false,
  },
  configuredBy: OWNER,
  version: 47n,
  permissionGeneration: 1n,
  accountPaused: false,
};

function addressResult(value) {
  return `0x${value.slice(2).padStart(64, "0")}`;
}

function boolResult(value) {
  return `0x${(value ? 1n : 0n).toString(16).padStart(64, "0")}`;
}

function world() {
  const calls = [];
  const provider = { async request({ method, params = [] }) {
    calls.push({ method, params });
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_accounts") return [OWNER];
    if (method === "eth_getBalance") return "0x38d7ea4c68000";
    if (method === "eth_getCode") return CODE_BY_ADDRESS.get(params[0].toLowerCase()) ?? "0x";
    if (method === "eth_estimateGas") return "0x186a0";
    if (method === "eth_sendTransaction") return TX_HASH;
    if (method === "eth_call") {
      const [{ to, data }] = params;
      const target = to.toLowerCase();
      if (target === COLLECTION && data.startsWith("0x6352211e")) return addressResult(OWNER);
      if (target === REGISTRY && data.startsWith("0x2dd7c658")) return addressResult(ACCOUNT);
      if (target === ACCOUNT && data === "0x8da5cb5b") return addressResult(OWNER);
      if (target === ACCOUNT && data === "0x41c283ac") return boolResult(true);
      if (target === ACCOUNT && data === "0x893866f7") return addressResult(POLICY);
      if (target === ACCOUNT && data === "0x0d1cfcae") return addressResult(AGENTS);
      if (target === ACCOUNT && data === "0x50b5c16a") return addressResult(ADAPTERS);
      if (target === ACCOUNT && data === "0xfc0c546a") return encodeFunctionResult({
        abi: ABI, functionName: "token", result: [4663n, COLLECTION, 1797n],
      });
      if (target === POLICY && data.startsWith("0x88632826")) return encodeFunctionResult({
        abi: ABI, functionName: "policy", result: POLICY_VALUE,
      });
      if (target === POLICY && data.startsWith("0x7d2fce04")) return encodeFunctionResult({
        abi: ABI, functionName: "acquisitionUsage", result: { dayBucket: 1n, acquisitionsToday: 1 },
      });
      if (target === POLICY && data.startsWith("0xfe6f2f60")) return encodeFunctionResult({
        abi: ABI, functionName: "mintControls",
        result: { ownerApprovedMints: false, autonomousFreeMints: true, autonomousPaidMints: false },
      });
      if (target === POLICY && data.startsWith("0xdf3390be")) return encodeFunctionResult({
        abi: ABI, functionName: "effectiveMode", result: 3,
      });
      if (target === POLICY && data === "0x08ce3fb5") return encodeFunctionResult({
        abi: ABI, functionName: "globallyPaused", result: false,
      });
      if (target === POLICY && (data.startsWith("0x69f21ee2")
        || data.startsWith("0x6dbcb34d"))) return "0x";
      if (target === AGENTS && data.startsWith("0x980a8c5d")) return "0x";
      if (target === ACCOUNT && data === "0x") return "0x";
      if (target === ACCOUNT && data.startsWith("0x51945447")) {
        return `0x${32n.toString(16).padStart(64, "0")}${"0".repeat(64)}`;
      }
    }
    throw new Error(`unexpected ${method} ${params[0]?.to ?? ""} ${params[0]?.data ?? ""}`);
  } };
  return { provider, calls };
}

const SELECTION = Object.freeze({ tokenId: "1797", account: ACCOUNT, activated: true, owner: OWNER });

test("policy status exposes reviewed generic core bindings and no authority", () => {
  const value = gate();
  assert.equal(value.capability, true);
  assert.equal(validateOwnerPolicyGate(value).policyModule, POLICY);
  assert.equal(ownerPolicySnapshot({ deploymentStatus: "NOT_DEPLOYED" }).capability, false);
});

test("policy decoding and daily-cap encoding exactly match the Solidity ABI", () => {
  const encodedResult = encodeFunctionResult({ abi: ABI, functionName: "policy", result: POLICY_VALUE });
  assert.deepEqual(decodePolicyResult(encodedResult), POLICY_VALUE);
  const actual = encodeDailyCapUpdate(ACCOUNT, POLICY_VALUE, 3);
  const expected = encodeFunctionData({ abi: ABI, functionName: "configurePolicy", args: [
    ACCOUNT, { ...POLICY_VALUE.config, maxAcquisitionsPerDay: 3 },
  ] });
  assert.equal(actual, expected);
  assert.deepEqual(decodeFunctionData({ abi: ABI, data: actual }).args[1], {
    ...POLICY_VALUE.config, maxAcquisitionsPerDay: 3,
  });
  for (const invalid of [-1, 2, 11]) assert.throws(() => encodeDailyCapUpdate(
    ACCOUNT, POLICY_VALUE, invalid,
  ));
});

test("live state binds owner, derived account, exact core code, modules, footer, policy and balance", async () => {
  const state = await readOwnerPolicyState(world().provider, gate(), SELECTION);
  assert.equal(state.owner, OWNER);
  assert.equal(state.account, ACCOUNT);
  assert.equal(state.policy.version, 47n);
  assert.equal(state.acquisitionsToday, 1);
  assert.equal(state.balanceWei, 1_000_000_000_000_000n);
  assert.equal(state.mintControls.autonomousFreeMints, true);
});

test("cap, pause, deposit and withdrawal preflights never submit", async () => {
  for (const prepare of [
    (w) => prepareDailyCapUpdate(w.provider, gate(), SELECTION, 3),
    (w) => prepareEmergencyPause(w.provider, gate(), SELECTION),
    (w) => prepareOwnerFunds(w.provider, gate(), SELECTION, "deposit", "0.0001"),
    (w) => prepareOwnerFunds(w.provider, gate(), SELECTION, "withdraw", "0.0001"),
    (w) => prepareRevokeAllAgents(w.provider, gate(), SELECTION),
  ]) {
    const current = world();
    const result = await prepare(current);
    assert.equal(current.calls.some(({ method }) => method === "eth_sendTransaction"), false);
    assert.equal(result.transaction.from, OWNER);
  }
});

test("submission repeats the full preflight and sends exactly one immutable transaction", async () => {
  const current = world();
  const prepared = await prepareDailyCapUpdate(current.provider, gate(), SELECTION, 3);
  const result = await submitOwnerAction(current.provider, prepared, gate(), SELECTION, () => true);
  assert.equal(result.hash, TX_HASH);
  const sends = current.calls.filter(({ method }) => method === "eth_sendTransaction");
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].params, [prepared.transaction]);
  await assert.rejects(submitOwnerAction(
    world().provider, prepared, gate(), SELECTION, () => false,
  ), /page state changed/);
});

test("broker page keeps activation, preferences, funds, cap, pause, and a master Punk selector available without opening every panel", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../site/broker/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/owner-policy-controls.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /data-workspace-punk-picker/);
  assert.match(html, /data-account-activation/);
  assert.doesNotMatch(html, /data-account-activation[^>]* open/);
  assert.match(html, /data-autonomous-minting open/);
  assert.match(html, /data-policy-cap/);
  assert.match(html, /Deposit to Punk Account/);
  assert.match(html, /Withdraw to current owner/);
  assert.match(html, /Emergency-pause in MetaMask/);
  assert.match(html, /Revoke all agents in MetaMask/);
  assert.doesNotMatch(html, /name="owner-workflow"/);
  assert.equal((source.match(/"eth_sendTransaction"/g) ?? []).length, 1);
  assert.doesNotMatch(source, /privateKey|mnemonic|arbitrary calldata/i);
});
