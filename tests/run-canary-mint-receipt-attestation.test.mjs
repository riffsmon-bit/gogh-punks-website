import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  AUTHORITATIVE_CANARY_MANIFEST,
  AUTHORITATIVE_CORE_MANIFEST,
  parseCanaryMintReceiptArguments,
  readStableCanaryMintJson,
  runCanaryMintReceiptAttestation,
} from "../scripts/run-canary-mint-receipt-attestation.mjs";
import {
  CANARY_MINT_RECEIPT_ATTESTATION_SCHEMA,
  CANARY_MINT_RECEIPT_PASS,
} from "../scripts/canary-mint-receipt-attestation.mjs";
import { validateCanaryMintRpcDependencies } from "../scripts/canary-mint-rpc-helper.mjs";
import { fixtureHash } from "./helpers/canary-mint-fixtures.mjs";

const argv = [
  "--proposal", "inputs/proposal.json",
  "--live-attestation", "inputs/live.json",
  "--config-bundle", "inputs/config.json",
  "--configuration-evidence", "inputs/config-evidence.json",
  "--execution-artifact", "inputs/execution.json",
  "--execution-receipt-evidence", "inputs/execution-receipt.json",
  "--confirmations", "20",
];

function rpcClient(descriptor) {
  const methods = {
    transport: { url: descriptor.href,
      async request() { throw new Error("arbitrary transport request must not be copied"); } },
    async getChainId() { return 4663; }, async getBlockNumber() { return 100n; },
    async getBlock() { return {}; }, async getTransaction() { return {}; },
    async getTransactionReceipt() { return {}; }, async getCode() { return "0x"; },
    async getStorageAt() { return undefined; }, async getBalance() { return 0n; },
    async getLogs() { return []; }, async readContract() { return undefined; },
  };
  methods.sendTransaction = async () => { throw new Error("must not be copied"); };
  return methods;
}

function forbiddenCallablePaths(value, path = "client", seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const found = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) continue;
    if (typeof descriptor.value === "function"
      && /^(?:request|send|sendTransaction|sendRawTransaction|writeContract|sign|deploy)/i.test(key)) {
      found.push(`${path}.${key}`);
    } else {
      found.push(...forbiddenCallablePaths(descriptor.value, `${path}.${key}`, seen));
    }
  }
  return found;
}

function result() {
  return {
    schema: CANARY_MINT_RECEIPT_ATTESTATION_SCHEMA,
    status: CANARY_MINT_RECEIPT_PASS,
    chainId: 4663,
    evidenceHashes: {
      executionReceiptEvidenceSha256: fixtureHash("1"),
      executionReceiptEvidenceArtifactSha256: fixtureHash("2"),
      executionArtifactSha256: fixtureHash("3"),
      coreManifestSha256: fixtureHash("4"),
      canaryManifestSha256: fixtureHash("5"),
    },
    transaction: {},
    receipt: { status: "success", blockNumber: "80", blockHash: fixtureHash("6"),
      blockTimestamp: "100", parentBlockHash: fixtureHash("7"), transactionIndex: "0",
      logCount: 4, firstLogIndex: "0", lastLogIndex: "3" },
    confirmedPin: { confirmations: 20 },
    events: {}, preMintState: {}, postMintState: {}, confirmedState: {}, continuity: {},
    sourceVerification: {},
    safetyBoundary: { readOnly: true, transactionAuthorized: false, signingPerformed: false,
      submissionPerformed: false, chainWritePerformed: false, deploymentPerformed: false,
      walletMethodsPresent: false },
  };
}

function readFixtures(reads) {
  return async (path, maximumBytes, label) => {
    reads.push({ path, maximumBytes, label });
    if (path === AUTHORITATIVE_CORE_MANIFEST) return { kind: "core" };
    if (path === AUTHORITATIVE_CANARY_MANIFEST) return { kind: "canary" };
    return { kind: label };
  };
}

const environment = {
  ROBINHOOD_RPC_URL: "https://alpha-rpc.example/api/key",
  ROBINHOOD_SECONDARY_RPC_URL: "https://beta-rpc.test/v1",
};

test("runner parses six artifacts plus confirmations and rejects operational flags", () => {
  assert.deepEqual(parseCanaryMintReceiptArguments(argv), {
    paths: {
      proposalArtifact: resolve("inputs/proposal.json"),
      liveAttestation: resolve("inputs/live.json"),
      configBundleArtifact: resolve("inputs/config.json"),
      configurationEvidenceArtifact: resolve("inputs/config-evidence.json"),
      executionArtifact: resolve("inputs/execution.json"),
      executionReceiptEvidence: resolve("inputs/execution-receipt.json"),
    },
    confirmations: 20,
  });
  for (const args of [
    [], argv.slice(0, -4), [...argv, "--private-key", "secret"],
    [...argv, "--transaction-hash", fixtureHash("1")],
    argv.map((item) => item === "inputs/proposal.json" ? "inputs/*.json" : item),
  ]) assert.throws(() => parseCanaryMintReceiptArguments(args));
});

test("runner pins authoritative manifests, copies only read methods, and passes real clock", async () => {
  const reads = [];
  let observed;
  const clock = () => 123_456;
  const output = await runCanaryMintReceiptAttestation(argv, {
    environment,
    clock,
    readJson: readFixtures(reads),
    clientFactory: rpcClient,
    attestor: async (inputs, clients, options, attestorClock) => {
      observed = { inputs, clients, options, attestorClock };
      validateCanaryMintRpcDependencies(clients);
      return result();
    },
  });
  assert.equal(output.status, CANARY_MINT_RECEIPT_PASS);
  assert.deepEqual(reads.map(({ path }) => path), [
    AUTHORITATIVE_CORE_MANIFEST,
    AUTHORITATIVE_CANARY_MANIFEST,
    resolve("inputs/proposal.json"), resolve("inputs/live.json"), resolve("inputs/config.json"),
    resolve("inputs/config-evidence.json"), resolve("inputs/execution.json"),
    resolve("inputs/execution-receipt.json"),
  ]);
  assert.deepEqual(observed.inputs.coreManifest, { kind: "core" });
  assert.deepEqual(observed.inputs.canaryManifest, { kind: "canary" });
  assert.deepEqual(observed.options, { confirmations: 20 });
  assert.equal(observed.attestorClock, clock);
  assert.equal(observed.attestorClock(), 123_456);
  assert.equal(Object.hasOwn(observed.clients.primaryClient, "sendTransaction"), false);
  assert.equal(Object.isFrozen(observed.clients.primaryClient), true);
  assert.deepEqual(Reflect.ownKeys(observed.clients.primaryClient.transport), ["url"]);
  assert.equal(Object.isFrozen(observed.clients.primaryClient.transport), true);
  assert.equal(observed.clients.primaryClient.transport.request, undefined);
  assert.deepEqual(forbiddenCallablePaths(observed.clients.primaryClient), []);
  assert.deepEqual(forbiddenCallablePaths(observed.clients.secondaryClient), []);
});

test("runner rejects same-provider domains, unknown dependencies, and malformed results", async () => {
  const common = { readJson: readFixtures([]), clientFactory: rpcClient, clock: () => 123_456 };
  await assert.rejects(runCanaryMintReceiptAttestation(argv, {
    ...common,
    environment: { ROBINHOOD_RPC_URL: "https://a.provider.example/x",
      ROBINHOOD_SECONDARY_RPC_URL: "https://b.provider.example/y" },
    attestor: async (_inputs, clients) => {
      validateCanaryMintRpcDependencies(clients);
      return result();
    },
  }), (error) => error.code === "DUPLICATE_RPC");
  await assert.rejects(runCanaryMintReceiptAttestation(argv, {
    ...common, environment, secret: "nope", attestor: async () => result(),
  }), (error) => error.code === "INVALID_DEPENDENCIES");
  await assert.rejects(runCanaryMintReceiptAttestation(argv, {
    ...common, environment, clock: 123_456, attestor: async () => result(),
  }), (error) => error.code === "INVALID_TIME");
  await assert.rejects(runCanaryMintReceiptAttestation(argv, {
    ...common,
    environment,
    clientFactory: (descriptor) => {
      const client = rpcClient(descriptor);
      client.transport.url = "https://forged-rpc.example/api";
      return client;
    },
    attestor: async () => result(),
  }), (error) => error.code === "RPC_PROVENANCE_MISMATCH");
  const bad = result();
  bad.safetyBoundary.transactionAuthorized = true;
  await assert.rejects(runCanaryMintReceiptAttestation(argv, {
    ...common, environment, attestor: async () => bad,
  }), (error) => error.code === "INVALID_ATTESTATION_RESULT");
  const extra = result();
  extra.wallet = "0x";
  await assert.rejects(runCanaryMintReceiptAttestation(argv, {
    ...common, environment, attestor: async () => extra,
  }), (error) => error.code === "INVALID_ATTESTATION_RESULT");
});

test("stable reader uses O_NOFOLLOW, rejects symlinks, and detects changed files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gogh-mint-runner-"));
  const path = join(directory, "artifact.json");
  await writeFile(path, JSON.stringify({ ok: true }));
  assert.deepEqual(await readStableCanaryMintJson(path, 1_000, "artifact"), { ok: true });
  const link = join(directory, "link.json");
  await symlink(path, link);
  await assert.rejects(readStableCanaryMintJson(link, 1_000, "artifact"),
    (error) => error.code === "FILE_READ_FAILED");

  const before = { isFile: () => true, size: 2n, dev: 1n, ino: 2n,
    mtimeNs: 3n, ctimeNs: 4n };
  const after = { ...before, mtimeNs: 5n };
  let statCount = 0;
  const handle = { async stat() { return statCount++ === 0 ? before : after; },
    async readFile() { return Buffer.from("{}", "utf8"); }, async close() {} };
  await assert.rejects(readStableCanaryMintJson("changed.json", 1_000, "changed",
    async () => handle), (error) => error.code === "FILE_CHANGED");
});

test("runner source has no wallet/sign/send/write/deploy API and emits stdout only", async () => {
  const source = await readFile(new URL(
    "../scripts/run-canary-mint-receipt-attestation.mjs",
    import.meta.url,
  ), "utf8");
  assert.doesNotMatch(source, /createWalletClient|privateKeyToAccount|mnemonicToAccount/);
  assert.doesNotMatch(source, /\.sendTransaction\(|\.writeContract\(|\.deployContract\(/);
  assert.doesNotMatch(source, /transport:\s*raw\.transport|\.transport\.request\(/);
  assert.doesNotMatch(source, /writeFile|appendFile/);
  assert.match(source, /process\.stdout\.write/);
  assert.match(source, /AUTHORITATIVE_CORE_MANIFEST/);
  assert.match(source, /AUTHORITATIVE_CANARY_MANIFEST/);
});
