import test from "node:test";
import assert from "node:assert/strict";
import {
  FEATURE_DEFAULTS,
  ROBINHOOD,
  assetKey,
  punkKey,
  readFeatureFlags,
} from "../src/config.mjs";
import { normalizeOpportunity } from "../src/opportunity.mjs";
import { PUNK_PERSONAS, tasteMatch } from "../src/personas.mjs";
import { analyzeContractRisk } from "../src/analysis/contract-risk.mjs";
import { BlockscoutAbiInspector } from "../src/analysis/blockscout-abi-inspector.mjs";
import { CollectionEnricher } from "../src/analysis/collection-enricher.mjs";
import {
  EIP1967_SLOTS,
  RpcContractInspector,
  scanRuntimeOpcodes,
} from "../src/analysis/rpc-contract-inspector.mjs";
import { recommendOpportunity } from "../src/recommendation/engine.mjs";
import {
  IntentBuildError,
  buildAcquisitionIntent,
} from "../src/recommendation/intent-builder.mjs";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const ACCOUNT = "0x2222222222222222222222222222222222222222";
const OWNER = "0x3333333333333333333333333333333333333333";
const ADAPTER = "0x4444444444444444444444444444444444444444";
const VENUE = "0x5555555555555555555555555555555555555555";

test("chain-qualified identifiers never collapse to token ID alone", () => {
  assert.equal(
    punkKey(317),
    "4663:0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6:317",
  );
  assert.notEqual(assetKey(4663, ADDRESS, 317), assetKey(1, ADDRESS, 317));
});

test("production feature defaults enable only read-only Scout Mode", () => {
  assert.deepEqual(readFeatureFlags({}), FEATURE_DEFAULTS);
  assert.throws(
    () => readFeatureFlags({ ENABLE_AUTONOMOUS_MINTS: "true" }),
    /require autonomous purchases/,
  );
  assert.throws(() => readFeatureFlags({ ENABLE_SELLING: "yes" }), /exactly true or false/);
});

test("opportunities are normalized and reject the wrong chain", () => {
  const opportunity = normalizeOpportunity({
    chainId: ROBINHOOD.chainId,
    collection: ADDRESS,
    tokenId: "42",
    opportunityType: "MINT",
    discoveredAt: "2026-08-15T12:00:00.000Z",
  });
  assert.equal(opportunity.tokenId, "42");
  assert.equal(opportunity.riskLabel, "UNKNOWN");
  assert.equal(opportunity.contractRiskScore, 100);
  assert.throws(() => normalizeOpportunity({ ...opportunity, chainId: 1 }), /chainId/);
});

test("contract analyzer never labels missing evidence safe", () => {
  const unknown = analyzeContractRisk({});
  assert.equal(unknown.label, "UNKNOWN");
  assert.equal(unknown.score, 100);
  assert.doesNotMatch(unknown.disclaimer.toLowerCase(), /is safe/);

  const elevated = analyzeContractRisk({
    bytecodePresent: true,
    sourceVerified: false,
    erc721: true,
    proxyDetected: true,
    unverifiedImplementation: true,
    blacklistFunctionality: true,
  });
  assert.ok(elevated.score >= 50);
  assert.ok(elevated.findings.length >= 3);
  assert.equal(elevated.label, "UNKNOWN");
  assert.match(elevated.disclaimer, /insufficient/i);

  const covered = analyzeContractRisk({
    bytecodePresent: true,
    sourceVerified: true,
    erc721: true,
    erc1155: false,
    proxyDetected: false,
    unverifiedImplementation: false,
    delegatecallDetected: false,
    unusualExternalCalls: false,
    callbackSurface: false,
    selfdestructDetected: false,
    ownerCanMint: false,
    ownerCanPause: false,
    mutableMetadata: false,
    transferRestrictions: false,
    blacklistFunctionality: false,
    unboundedOperatorApproval: false,
    suspiciousBehavior: false,
    royaltyMutable: false,
    mintFunctionExposed: false,
    pauseFunctionExposed: false,
    metadataSetterExposed: false,
    transferControlFunctionExposed: false,
    blacklistFunctionExposed: false,
    royaltySetterExposed: false,
    upgradeFunctionExposed: false,
    standardConflict: false,
  });
  assert.equal(covered.confidence, 100);
  assert.equal(covered.label, "LOWER_RISK");

  const unverifiedText = analyzeContractRisk({
    bytecodePresent: true,
    sourceVerified: false,
    erc721: true,
    erc1155: false,
    transferRestrictions: "UNVERIFIED",
  });
  assert.equal(
    unverifiedText.findings.some(({ code }) => code === "TRANSFER_RESTRICTIONS"),
    false,
  );
});

test("bytecode scanner ignores opcode-looking PUSH data", () => {
  const pushedOnly = scanRuntimeOpcodes("0x60f460ff61f2ff");
  assert.equal(pushedOnly.delegatecallCount, 0);
  assert.equal(pushedOnly.selfdestructCount, 0);
  assert.equal(pushedOnly.callcodeCount, 0);

  const executable = scanRuntimeOpcodes("0x60f450f4ff");
  assert.equal(executable.delegatecallCount, 1);
  assert.equal(executable.selfdestructCount, 1);
});

test("RPC inspector verifies chain, proxy slots, bytecode, and NFT interfaces", async () => {
  const implementation = "0x9999999999999999999999999999999999999999";
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_blockNumber") return "0x64";
    if (method === "eth_getBlockByNumber") {
      return {
        number: params[0],
        hash: `0x${"ab".repeat(32)}`,
        timestamp: "0x1234",
      };
    }
    if (method === "eth_getCode") return "0x60006000f4";
    if (method === "eth_getStorageAt") {
      return params[1] === EIP1967_SLOTS.implementation
        ? `0x${"0".repeat(24)}${implementation.slice(2)}`
        : `0x${"0".repeat(64)}`;
    }
    if (method === "eth_call") {
      return params[0].data.includes("80ac58cd")
        ? `0x${"0".repeat(63)}1`
        : `0x${"0".repeat(64)}`;
    }
    throw new Error("unexpected method");
  };
  const inspector = new RpcContractInspector({
    rpc,
    clock: () => new Date("2026-08-15T12:00:00.000Z"),
  });
  const evidence = await inspector.inspect(ADDRESS);
  assert.equal(evidence.proxyDetected, true);
  assert.equal(evidence.implementation, implementation);
  assert.equal(evidence.delegatecallDetected, true);
  assert.equal(evidence.erc721, true);
  assert.equal(evidence.erc1155, false);
  assert.equal(evidence.ownershipPrivileges, "UNVERIFIED");
  assert.equal(evidence.observedBlock, "80");
  assert.equal(evidence.observedBlockHash, `0x${"ab".repeat(32)}`);
  assert.match(evidence.runtimeBytecodeHash, /^0x[0-9a-f]{64}$/);
  assert.ok(
    calls
      .filter(({ method }) => ["eth_getCode", "eth_getStorageAt", "eth_call"].includes(method))
      .every(({ params }) => params.at(-1) === "0x50"),
  );

  await assert.rejects(
    () => inspector.inspect(ADDRESS, { blockNumber: 81 }),
    /confirmed/,
  );

  const wrongChain = new RpcContractInspector({ rpc: async () => "0x1" });
  await assert.rejects(() => wrongChain.inspect(ADDRESS), /RPC chain mismatch/);
});

test("Blockscout ABI inspector reports exposed write surface without claiming access safety", async () => {
  let requestedUrl;
  const abi = [
    { type: "function", name: "ownerOf", stateMutability: "view", inputs: [] },
    { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [] },
    { type: "function", name: "setBaseURI", stateMutability: "nonpayable", inputs: [] },
    { type: "function", name: "setTransferValidator", stateMutability: "nonpayable", inputs: [] },
    { type: "function", name: "setRoyaltyInfo", stateMutability: "nonpayable", inputs: [] },
  ];
  const inspector = new BlockscoutAbiInspector({
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return new Response(JSON.stringify({ status: "1", message: "OK", result: JSON.stringify(abi) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    clock: () => new Date("2026-08-17T12:00:00.000Z"),
  });
  const evidence = await inspector.inspect(ADDRESS);
  assert.equal(requestedUrl.searchParams.get("module"), "contract");
  assert.equal(requestedUrl.searchParams.get("action"), "getabi");
  assert.equal(requestedUrl.searchParams.get("address"), ADDRESS);
  assert.equal(evidence.sourceVerified, true);
  assert.equal(evidence.mintFunctionExposed, true);
  assert.equal(evidence.metadataSetterExposed, true);
  assert.equal(evidence.transferControlFunctionExposed, true);
  assert.equal(evidence.royaltySetterExposed, true);
  assert.match(evidence.caveat, /not access-control correctness/i);

  const unverified = new BlockscoutAbiInspector({
    fetchImpl: async () => new Response(JSON.stringify({ status: "0", result: "not verified" })),
  });
  assert.equal((await unverified.inspect(ADDRESS)).sourceVerified, false);
  assert.throws(
    () => new BlockscoutAbiInspector({ endpoint: "https://example.com/api" }),
    /Robinhood Blockscout/,
  );
});

test("Blockscout ABI inspector rejects oversized and malformed verified evidence", async () => {
  const oversized = new BlockscoutAbiInspector({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "1000001" },
      text: async () => "should not be read",
    }),
  });
  await assert.rejects(() => oversized.inspect(ADDRESS), /too large/);

  const malformed = new BlockscoutAbiInspector({
    fetchImpl: async () => new Response(JSON.stringify({
      status: "1",
      result: JSON.stringify({ not: "an ABI array" }),
    })),
  });
  await assert.rejects(() => malformed.inspect(ADDRESS), /invalid ABI/);
});

test("collection enrichment preserves event standard conflicts and fails closed", async () => {
  const contractInspector = {
    inspect: async () => ({
      chainId: 4663,
      address: ADDRESS,
      observedAt: "2026-08-17T12:00:00.000Z",
      observedBlock: "80",
      observedBlockHash: `0x${"ab".repeat(32)}`,
      observedBlockTimestamp: "4660",
      bytecodePresent: true,
      sourceVerified: false,
      proxyDetected: false,
      unverifiedImplementation: false,
      delegatecallDetected: false,
      unusualExternalCalls: false,
      callbackSurface: false,
      selfdestructDetected: false,
      erc721: false,
      erc1155: true,
    }),
  };
  const enricher = new CollectionEnricher({
    contractInspector,
    abiInspector: {
      inspect: async () => ({
        sourceVerified: true,
        explorerEvidence: "VERIFIED_ABI",
        mintFunctionExposed: false,
        pauseFunctionExposed: false,
        metadataSetterExposed: false,
        transferControlFunctionExposed: false,
        blacklistFunctionExposed: false,
        royaltySetterExposed: false,
        upgradeFunctionExposed: false,
      }),
    },
  });
  const analysis = await enricher.enrich({
    chainId: 4663,
    address: ADDRESS,
    standard: "ERC721",
  });
  assert.equal(analysis.standard, "ERC721");
  assert.equal(analysis.evidence.standardConflict, true);
  assert.equal(analysis.observedBlockTimestamp, "4660");
  assert.equal(analysis.market.observedAt, "1970-01-01T01:17:40.000Z");
  assert.ok(analysis.riskScore >= 28);
  assert.equal(analysis.opportunityPatch.recommendation, "RESEARCH");
  assert.equal(analysis.opportunityPatch.autonomousExecutionEligible, false);

  const explorerFailure = new CollectionEnricher({
    contractInspector,
    abiInspector: { inspect: async () => { throw new Error("provider unavailable"); } },
  });
  const failClosed = await explorerFailure.enrich({
    chainId: 4663,
    address: ADDRESS,
    standard: "UNKNOWN",
  });
  assert.equal(failClosed.sourceVerified, false);
  assert.equal(failClosed.riskLabel, "UNKNOWN");
  assert.equal(failClosed.evidence.explorer.failureType, "Error");
});

test("personas affect taste while risk remains an independent score", () => {
  const taste = tasteMatch(PUNK_PERSONAS.PIXEL_MAXI, {
    pixelArt: 100,
    pfp: 95,
    onChainArt: 80,
  });
  assert.ok(taste > 20);
  const result = recommendOpportunity({
    artScore: 94,
    tasteMatch: 97,
    creatorScore: 78,
    marketScore: 63,
    liquidityScore: 20,
    collectionScore: 80,
    contractRiskScore: 22,
    confidence: 87,
    riskLabel: "LOWER_RISK",
  });
  assert.equal(result.recommendation, "COLLECT");
  assert.equal(result.scores.contractRiskScore, 22);
  assert.match(result.explanation, /liquidity is currently thin/);
});

function baseIntentRequest() {
  return {
    account: ACCOUNT,
    expectedOwner: OWNER,
    nonce: 0,
    policyVersion: 1,
    opportunityType: "SECONDARY_BUY",
    assetStandard: "ERC721",
    adapter: ADAPTER,
    venue: VENUE,
    collection: ADDRESS,
    tokenId: 42,
    assetAmount: 1,
    expectedPrice: 10,
    maxPrice: 11,
    maxSlippageBps: 100,
    expiresAt: 2_000,
    opportunityId: `0x${"11".repeat(32)}`,
    reasoningHash: `0x${"22".repeat(32)}`,
    adapterCodeHash: `0x${"33".repeat(32)}`,
  };
}

test("intent builder rejects arbitrary calldata and disabled execution", () => {
  assert.throws(
    () =>
      buildAcquisitionIntent(
        { ...baseIntentRequest(), calldata: "0xdeadbeef" },
        { ownerApproved: true, nowSeconds: 1_000 },
      ),
    (error) => error instanceof IntentBuildError && error.code === "ARBITRARY_CALLDATA_REJECTED",
  );
  assert.throws(
    () => buildAcquisitionIntent(baseIntentRequest(), { nowSeconds: 1_000 }),
    (error) => error.code === "AUTONOMY_DISABLED",
  );
});

test("owner-approved typed intent is possible only behind its explicit feature", () => {
  const intent = buildAcquisitionIntent(baseIntentRequest(), {
    ownerApproved: true,
    collectionAllowlisted: false,
    nowSeconds: 1_000,
    featureFlags: { ENABLE_APPROVAL_PURCHASES: true },
  });
  assert.equal(intent.chainId, 4663);
  assert.equal(intent.tokenId, "42");
  assert.equal(Object.hasOwn(intent, "calldata"), false);
});
