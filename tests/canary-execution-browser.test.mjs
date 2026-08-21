import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { keccak256 } from "viem";
import { canonicalSha256 } from
  "../broker/src/recommendation/owner-direct-free-mint-execution.mjs";
import {
  canonicalExecutionSha256,
  encodeReviewedOwnerDirectCalldata,
  preflightCanaryTransaction,
  submitCanaryTransaction,
  validateCanaryExecutionArtifact,
} from "../site/canary-execution.js";
import { keccak256Hex } from "../site/keccak256.js";
import {
  ACCOUNT_CODE,
  ADAPTER_CODE,
  ART_CODE,
  buildCanaryMintArtifactFixtures,
} from "./helpers/canary-mint-fixtures.mjs";

const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const addressWord = (value) => `0x${value.slice(2).toLowerCase().padStart(64, "0")}`;
const uintWord = (value) => `0x${word(value)}`;

async function browserFixture() {
  const fixtures = buildCanaryMintArtifactFixtures();
  const artifact = structuredClone(fixtures.executionArtifact);
  artifact.reviewedAcquisition.controllingPunk.tokenId = "1797";
  const artifactHash = await canonicalExecutionSha256(artifact);
  const intent = artifact.reviewedAcquisition.intent;
  const policyModule = fixtures.coreManifest.contracts.BrokerPolicyModule.address.toLowerCase();
  const gate = {
    status: "READY_FOR_OWNER_FILE_REVIEW",
    capability: true,
    reason: null,
    expectedArtifactSha256: artifactHash,
    bindings: {
      chainId: 4663,
      expectedOwner: artifact.transaction.from,
      account: artifact.transaction.to,
      policyModule,
      punkCollection: artifact.reviewedAcquisition.controllingPunk.collection,
      punkTokenId: "1797",
      adapter: intent.adapter,
      venue: intent.venue,
      collection: intent.collection,
      tokenId: intent.tokenId,
      functionSelector: artifact.transaction.functionSelector,
      mintSelector: artifact.reviewedAcquisition.target.mintSelector,
      value: "0",
      dataKeccak256: artifact.transaction.dataKeccak256,
      intentDigest: artifact.reviewedAcquisition.intentDigest,
      accountRuntimeCodeHash: artifact.confirmedEvidence.hashes.punkAccountRuntimeCode,
      adapterRuntimeCodeHash: artifact.confirmedEvidence.hashes.adapterRuntimeCode,
      artRuntimeCodeHash: artifact.confirmedEvidence.hashes.venueRuntimeCode,
      coreManifestSha256: artifact.confirmedEvidence.hashes.coreManifest,
      canaryManifestSha256: artifact.confirmedEvidence.hashes.canaryManifest,
      nonce: "0",
      policyVersion: "11",
      expiresAt: intent.expiresAt,
    },
  };
  return { artifact, gate, policyModule };
}

function reviewedProvider({ artifact, gate, policyModule }, options = {}) {
  const owner = gate.bindings.expectedOwner;
  const calls = [];
  let chainReads = 0;
  let accountReads = 0;
  const provider = {
    async request({ method, params = [] }) {
      calls.push({ method, params });
      if (method === "eth_chainId") {
        chainReads += 1;
        return chainReads > 1 && options.finalChain ? options.finalChain : "0x1237";
      }
      if (method === "eth_accounts") {
        accountReads += 1;
        return [accountReads > 1 && options.finalAccount ? options.finalAccount : owner];
      }
      if (method === "eth_getBlockByNumber") return { timestamp: "0x42e" };
      if (method === "eth_getCode") {
        const target = params[0].toLowerCase();
        const code = target === gate.bindings.account.toLowerCase() ? ACCOUNT_CODE
          : target === gate.bindings.adapter.toLowerCase() ? ADAPTER_CODE
            : target === gate.bindings.venue.toLowerCase() ? ART_CODE : null;
        return options.code?.[target] ?? code;
      }
      if (method === "eth_call") {
        const [call] = params;
        if (call.to.toLowerCase() === gate.bindings.punkCollection.toLowerCase()) {
          return addressWord(owner);
        }
        if (call.to.toLowerCase() === policyModule.toLowerCase()) return uintWord(11n);
        if (call.data === "0x8da5cb5b") return addressWord(owner);
        if (call.data === "0xca10c956") return uintWord(0n);
        if (call.data === "0x893866f7") return addressWord(policyModule);
        if (call.data === artifact.transaction.data) return `0x${word(32n)}${word(0n)}`;
      }
      if (method === "eth_sendTransaction") return `0x${"9".repeat(64)}`;
      throw new Error(`unexpected ${method}`);
    },
  };
  return { provider, calls };
}

test("local Keccak-256 matches viem across EVM bytecode and rate-boundary vectors", () => {
  for (const length of [0, 1, 2, 31, 32, 135, 136, 137, 271, 272, 273, 1_000]) {
    const hex = `0x${Array.from({ length }, (_, index) => (index * 37 % 256)
      .toString(16).padStart(2, "0")).join("")}`;
    assert.equal(keccak256Hex(hex), keccak256(hex), `length ${length}`);
  }
  assert.throws(() => keccak256Hex("0x0"), /even-length/);
  assert.throws(() => keccak256Hex("not-hex"), /even-length/);
});

test("browser and Node canonical SHA-256 agree and calldata re-encodes byte-for-byte", async () => {
  const { artifact, gate } = await browserFixture();
  assert.equal(await canonicalExecutionSha256(artifact), canonicalSha256(artifact));
  assert.equal(
    encodeReviewedOwnerDirectCalldata(artifact.reviewedAcquisition.intent),
    artifact.transaction.data,
  );
  const validated = await validateCanaryExecutionArtifact(artifact, gate, { nowSeconds: 1_070 });
  assert.equal(validated.artifactSha256, gate.expectedArtifactSha256);
  assert.deepEqual(validated.transaction, {
    from: artifact.transaction.from,
    to: artifact.transaction.to,
    value: "0x0",
    data: artifact.transaction.data,
  });
  assert.equal(validated.remainingSeconds, 50n);
});

test("browser rejects status, hash, calldata, intent, price, owner, Punk, and TTL drift", async () => {
  const { artifact, gate } = await browserFixture();
  const cases = [
    ["closed gate", (a, g) => { g.capability = false; g.status = "NO_ACTIVE_REVIEW"; }],
    ["artifact hash", (a, g) => { g.expectedArtifactSha256 = `0x${"f".repeat(64)}`; }],
    ["calldata", (a) => { a.transaction.data = `${a.transaction.data.slice(0, -2)}01`; }],
    ["intent amount", (a) => { a.reviewedAcquisition.intent.assetAmount = "2"; }],
    ["price", (a) => { a.reviewedAcquisition.payment.maxPrice = "1"; }],
    ["owner", (a) => { a.transaction.from = "0x9999999999999999999999999999999999999999"; }],
    ["Punk", (a) => { a.reviewedAcquisition.controllingPunk.tokenId = "1798"; }],
    ["signature", (a) => { a.reviewedAcquisition.ownerSignature = "0x01"; }],
    ["manifest", (a) => { a.confirmedEvidence.hashes.coreManifest = `0x${"f".repeat(64)}`; }],
    ["account runtime", (a, g) => { g.bindings.accountRuntimeCodeHash = `0x${"f".repeat(64)}`; }],
    ["adapter runtime", (a, g) => { g.bindings.adapterRuntimeCodeHash = `0x${"f".repeat(64)}`; }],
    ["art runtime", (a, g) => { g.bindings.artRuntimeCodeHash = `0x${"f".repeat(64)}`; }],
  ];
  for (const [label, mutate] of cases) {
    const changedArtifact = structuredClone(artifact);
    const changedGate = structuredClone(gate);
    mutate(changedArtifact, changedGate);
    await assert.rejects(
      validateCanaryExecutionArtifact(changedArtifact, changedGate, { nowSeconds: 1_070 }),
      undefined,
      label,
    );
  }
  await assert.rejects(
    validateCanaryExecutionArtifact(artifact, gate, { nowSeconds: 1_091 }),
    /submission TTL/,
  );
});

test("wallet preflight rechecks live owner, nonce, module, policy, chain TTL, code, and exact call", async () => {
  const fixture = await browserFixture();
  const { artifact, gate } = fixture;
  const validated = await validateCanaryExecutionArtifact(artifact, gate, { nowSeconds: 1_070 });
  const { provider, calls } = reviewedProvider(fixture);
  const result = await preflightCanaryTransaction(provider, validated);
  assert.equal(result.selected, gate.bindings.expectedOwner);
  assert.equal(result.chainTimestamp, 1_070n);
  assert.equal(calls.some(({ method }) => method === "eth_sendTransaction"), false);
  assert.equal(calls.filter(({ method }) => method === "eth_call").length, 6);

  const wrongChain = { request: async ({ method }) => method === "eth_chainId" ? "0x1" : [] };
  await assert.rejects(preflightCanaryTransaction(wrongChain, validated), /Robinhood Chain/);
});

test("runtime code mutation fails closed before any wallet send", async () => {
  const fixture = await browserFixture();
  const validated = await validateCanaryExecutionArtifact(
    fixture.artifact,
    fixture.gate,
    { nowSeconds: 1_070 },
  );
  for (const target of [
    fixture.gate.bindings.account,
    fixture.gate.bindings.adapter,
    fixture.gate.bindings.venue,
  ]) {
    const { provider, calls } = reviewedProvider(fixture, {
      code: { [target.toLowerCase()]: "0x600f" },
    });
    await assert.rejects(
      submitCanaryTransaction(provider, validated, {
        refreshValidated: async () => validated,
        isCurrent: () => true,
      }),
      /runtime code/,
    );
    assert.equal(calls.some(({ method }) => method === "eth_sendTransaction"), false);
  }
});

test("submission rechecks status, chain, account, state revision, and sends one fixed payload", async () => {
  const fixture = await browserFixture();
  const validated = await validateCanaryExecutionArtifact(
    fixture.artifact,
    fixture.gate,
    { nowSeconds: 1_070 },
  );
  const success = reviewedProvider(fixture);
  const result = await submitCanaryTransaction(success.provider, validated, {
    refreshValidated: async () => validated,
    isCurrent: () => true,
  });
  assert.equal(result.hash, `0x${"9".repeat(64)}`);
  const sends = success.calls.filter(({ method }) => method === "eth_sendTransaction");
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].params, [{
    from: fixture.artifact.transaction.from,
    to: fixture.artifact.transaction.to,
    value: "0x0",
    data: fixture.artifact.transaction.data,
  }]);
  const simulations = success.calls.filter(({ method, params }) => method === "eth_call"
    && params[0]?.data === fixture.artifact.transaction.data);
  assert.equal(simulations.length, 2);
  assert.equal(Object.hasOwn(simulations[1].params[0], "chainId"), false);

  for (const options of [
    { finalChain: "0x1" },
    { finalAccount: "0x9999999999999999999999999999999999999999" },
  ]) {
    const raced = reviewedProvider(fixture, options);
    await assert.rejects(
      submitCanaryTransaction(raced.provider, validated, {
        refreshValidated: async () => validated,
        isCurrent: () => true,
      }),
    );
    assert.equal(raced.calls.some(({ method }) => method === "eth_sendTransaction"), false);
  }

  const invalidated = reviewedProvider(fixture);
  let stateChecks = 0;
  await assert.rejects(
    submitCanaryTransaction(invalidated.provider, validated, {
      refreshValidated: async () => validated,
      isCurrent: () => (stateChecks += 1) < 3,
    }),
    /state changed/,
  );
  assert.equal(invalidated.calls.some(({ method }) => method === "eth_sendTransaction"), false);
});

test("browser source keeps sending isolated, single-click, and outside read-only wallet code", async () => {
  const [executionSource, walletSource, html] = await Promise.all([
    readFile(new URL("../site/canary-execution.js", import.meta.url), "utf8"),
    readFile(new URL("../site/wallet.js", import.meta.url), "utf8"),
    readFile(new URL("../site/punk/index.html", import.meta.url), "utf8"),
  ]);
  assert.equal((executionSource.match(/"eth_sendTransaction"/g) ?? []).length, 1);
  assert.doesNotMatch(walletSource, /eth_sendTransaction/);
  assert.match(executionSource, /fetchExecutionGate/);
  assert.match(executionSource, /preflightCanaryTransaction/);
  assert.match(executionSource, /if \(submit\.disabled \|\| state\.submitting/);
  assert.doesNotMatch(executionSource, /localStorage|sessionStorage|privateKey|mnemonic/);
  assert.match(html, /type="file"/);
  assert.match(html, /Punk #1797/);
  assert.match(html, /pays network gas/);
});
