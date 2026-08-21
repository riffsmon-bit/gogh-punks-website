import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ROBINHOOD } from "../broker/src/config.mjs";
import {
  attestCanaryMintReceipt,
  CANARY_MINT_RECEIPT_ABIS,
  CANARY_MINT_RECEIPT_ATTESTATION_SCHEMA,
  CANARY_MINT_RECEIPT_PASS,
  canonicalCanaryMintAttestationSha256,
  validateCanaryMintReceiptAttestationArtifact,
} from "../scripts/canary-mint-receipt-attestation.mjs";
import {
  canonicalCanaryMintRpcValue,
  dualCanaryMintRead,
  validateCanaryMintRpcDependencies,
} from "../scripts/canary-mint-rpc-helper.mjs";
import {
  ACCOUNT,
  ADAPTER,
  ART,
  fixtureAddress,
  fixtureHash,
  MINT_TX_HASH,
  OWNER,
  PARENT_BLOCK_HASH,
  PUNK_TOKEN_ID,
  RECEIPT_BLOCK_HASH,
  RECEIPT_TIMESTAMP,
  TRANSACTION_INDEX,
  ZERO_ADDRESS,
} from "./helpers/canary-mint-fixtures.mjs";
import {
  attestCanaryMintFixture as pass,
  canaryMintEventLog as eventLog,
  canaryMintRpcDependencies as dependencies,
  createCanaryMintWorld as createWorld,
} from "./helpers/canary-mint-attestation-world.mjs";

function sequenceClock(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test("dual-RPC attestor returns one exact non-authorizing mint receipt pass", async () => {
  const world = createWorld();
  const result = await pass(world);
  assert.equal(result.schema, CANARY_MINT_RECEIPT_ATTESTATION_SCHEMA);
  assert.equal(result.status, CANARY_MINT_RECEIPT_PASS);
  assert.equal(result.transaction.hash, MINT_TX_HASH);
  assert.equal(result.receipt.blockHash, RECEIPT_BLOCK_HASH);
  assert.equal(result.receipt.parentBlockHash, PARENT_BLOCK_HASH);
  assert.equal(result.receipt.logCount, 4);
  assert.equal(result.postMintState.nft.owner, ACCOUNT);
  assert.equal(result.confirmedState.acquisitionNonce, "1");
  assert.equal(result.safetyBoundary.transactionAuthorized, false);
  assert.equal(result.confirmedPin.maximumAgeSeconds, 300);
  assert.equal(result.continuity.noUnexpectedScannedProtocolEventsThroughConfirmedPin, true);
  assert.equal(result.continuity.unrelatedDirectTokenReceiptsChecked, false);
  assert.equal(canonicalCanaryMintAttestationSha256(result).length, 66);
  assert.deepEqual(validateCanaryMintReceiptAttestationArtifact(result, world.fixtures), result);
});

test("realistic omitted log.removed and optional undefined viem fields are accepted", async () => {
  const world = createWorld();
  assert.equal(Object.hasOwn(world.logs[0], "removed"), false);
  assert.equal(Object.hasOwn(world.transaction, "maxFeePerBlobGas"), true);
  assert.equal((await pass(world)).status, CANARY_MINT_RECEIPT_PASS);
});

test("default empty options use the default confirmation count", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Number(RECEIPT_TIMESTAMP) * 1_000 });
  const world = createWorld();
  const result = await attestCanaryMintReceipt(world.fixtures, dependencies(world), {});
  assert.equal(result.confirmedPin.confirmations, 20);
});

const adversarial = [
  ["wrong chain", (a) => { a.primary.chainId = 1; }, "WRONG_CHAIN"],
  ["forged sender", (a) => { a.primary.transaction.from = fixtureAddress("f"); }, "RPC_DISAGREEMENT"],
  ["forged destination on both RPCs", (a) => {
    a.primary.transaction.to = fixtureAddress("f"); a.secondary.transaction.to = fixtureAddress("f");
  }, "TRANSACTION_MISMATCH"],
  ["nonzero transaction value", (a) => {
    a.primary.transaction.value = 1n; a.secondary.transaction.value = 1n;
  }, "NONZERO_PAYMENT"],
  ["forged calldata", (a) => {
    a.primary.transaction.input = "0x1234"; a.secondary.transaction.input = "0x1234";
  }, "CALLDATA_MISMATCH"],
  ["failed receipt", (a) => {
    a.primary.receipt.status = "reverted"; a.secondary.receipt.status = "reverted";
  }, "RPC_READ_FAILED"],
  ["wrong receipt block", (a) => { a.secondary.receipt.blockHash = fixtureHash("f"); },
    "RPC_DISAGREEMENT"],
  ["transaction absent at receipt index", (a) => {
    a.primary.transaction.transactionIndex = 2n; a.secondary.transaction.transactionIndex = 2n;
    a.primary.receipt.transactionIndex = 2n; a.secondary.receipt.transactionIndex = 2n;
    for (const world of [a.primary, a.secondary]) {
      world.logs = world.logs.map((log) => ({ ...log, transactionIndex: 2n }));
      world.receipt.logs = world.logs;
    }
  }, "TRANSACTION_NOT_IN_BLOCK"],
  ["unexpected fifth receipt log", (a) => {
    for (const world of [a.primary, a.secondary]) {
      world.logs.push({ ...world.logs[3], logIndex: 14n }); world.receipt.logs = world.logs;
    }
  }, "RPC_READ_FAILED"],
  ["wrong event emitter", (a) => {
    for (const world of [a.primary, a.secondary]) {
      world.logs[1] = { ...world.logs[1], address: fixtureAddress("f") };
      world.receipt.logs = world.logs;
    }
  }, "UNEXPECTED_LOG_EMITTER"],
  ["wrong minted token event", (a) => {
    for (const world of [a.primary, a.secondary]) {
      world.logs[1] = eventLog(CANARY_MINT_RECEIPT_ABIS.transferEvent,
        { from: ZERO_ADDRESS, to: ACCOUNT, tokenId: 9002n }, ART, 11n);
      world.receipt.logs = world.logs;
    }
  }, "EVENT_MISMATCH"],
  ["duplicate log index", (a) => {
    for (const world of [a.primary, a.secondary]) {
      world.logs[2] = { ...world.logs[2], logIndex: 11n }; world.receipt.logs = world.logs;
    }
  }, "LOG_ORDER_MISMATCH"],
  ["removed receipt log", (a) => {
    for (const world of [a.primary, a.secondary]) {
      world.logs[0] = { ...world.logs[0], removed: true }; world.receipt.logs = world.logs;
    }
  }, "RPC_READ_FAILED"],
  ["receipt outside intent TTL", (a) => { a.primary.timestampOffset = 100n; }, "unused"],
  ["parent ancestry mismatch", (a) => {
    a.primary.parentHashOverride = fixtureHash("f"); a.secondary.parentHashOverride = fixtureHash("f");
  }, "BLOCK_ANCESTRY_MISMATCH"],
  ["minted prestate already true", (a) => {
    a.primary.parentMinted = true; a.secondary.parentMinted = true;
  }, "STATE_MISMATCH"],
  ["native balance changed", (a) => {
    a.primary.nativeBalanceAfter = 41n; a.secondary.nativeBalanceAfter = 41n;
  }, "NATIVE_BALANCE_CHANGED"],
  ["owner changed", (a) => { a.primary.owner = fixtureAddress("f"); }, "RPC_DISAGREEMENT"],
  ["nonce did not consume", (a) => {
    a.primary.accountNonce = 0n; a.secondary.accountNonce = 0n;
  }, "NONCE_MISMATCH"],
  ["policy version changed", (a) => {
    a.primary.policyVersion = 12n; a.secondary.policyVersion = 12n;
  }, "STATE_MISMATCH"],
  ["NFT owner mismatch", (a) => {
    a.primary.artOwner = OWNER; a.secondary.artOwner = OWNER;
  }, "NFT_STATE_MISMATCH"],
  ["token approval remains", (a) => {
    a.primary.artApproved = ADAPTER; a.secondary.artApproved = ADAPTER;
  }, "NFT_APPROVAL_MISMATCH"],
  ["runtime hash mismatch", (a) => {
    a.primary.runtimeCodes.set(ADAPTER, "0x60ff");
    a.secondary.runtimeCodes.set(ADAPTER, "0x60ff");
  }, "CODE_HASH_MISMATCH"],
  ["proxy implementation slot set", (a) => {
    const slot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
    a.primary.storage.set(`${ADAPTER}:${slot}`, fixtureHash("1"));
    a.secondary.storage.set(`${ADAPTER}:${slot}`, fixtureHash("1"));
  }, "PROXY_DETECTED"],
];

for (const [name, mutate, expectedCode] of adversarial) {
  if (name === "receipt outside intent TTL") continue;
  test(`fails closed: ${name}`, async () => {
    const primary = createWorld();
    const secondary = createWorld(primary.fixtures);
    mutate({ primary, secondary });
    await assert.rejects(pass(primary, secondary), (error) => error.code === expectedCode);
  });
}

test("fails closed on stale dual-RPC pin", async () => {
  const world = createWorld();
  await assert.rejects(pass(world, world, {}, () => Number(RECEIPT_TIMESTAMP + 301n)),
    (error) => error.code === "STALE_RPC_PIN");
});

test("fails closed when a once-fresh pin becomes stale before the closing clock sample", async () => {
  const world = createWorld();
  await assert.rejects(pass(world, world, {}, sequenceClock(
    Number(RECEIPT_TIMESTAMP + 250n),
    Number(RECEIPT_TIMESTAMP + 301n),
  )), (error) => error.code === "STALE_RPC_PIN");
});

test("fails closed when a delayed read-only run exceeds the two-minute bound", async () => {
  const world = createWorld();
  await assert.rejects(pass(world, world, {}, sequenceClock(
    Number(RECEIPT_TIMESTAMP),
    Number(RECEIPT_TIMESTAMP + 121n),
  )), (error) => error.code === "ATTESTATION_TIMEOUT");
});

test("fails closed when the injected clock rolls backwards", async () => {
  const world = createWorld();
  await assert.rejects(pass(world, world, {}, sequenceClock(
    Number(RECEIPT_TIMESTAMP),
    Number(RECEIPT_TIMESTAMP - 1n),
  )), (error) => error.code === "CLOCK_ROLLBACK");
});

test("fails closed on receipt mined after intent expiration", async () => {
  const primary = createWorld();
  const secondary = createWorld(primary.fixtures);
  primary.receiptTimestampOverride = 1_121n;
  secondary.receiptTimestampOverride = 1_121n;
  await assert.rejects(pass(primary, secondary, {}, () => 1_121),
    (error) => error.code === "STALE_EXECUTION");
});

test("fails closed on a same-block later policy mutation", async () => {
  const primary = createWorld();
  const secondary = createWorld(primary.fixtures);
  for (const world of [primary, secondary]) {
    world.extraLogs.push({ ...world.logs[0], transactionHash: fixtureHash("f"),
      transactionIndex: TRANSACTION_INDEX + 1n, logIndex: 14n });
  }
  await assert.rejects(pass(primary, secondary), (error) => error.code === "POST_MINT_MUTATION");
});

test("fails closed on controlling Punk transfer continuity evidence", async () => {
  const primary = createWorld();
  const secondary = createWorld(primary.fixtures);
  const ownership = eventLog(CANARY_MINT_RECEIPT_ABIS.transferEvent, {
    from: OWNER, to: fixtureAddress("f"), tokenId: BigInt(PUNK_TOKEN_ID),
  }, ROBINHOOD.canonicalCollection, 14n, { transactionHash: fixtureHash("f"),
    transactionIndex: TRANSACTION_INDEX + 1n });
  primary.extraLogs.push(ownership);
  secondary.extraLogs.push(structuredClone(ownership));
  await assert.rejects(pass(primary, secondary), (error) => error.code === "POST_MINT_MUTATION");
});

test("execution evidence tampering is rejected before RPC reads", async () => {
  const world = createWorld();
  world.fixtures.executionReceiptEvidence.evidence.transaction.hash = fixtureHash("f");
  await assert.rejects(pass(world), (error) => error.code === "EVIDENCE_HASH_MISMATCH");
});

test("strict input snapshot rejects custom prototypes, accessors, and Proxies", async () => {
  for (const mutate of [
    (value) => Object.setPrototypeOf(value.executionReceiptEvidence.evidence, { poisoned: true }),
    (value) => Object.defineProperty(value, "executionArtifact", { enumerable: true,
      get() { throw new Error("must not execute"); } }),
  ]) {
    const world = createWorld();
    mutate(world.fixtures);
    await assert.rejects(pass(world));
  }
  const world = createWorld();
  const proxied = new Proxy(world.fixtures, {
    getOwnPropertyDescriptor(target, key) {
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  await assert.rejects(attestCanaryMintReceipt(proxied, dependencies(world),
    { confirmations: 20 }, () => Number(RECEIPT_TIMESTAMP)),
  (error) => error.code === "UNCLONEABLE_INPUT");
});

test("RPC helper rejects origin forgery, same provider, and write-capable clients", () => {
  const world = createWorld();
  const deps = dependencies(world);
  deps.primaryClient.transport.url = "https://forged.example/api";
  assert.throws(() => validateCanaryMintRpcDependencies(deps),
    (error) => error.code === "RPC_PROVENANCE_MISMATCH");

  const same = dependencies(world);
  same.secondaryClient.transport.url = "https://other.alpha-rpc.example/api";
  same.endpointOrigins[1] = "https://other.alpha-rpc.example";
  assert.throws(() => validateCanaryMintRpcDependencies(same),
    (error) => error.code === "DUPLICATE_RPC");

  const write = dependencies(world);
  write.primaryClient.sendTransaction = async () => fixtureHash("f");
  assert.throws(() => validateCanaryMintRpcDependencies(write),
    (error) => error.code === "WRITE_CAPABLE_RPC_CLIENT");
});

test("type-injective RPC canonicalization rejects sentinel-object collisions", async () => {
  assert.notEqual(canonicalCanaryMintRpcValue(undefined, "undefined"),
    canonicalCanaryMintRpcValue({ __rpcUndefined: true }, "object"));
  assert.notEqual(canonicalCanaryMintRpcValue(1n, "bigint"),
    canonicalCanaryMintRpcValue({ __rpcBigInt: "1" }, "object"));
  const world = createWorld();
  const deps = validateCanaryMintRpcDependencies(dependencies(world));
  await assert.rejects(dualCanaryMintRead(deps, "collision", (_, index) => (
    index === 0 ? undefined : { __rpcUndefined: true }
  )), (error) => error.code === "RPC_DISAGREEMENT");
});

test("receipt modules expose no wallet, signer, send, deploy, or file-write path", async () => {
  const source = (await Promise.all([
    readFile(new URL("../scripts/canary-mint-receipt-attestation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/canary-mint-rpc-helper.mjs", import.meta.url), "utf8"),
    readFile(new URL("../broker/src/recommendation/canary-execution-receipt-evidence.mjs",
      import.meta.url), "utf8"),
  ])).join("\n");
  assert.doesNotMatch(source, /createWalletClient|privateKeyToAccount|mnemonicToAccount/);
  assert.doesNotMatch(source, /\.sendTransaction\(|\.writeContract\(|\.deployContract\(/);
  assert.doesNotMatch(source, /writeFile|appendFile/);
  assert.match(source, /transactionAuthorized:\s*false/);
});
