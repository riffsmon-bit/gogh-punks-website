import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, toFunctionSelector } from "viem";
import {
  EIP1967_SLOTS,
  inspectFreeMintTarget,
  parseBlockscoutAbiEvidence,
  parseBlockscoutAbiResponse,
  parseInspectArguments,
} from "../scripts/inspect-free-mint-target.mjs";

const target = "0x1111111111111111111111111111111111111111";
const collection = "0x2222222222222222222222222222222222222222";
const implementation = "0x3333333333333333333333333333333333333333";
const blockHash = `0x${"ab".repeat(32)}`;
const runtimeBytecode = "0x6001600055";
const implementationBytecode = "0x60006000";
const zeroWord = `0x${"0".repeat(64)}`;

function storageWord(address) {
  return `0x${"0".repeat(24)}${address.slice(2)}`;
}

function verifiedAbiResponse(abi) {
  return {
    status: "1",
    message: "OK",
    result: JSON.stringify(abi),
  };
}

function boundAbiEvidence(abi, overrides = {}) {
  return {
    chainId: 4663,
    target,
    runtimeCodeHash: keccak256(runtimeBytecode),
    response: verifiedAbiResponse(abi),
    ...overrides,
  };
}

function mintFunction(overrides = {}) {
  return {
    type: "function",
    name: "freeMint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
    ...overrides,
  };
}

function fakeClient(overrides = {}) {
  const calls = [];
  const client = {
    async getChainId() {
      calls.push({ method: "getChainId" });
      return 4663;
    },
    async getBlockNumber() {
      calls.push({ method: "getBlockNumber" });
      return 120n;
    },
    async getBlock(args) {
      calls.push({ method: "getBlock", args });
      return { number: 100n, hash: blockHash, timestamp: 1_777_777_777n };
    },
    async getBytecode(args) {
      calls.push({ method: "getBytecode", args });
      if (args.address === target) return runtimeBytecode;
      if (args.address === implementation) return implementationBytecode;
      return undefined;
    },
    async getStorageAt(args) {
      calls.push({ method: "getStorageAt", args });
      if (args.slot === EIP1967_SLOTS.implementation) return storageWord(implementation);
      return zeroWord;
    },
    ...overrides,
  };
  return { client, calls };
}

test("pins a confirmed Robinhood block and reports runtime and EIP-1967 facts", async () => {
  for (const slot of Object.values(EIP1967_SLOTS)) assert.match(slot, /^0x[0-9a-f]{64}$/);
  const selector = toFunctionSelector("freeMint(address,uint256)");
  const { client, calls } = fakeClient();
  const report = await inspectFreeMintTarget({
    target,
    expectedCollection: collection,
    expectedSelector: selector,
    expectedAssetStandard: "ERC721",
    confirmations: 20,
    blockscoutAbiEvidence: boundAbiEvidence([mintFunction()]),
  }, { publicClient: client });

  assert.equal(report.mode, "READ_ONLY_FACTS");
  assert.deepEqual(report.chain, { expectedChainId: 4663, observedChainId: 4663 });
  assert.equal(report.pinnedBlock.number, "100");
  assert.equal(report.pinnedBlock.observedHead, "120");
  assert.equal(report.pinnedBlock.confirmations, 20);
  assert.equal(report.runtime.byteLength, 5);
  assert.equal(report.runtime.codeHash, keccak256(runtimeBytecode));
  assert.equal(report.eip1967.implementation.address, implementation);
  assert.equal(report.eip1967.implementation.runtime.codeHash, keccak256(implementationBytecode));
  assert.equal(report.eip1967.admin.status, "EMPTY");
  assert.equal(report.eip1967.beacon.status, "EMPTY");
  assert.equal(report.eip1967.proxySignal, "EIP1967_IMPLEMENTATION_OR_BEACON_SLOT_SET");
  assert.deepEqual(report.expectations.collection, {
    value: collection,
    status: "SUPPLIED_NOT_VERIFIED",
  });
  assert.equal(report.narrowZeroCostAdapterShape.matches, true);
  assert.equal(
    report.narrowZeroCostAdapterShape.status,
    "MATCHES_BOUND_VERIFIED_NARROW_CALL_SHAPE",
  );
  assert.equal(report.narrowZeroCostAdapterShape.uniqueFunction.signature, "freeMint(address,uint256)");
  assert.equal(report.narrowZeroCostAdapterShape.zeroCostSemantics, "UNVERIFIED");
  assert.equal(report.verifiedAbi.status, "BOUND_BLOCKSCOUT_GETABI_SUCCESS");
  assert.deepEqual(report.verifiedAbi.binding, {
    chainId: 4663,
    target,
    runtimeCodeHash: keccak256(runtimeBytecode),
    status: "BOUND_TO_PINNED_RUNTIME",
  });
  assert.equal(report.provenance.status, "SINGLE_RPC_UNCORROBORATED");
  assert.deepEqual(report.security, {
    signingPerformed: false,
    submissionPerformed: false,
    deploymentPerformed: false,
    privateKeyAccepted: false,
  });

  for (const call of calls.filter(({ args }) => args?.blockNumber !== undefined)) {
    assert.equal(call.args.blockNumber, 100n, `${call.method} must use the pinned block`);
  }
  assert.equal(calls.filter(({ method }) => method === "getBlock").length, 2);
});

test("never infers a selector from a unique verified ABI function", async () => {
  const { client } = fakeClient();
  const report = await inspectFreeMintTarget({
    target,
    blockscoutAbiEvidence: boundAbiEvidence([mintFunction()]),
  }, { publicClient: client });

  assert.equal(report.narrowZeroCostAdapterShape.matches, false);
  assert.equal(report.narrowZeroCostAdapterShape.status, "UNVERIFIED_SELECTOR_REQUIRED");
  assert.equal(report.narrowZeroCostAdapterShape.uniqueFunction, null);
  assert.ok(report.unverified.includes("intended selector"));
});

test("requires a unique verified function at the supplied selector", async () => {
  const selector = toFunctionSelector("freeMint(address,uint256)");
  const { client } = fakeClient();
  const duplicate = await inspectFreeMintTarget({
    target,
    expectedSelector: selector,
    blockscoutAbiEvidence: boundAbiEvidence([mintFunction(), mintFunction()]),
  }, { publicClient: client });
  assert.equal(duplicate.narrowZeroCostAdapterShape.matches, false);

  const wrongShape = await inspectFreeMintTarget({
    target,
    expectedSelector: toFunctionSelector("freeMint(uint256,address)"),
    blockscoutAbiEvidence: boundAbiEvidence([
      mintFunction({
        inputs: [
          { name: "tokenId", type: "uint256" },
          { name: "recipient", type: "address" },
        ],
      }),
    ]),
  }, { publicClient: client });
  assert.equal(wrongShape.narrowZeroCostAdapterShape.matches, false);

  const selectorMismatch = await inspectFreeMintTarget({
    target,
    expectedSelector: "0x12345678",
    blockscoutAbiEvidence: boundAbiEvidence([mintFunction()]),
  }, { publicClient: client });
  assert.equal(selectorMismatch.narrowZeroCostAdapterShape.matches, false);
});

test("an unverified Blockscout result cannot establish the narrow shape", async () => {
  const { client } = fakeClient();
  const report = await inspectFreeMintTarget({
    target,
    expectedSelector: toFunctionSelector("freeMint(address,uint256)"),
    blockscoutAbiEvidence: {
      ...boundAbiEvidence([]),
      response: {
        status: "0",
        message: "NOTOK",
        result: "Contract source code not verified",
      },
    },
  }, { publicClient: client });
  assert.equal(report.verifiedAbi.status, "UNVERIFIED");
  assert.equal(report.narrowZeroCostAdapterShape.matches, false);
  assert.equal(report.narrowZeroCostAdapterShape.status, "UNVERIFIED_ABI_REQUIRED");
});

test("binds ABI evidence to chain, exact target, and pinned runtime code hash", async () => {
  const { client } = fakeClient();
  const selector = toFunctionSelector("freeMint(address,uint256)");
  await assert.rejects(
    inspectFreeMintTarget({
      target,
      expectedSelector: selector,
      blockscoutAbiEvidence: boundAbiEvidence([mintFunction()], { chainId: 1 }),
    }, { publicClient: client }),
    /chainId must be exactly 4663/,
  );
  await assert.rejects(
    inspectFreeMintTarget({
      target,
      expectedSelector: selector,
      blockscoutAbiEvidence: boundAbiEvidence([mintFunction()], { target: collection }),
    }, { publicClient: client }),
    /target does not match/,
  );
  await assert.rejects(
    inspectFreeMintTarget({
      target,
      expectedSelector: selector,
      blockscoutAbiEvidence: boundAbiEvidence([mintFunction()], {
        runtimeCodeHash: `0x${"12".repeat(32)}`,
      }),
    }, { publicClient: client }),
    /runtime code hash does not match/,
  );
  assert.throws(
    () => parseBlockscoutAbiEvidence({ ...boundAbiEvidence([]), extra: true }),
    /extra is not allowed/,
  );
  await assert.rejects(
    inspectFreeMintTarget({
      target,
      expectedSelector: selector,
      blockscoutAbiResponse: verifiedAbiResponse([mintFunction()]),
    }, { publicClient: client }),
    /blockscoutAbiResponse is not allowed/,
  );
});

test("strictly bounds and validates Blockscout ABI envelopes", () => {
  assert.throws(
    () => parseBlockscoutAbiResponse({ status: "1", result: "[]", extra: true }),
    /extra is not allowed/,
  );
  assert.throws(
    () => parseBlockscoutAbiResponse({ status: "1", result: "not json" }),
    /valid JSON/,
  );
  assert.throws(
    () => parseBlockscoutAbiResponse(verifiedAbiResponse([
      { ...mintFunction(), dangerous: true },
    ])),
    /dangerous is not allowed/,
  );
  assert.throws(
    () => parseBlockscoutAbiResponse(verifiedAbiResponse(new Array(5_001).fill(mintFunction()))),
    /exceeds 5000 items/,
  );
  assert.throws(
    () => parseBlockscoutAbiResponse(`{"status":"0","result":"${"x".repeat(1_000_001)}"}`),
    /exceeds 1000000 bytes/,
  );
});

test("refuses any chain other than Robinhood 4663 before inspecting code", async () => {
  const { client, calls } = fakeClient({ getChainId: async () => 1 });
  await assert.rejects(
    inspectFreeMintTarget({ target }, { publicClient: client }),
    /Robinhood chain 4663 is required/,
  );
  assert.equal(calls.some(({ method }) => method === "getBytecode"), false);
});

test("fails closed on unconfirmed heads, empty target code, and malformed slots", async () => {
  await assert.rejects(
    inspectFreeMintTarget({ target, confirmations: 20 }, {
      publicClient: fakeClient({ getBlockNumber: async () => 20n }).client,
    }),
    /head is too low/,
  );
  await assert.rejects(
    inspectFreeMintTarget({ target }, {
      publicClient: fakeClient({ getBytecode: async () => undefined }).client,
    }),
    /no runtime bytecode/,
  );
  await assert.rejects(
    inspectFreeMintTarget({ target }, {
      publicClient: fakeClient({ getStorageAt: async () => "0x01" }).client,
    }),
    /32-byte storage word/,
  );
  for (const unavailable of [undefined, null, "0x"]) {
    await assert.rejects(
      inspectFreeMintTarget({ target }, {
        publicClient: fakeClient({ getStorageAt: async () => unavailable }).client,
      }),
      /32-byte storage word/,
    );
  }
});

test("fails if the pinned block hash changes during inspection", async () => {
  let reads = 0;
  const { client } = fakeClient({
    getBlock: async ({ blockNumber }) => {
      reads += 1;
      return {
        number: blockNumber,
        hash: reads === 1 ? blockHash : `0x${"cd".repeat(32)}`,
        timestamp: 1_777_777_777n,
      };
    },
  });
  await assert.rejects(
    inspectFreeMintTarget({ target }, { publicClient: client }),
    /pinned block hash changed/,
  );
});

test("CLI parser accepts only bounded inspection arguments and no private keys", () => {
  assert.deepEqual(parseInspectArguments([
    "--target", target,
    "--expected-collection", collection,
    "--expected-selector", "0xABCDEF12",
    "--expected-asset-standard", "ERC1155",
    "--confirmations", "32",
    "--blockscout-abi-file", "response.json",
  ]), {
    target,
    expectedCollection: collection,
    expectedSelector: "0xabcdef12",
    expectedAssetStandard: "ERC1155",
    confirmations: 32,
    blockscoutAbiFile: "response.json",
  });
  assert.throws(
    () => parseInspectArguments(["--target", target, "--private-key", `0x${"11".repeat(32)}`]),
    /unknown argument: --private-key/,
  );
  assert.throws(() => parseInspectArguments([]), /--target is required/);
  assert.throws(
    () => parseInspectArguments(["--target", target, "--confirmations", "0"]),
    /confirmations must be/,
  );
  assert.throws(
    () => parseInspectArguments(["--target", target, "--expected-asset-standard", "ERC20"]),
    /ERC721 or ERC1155/,
  );
  assert.throws(
    () => parseInspectArguments([
      "--target", target,
      "--expected-collection", "0x0000000000000000000000000000000000000000",
    ]),
    /must not be zero/,
  );
  assert.throws(
    () => parseInspectArguments(["--target", target, "--expected-selector", "0x00000000"]),
    /must not be zero/,
  );
});

test("uses the exact canonical EIP-1967 slots", () => {
  assert.deepEqual(EIP1967_SLOTS, {
    implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
    admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
    beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  });
});

test("rejects unknown inspection options and dependency injections", async () => {
  const { client } = fakeClient();
  await assert.rejects(
    inspectFreeMintTarget({ target, surprise: true }, { publicClient: client }),
    /options.surprise is not allowed/,
  );
  await assert.rejects(
    inspectFreeMintTarget({ target }, { publicClient: client, walletClient: {} }),
    /dependencies.walletClient is not allowed/,
  );
});
