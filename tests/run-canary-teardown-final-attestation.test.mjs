import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseCanaryTeardownFinalArguments,
  runCanaryTeardownFinalAttestation,
  sanitizedCanaryTeardownFinalFailure,
} from "../scripts/run-canary-teardown-final-attestation.mjs";
import { CanaryTeardownFinalAttestationError } from
  "../scripts/canary-teardown-final-attestation.mjs";

const FLAGS = Object.freeze([
  "--proposal", "/tmp/proposal.json",
  "--live-attestation", "/tmp/live.json",
  "--config-bundle", "/tmp/config.json",
  "--configuration-evidence", "/tmp/config-receipt.json",
  "--execution-artifact", "/tmp/execution.json",
  "--execution-receipt-evidence", "/tmp/execution-receipt.json",
  "--mint-attestation", "/tmp/mint.json",
  "--teardown-receipt-evidence", "/tmp/teardown.json",
  "--confirmations", "20",
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function passArtifact(confirmations = 20, extra = {}) {
  const body = {
    schema: "GOGH_OWNER_DIRECT_CANARY_FINAL_TEARDOWN_ATTESTATION_V1",
    status: "READ_ONLY_FINAL_TEARDOWN_PASS",
    readOnly: true,
    transactionAuthorized: false,
    signingPerformed: false,
    submissionPerformed: false,
    chainWritePerformed: false,
    chainId: 4663,
    evidenceHashes: {},
    confirmedBlock: { confirmations },
    latestFinalCheck: {},
    punk: {},
    acquisition: {},
    teardownHistory: {
      transactionCount: 11,
      status: "EXACT_11_ORDERED_TX_RECEIPTS_AND_TARGET_EVENTS_DUAL_RPC_VERIFIED",
    },
    finalState: {},
    timing: {},
    limitations: [],
    ...extra,
  };
  return Object.freeze({
    ...body,
    attestationSha256: `0x${createHash("sha256").update(canonicalJson(body)).digest("hex")}`,
  });
}

function rawReadClient(href) {
  const unavailable = async () => { throw new Error("unused read"); };
  return {
    transport: {
      url: href,
      request: async () => { throw new Error("must not be exposed"); },
    },
    getChainId: unavailable,
    getBlockNumber: unavailable,
    getBlock: unavailable,
    getTransaction: unavailable,
    getTransactionReceipt: unavailable,
    getCode: unavailable,
    getStorageAt: unavailable,
    getBalance: unavailable,
    getLogs: unavailable,
    readContract: unavailable,
    sendTransaction: async () => { throw new Error("must not be exposed"); },
  };
}

test("parses exactly eight artifact paths and bounded confirmation depth", () => {
  const parsed = parseCanaryTeardownFinalArguments(FLAGS);
  assert.equal(Object.keys(parsed.paths).length, 8);
  assert.equal(parsed.confirmations, 20);
  assert.throws(() => parseCanaryTeardownFinalArguments(FLAGS.slice(0, -4)),
    /required/);
  assert.throws(() => parseCanaryTeardownFinalArguments([...FLAGS, "--unknown", "x.json"]),
    /unknown/);
  const shallow = [...FLAGS];
  shallow[shallow.length - 1] = "11";
  assert.throws(() => parseCanaryTeardownFinalArguments(shallow), /12 through 128/);
});

test("binds fixed manifests, exposes only read methods, and returns a hash-checked pass", async () => {
  let bound;
  let attested;
  const result = await runCanaryTeardownFinalAttestation(FLAGS, {
    environment: {
      ROBINHOOD_RPC_URL: "https://primary.provider.example/v1/secret-one",
      ROBINHOOD_SECONDARY_RPC_URL: "https://secondary.provider.test/v1/secret-two",
    },
    readJson: async (_path, _maximum, label) => ({ label }),
    binder: (artifacts) => {
      bound = artifacts;
      return Object.freeze({ exact: "bound-context" });
    },
    clientFactory: (descriptor) => rawReadClient(descriptor.href),
    attestor: async (input) => {
      attested = input;
      assert.equal(input.teardownContext.exact, "bound-context");
      assert.equal(input.primaryClient.sendTransaction, undefined);
      assert.equal(input.secondaryClient.sendTransaction, undefined);
      assert.equal(input.primaryClient.transport.request, undefined);
      assert.equal(input.secondaryClient.transport.request, undefined);
      assert.ok(Object.isFrozen(input.primaryClient.transport));
      assert.ok(Object.isFrozen(input.secondaryClient.transport));
      assert.deepEqual(input.endpointOrigins, [
        "https://primary.provider.example",
        "https://secondary.provider.test",
      ]);
      return passArtifact(input.confirmations);
    },
  });
  assert.equal(bound.coreManifest.label, "authoritative core manifest");
  assert.equal(bound.canaryManifest.label, "authoritative canary manifest");
  assert.equal(bound.proposalArtifact.label, "proposalArtifact");
  assert.equal(attested.confirmations, 20);
  assert.equal(result.status, "READ_ONLY_FINAL_TEARDOWN_PASS");
  assert.ok(Object.isFrozen(result));
});

test("rejects exact raw transport mismatch, dependency accessors, and extra output fields", async () => {
  const base = {
    environment: {
      ROBINHOOD_RPC_URL: "https://primary.provider.example/rpc",
      ROBINHOOD_SECONDARY_RPC_URL: "https://secondary.provider.test/rpc",
    },
    readJson: async () => ({}),
    binder: () => ({}),
    attestor: async () => passArtifact(),
  };
  await assert.rejects(() => runCanaryTeardownFinalAttestation(FLAGS, {
    ...base,
    clientFactory: () => rawReadClient("https://miswired.provider.invalid/rpc"),
  }), /transport URL differs/);

  await assert.rejects(() => runCanaryTeardownFinalAttestation(FLAGS, {
    ...base,
    clientFactory: (descriptor) => rawReadClient(
      descriptor.origin === "https://primary.provider.example"
        ? "https://primary.provider.example/wrong-path"
        : descriptor.href,
    ),
  }), /transport URL differs/);

  let reads = 0;
  const accessorDependencies = { ...base };
  Object.defineProperty(accessorDependencies, "clientFactory", {
    enumerable: true,
    get() { reads += 1; return () => rawReadClient("https://never.example"); },
  });
  await assert.rejects(() => runCanaryTeardownFinalAttestation(FLAGS, accessorDependencies),
    /must be enumerable data/);
  assert.equal(reads, 0);

  await assert.rejects(() => runCanaryTeardownFinalAttestation(FLAGS, {
    ...base,
    clientFactory: (descriptor) => rawReadClient(descriptor.href),
    attestor: async () => passArtifact(20, { injected: true }),
  }), /unknown or missing top-level fields/);
});

test("sanitizes RPC URLs and source has no signing, submission, or filesystem-write path", async () => {
  const error = new CanaryTeardownFinalAttestationError(
    "LIVE_READ_FAILED",
    "failed https://rpc.example/path?apikey=super-secret-token",
  );
  const sanitized = sanitizedCanaryTeardownFinalFailure(error);
  assert.doesNotMatch(sanitized, /super-secret-token|apikey=/);

  const source = await readFile(new URL(
    "../scripts/run-canary-teardown-final-attestation.mjs",
    import.meta.url,
  ), "utf8");
  assert.doesNotMatch(source, /createWalletClient|privateKeyToAccount|signTypedData/);
  assert.doesNotMatch(source, /sendTransaction|writeContract|eth_sendRawTransaction/);
  assert.doesNotMatch(source, /writeFile|appendFile|simulateContract/);
});
