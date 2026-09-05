import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encodeFunctionData, parseAbi } from "viem";

import {
  encodeAccount,
  encodeCreateAccount,
  encodeGetMintStats,
  encodeGetPublicDrop,
  encodeMintPublic,
  encodeOwnerOf,
  encodePunkExecuteMint,
  parseMintStats,
  parsePublicDrop,
  PEPEMFERS_PLAN,
  PepemfersMintError,
  prepareActivationTransactions,
  prepareMintTransactions,
  submitOwnerCallPlan,
  validateOwnerRoster,
  validatePublicDrop,
} from "../site/pepemfers-mint.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function account(uint256 tokenId) view returns (address)",
  "function createAccount(uint256 tokenId) returns (address)",
  "function getPublicDrop(address nftContract) view returns ((uint80 mintPrice,uint48 startTime,uint48 endTime,uint16 maxTotalMintableByWallet,uint16 feeBps,bool restrictFeeRecipients))",
  "function getMintStats(address minter) view returns ((uint256 minterNumMinted,uint256 currentTotalSupply,uint256 maxSupply))",
  "function mintPublic(address nftContract,address feeRecipient,address minterIfNotPayer,uint256 quantity) payable",
  "function execute(address to,uint256 value,bytes data,uint8 operation) payable returns (bytes)",
]);

function encodeWords(values) {
  return `0x${values.map((value) => BigInt(value).toString(16).padStart(64, "0")).join("")}`;
}

function canonicalDrop() {
  return {
    mintPrice: 0n,
    startTime: BigInt(PEPEMFERS_PLAN.publicStart),
    endTime: BigInt(PEPEMFERS_PLAN.publicEnd),
    maxPerWallet: 1n,
    feeBps: 1_000n,
    restrictFeeRecipients: true,
  };
}

test("PEPEMFERS calldata exactly matches the reviewed ABIs", () => {
  const tokenId = 93n;
  assert.equal(encodeOwnerOf(tokenId), encodeFunctionData({
    abi: ABI, functionName: "ownerOf", args: [tokenId],
  }));
  assert.equal(encodeAccount(tokenId), encodeFunctionData({
    abi: ABI, functionName: "account", args: [tokenId],
  }));
  assert.equal(encodeCreateAccount(tokenId), encodeFunctionData({
    abi: ABI, functionName: "createAccount", args: [tokenId],
  }));
  assert.equal(encodeGetPublicDrop(), encodeFunctionData({
    abi: ABI, functionName: "getPublicDrop", args: [PEPEMFERS_PLAN.collection],
  }));
  assert.equal(encodeGetMintStats(PEPEMFERS_PLAN.owner), encodeFunctionData({
    abi: ABI, functionName: "getMintStats", args: [PEPEMFERS_PLAN.owner],
  }));
  const inner = encodeFunctionData({ abi: ABI, functionName: "mintPublic", args: [
    PEPEMFERS_PLAN.collection, PEPEMFERS_PLAN.feeRecipient, ZERO, 1n,
  ] });
  assert.equal(encodeMintPublic(), inner);
  assert.equal(encodePunkExecuteMint(), encodeFunctionData({
    abi: ABI, functionName: "execute",
    args: [PEPEMFERS_PLAN.seaDrop, 0n, inner, 0],
  }));
});

test("public drop decoding and validation pins the exact free one-per-wallet hour", () => {
  const encoded = encodeWords([
    0, PEPEMFERS_PLAN.publicStart, PEPEMFERS_PLAN.publicEnd, 1, 1_000, 1,
  ]);
  assert.deepEqual(parsePublicDrop(encoded), canonicalDrop());
  assert.doesNotThrow(() => validatePublicDrop(canonicalDrop(), PEPEMFERS_PLAN.publicStart,
    { requireOpen: true }));
  assert.throws(() => validatePublicDrop({ ...canonicalDrop(), mintPrice: 1n }),
    (error) => error instanceof PepemfersMintError && error.code === "DROP_CONFIG_CHANGED");
  assert.throws(() => validatePublicDrop(canonicalDrop(), PEPEMFERS_PLAN.publicStart - 1,
    { requireOpen: true }), (error) => error.code === "MINT_NOT_OPEN");
});

test("owner roster is fixed to the complete 128-Punk live reconciliation", () => {
  const payload = {
    ok: true,
    chainId: 4663,
    owner: PEPEMFERS_PLAN.owner,
    collection: PEPEMFERS_PLAN.punkCollection,
    complete: true,
    balanceOf: 128,
    candidateTokenIds: [...PEPEMFERS_PLAN.tokenIds],
    candidateSources: { liveOwnerComplete: true, liveMulticall: true },
  };
  assert.equal(validateOwnerRoster(payload).length, 128);
  assert.throws(() => validateOwnerRoster({ ...payload, candidateTokenIds:
    payload.candidateTokenIds.slice(1), balanceOf: 127 }),
  (error) => error.code === "ROSTER_CHANGED");
});

test("activation preparation requires exact simulated deterministic accounts", async () => {
  const expected = "0x1111111111111111111111111111111111111111";
  const provider = { request: async ({ method }) => {
    if (method === "eth_call") return `0x${expected.slice(2).padStart(64, "0")}`;
    if (method === "eth_estimateGas") return "0x10000";
    throw new Error(`unexpected ${method}`);
  } };
  const transactions = await prepareActivationTransactions(provider, {
    missing: [{ tokenId: "93", account: expected }],
  });
  assert.deepEqual(transactions, [{
    from: PEPEMFERS_PLAN.owner,
    to: PEPEMFERS_PLAN.accountRegistry,
    value: "0x0",
    data: encodeCreateAccount("93"),
  }]);
});

test("mint preparation excludes already minted Punk Wallets and simulates exact calls", async () => {
  const accounts = [
    { tokenId: "93", account: "0x1111111111111111111111111111111111111111", activated: true },
    { tokenId: "94", account: "0x2222222222222222222222222222222222222222", activated: true },
  ];
  const responses = new Map([
    [encodeGetPublicDrop(), encodeWords([
      0, PEPEMFERS_PLAN.publicStart, PEPEMFERS_PLAN.publicEnd, 1, 1_000, 1,
    ])],
    [encodeGetMintStats(accounts[0].account), encodeWords([0, 0, 2_450])],
    [encodeGetMintStats(accounts[1].account), encodeWords([1, 1, 2_450])],
  ]);
  const provider = { request: async ({ method, params }) => {
    if (method === "eth_call") return responses.get(params[0].data) ?? "0x";
    if (method === "eth_estimateGas") return "0x30000";
    if (method === "eth_gasPrice") return "0x3b9aca00";
    throw new Error(`unexpected ${method}`);
  } };
  const result = await prepareMintTransactions(provider, { accounts, missing: [] },
    PEPEMFERS_PLAN.publicStart);
  assert.equal(result.calls.length, 1);
  assert.equal(result.alreadyMinted, 1);
  assert.deepEqual(result.calls[0], {
    from: PEPEMFERS_PLAN.owner,
    to: accounts[0].account,
    value: "0x0",
    data: encodePunkExecuteMint(),
  });
  assert.deepEqual(parseMintStats(encodeWords([1, 2, 2_450])), {
    minterNumMinted: 1n, currentTotalSupply: 2n, maxSupply: 2_450n,
  });
});

test("owner calls use EIP-5792 batches and never fall back after user rejection", async () => {
  const statuses = [];
  const call = { from: PEPEMFERS_PLAN.owner, to: PEPEMFERS_PLAN.accountRegistry,
    value: "0x0", data: encodeCreateAccount("93") };
  const provider = { request: async ({ method, params }) => {
    statuses.push({ method, params });
    if (method === "wallet_sendCalls") return "batch-id";
    if (method === "wallet_getCallsStatus") return { status: 200 };
    throw new Error(`unexpected ${method}`);
  } };
  const result = await submitOwnerCallPlan(provider, [call]);
  assert.deepEqual(result, [{ kind: "wallet_sendCalls", id: "batch-id", count: 1 }]);
  assert.deepEqual(statuses.map(({ method }) => method), [
    "wallet_sendCalls", "wallet_getCallsStatus",
  ]);

  let standardTransactions = 0;
  await assert.rejects(() => submitOwnerCallPlan({ request: async ({ method }) => {
    if (method === "wallet_sendCalls") throw Object.assign(new Error("user rejected"), { code: 4001 });
    if (method === "eth_sendTransaction") standardTransactions += 1;
  } }, [call]), /user rejected/);
  assert.equal(standardTransactions, 0);
});

test("an accepted wallet batch is never replayed when status polling fails", async () => {
  let standardTransactions = 0;
  const call = { from: PEPEMFERS_PLAN.owner, to: PEPEMFERS_PLAN.accountRegistry,
    value: "0x0", data: encodeCreateAccount("93") };
  await assert.rejects(() => submitOwnerCallPlan({ request: async ({ method }) => {
    if (method === "wallet_sendCalls") return "accepted-batch";
    if (method === "wallet_getCallsStatus") {
      throw Object.assign(new Error("method not supported"), { code: -32601 });
    }
    if (method === "eth_sendTransaction") standardTransactions += 1;
    throw new Error(`unexpected ${method}`);
  } }, [call]), /method not supported/);
  assert.equal(standardTransactions, 0);
});

test("submission rechecks the gas ceiling before opening a wallet batch", async () => {
  let sends = 0;
  const call = { from: PEPEMFERS_PLAN.owner, to: PEPEMFERS_PLAN.accountRegistry,
    value: "0x0", data: encodeCreateAccount("93") };
  const result = await submitOwnerCallPlan({ request: async ({ method }) => {
    if (method === "eth_gasPrice") return "0x64";
    if (method === "eth_estimateGas") return "0x64";
    if (method === "wallet_sendCalls") sends += 1;
    throw new Error(`unexpected ${method}`);
  } }, [call], () => {}, { maxGasBudgetWei: 11_999n });
  assert.deepEqual(result, []);
  assert.equal(sends, 0);
});

test("dedicated page is explicit about approvals and contains no unattended signer", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../site/pepemfers/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/pepemfers-mint.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /128-Punk owner roster/);
  assert.match(html, /0\.008 ETH/);
  assert.doesNotMatch(html, /data-pepemfers-activate/);
  assert.match(html, /no Gogh Punk transfers/);
  assert.match(html, /Nothing submits automatically/);
  assert.match(source, /eth_call/);
  assert.match(source, /eth_estimateGas/);
  assert.match(source, /wallet_sendCalls/);
  assert.doesNotMatch(source, /privateKey|mnemonic|createWalletClient|sendRawTransaction/);
  assert.match(source, new RegExp(PEPEMFERS_PLAN.collection.slice(2), "i"));
  assert.match(source, new RegExp(PEPEMFERS_PLAN.owner.slice(2), "i"));
});
