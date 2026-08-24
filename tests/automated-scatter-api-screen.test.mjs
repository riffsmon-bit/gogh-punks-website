import assert from "node:assert/strict";
import test from "node:test";

import { encodeFunctionData } from "viem";

import {
  SCATTER_MINT_ABI,
  screenScatterMintApiResponse,
} from "../broker/src/discovery/automated-scatter-api-screen.mjs";

const COLLECTION = "0x1111111111111111111111111111111111111111";
const ACCOUNT = "0x2222222222222222222222222222222222222222";
const ZERO = "0x0000000000000000000000000000000000000000";

function request() {
  return {
    collectionAddress: COLLECTION,
    chainId: 4663,
    minterAddress: ACCOUNT,
    lists: [{ id: "publiclist123", quantity: 1 }],
  };
}

function response(key = `0x${"00".repeat(32)}`) {
  return {
    mintTransaction: {
      to: COLLECTION,
      value: "0",
      data: encodeFunctionData({
        abi: SCATTER_MINT_ABI,
        functionName: "mint",
        args: [{ key, proof: [] }, 1n, ZERO, "0x"],
      }),
    },
    erc20s: [],
  };
}

test("accepts only one exact public zero-value Scatter mint envelope", () => {
  const result = screenScatterMintApiResponse(request(), response(`0x${"00".repeat(31)}ff`));
  assert.equal(result.schema, "GOGH_AUTOMATED_SCATTER_API_SCREEN_V1");
  assert.equal(result.chainId, 4663);
  assert.equal(result.collection, COLLECTION);
  assert.equal(result.account, ACCOUNT);
  assert.equal(result.publicInviteKey, `0x${"00".repeat(31)}ff`);
  assert.equal(result.quantity, 1);
  assert.equal(result.valueWei, "0");
  assert.equal(result.erc20ApprovalsRequired, false);
  assert.equal(result.apiCalldataTrustedForExecution, false);
});

test("rejects payment, ERC-20 approval, alternate target, and wrong chain", () => {
  const paid = response();
  paid.mintTransaction.value = "1";
  assert.throws(() => screenScatterMintApiResponse(request(), paid), { code: "NONZERO_PAYMENT" });

  const erc20 = response();
  erc20.erc20s.push({ address: COLLECTION, amount: "1" });
  assert.throws(() => screenScatterMintApiResponse(request(), erc20), { code: "ERC20_UNSUPPORTED" });

  const alternate = response();
  alternate.mintTransaction.to = "0x3333333333333333333333333333333333333333";
  assert.throws(() => screenScatterMintApiResponse(request(), alternate), { code: "WRONG_TARGET" });

  const wrongChain = request();
  wrongChain.chainId = 1;
  assert.throws(() => screenScatterMintApiResponse(wrongChain, response()), { code: "WRONG_CHAIN" });
});

test("rejects private proof, non-public key, quantity, affiliate, and signature", () => {
  const privateProof = response();
  privateProof.mintTransaction.data = encodeFunctionData({
    abi: SCATTER_MINT_ABI,
    functionName: "mint",
    args: [{ key: `0x${"01".repeat(32)}`, proof: [`0x${"02".repeat(32)}`] }, 1n, ZERO, "0x"],
  });
  assert.throws(() => screenScatterMintApiResponse(request(), privateProof), { code: "NONPUBLIC_LIST" });

  const privateKey = response(`0x${"00".repeat(30)}0100`);
  assert.throws(() => screenScatterMintApiResponse(request(), privateKey), { code: "NONPUBLIC_LIST" });

  const quantity = response();
  quantity.mintTransaction.data = encodeFunctionData({
    abi: SCATTER_MINT_ABI,
    functionName: "mint",
    args: [{ key: `0x${"00".repeat(32)}`, proof: [] }, 2n, ZERO, "0x"],
  });
  assert.throws(() => screenScatterMintApiResponse(request(), quantity), { code: "INVALID_QUANTITY" });

  const affiliate = response();
  affiliate.mintTransaction.data = encodeFunctionData({
    abi: SCATTER_MINT_ABI,
    functionName: "mint",
    args: [{ key: `0x${"00".repeat(32)}`, proof: [] }, 1n, COLLECTION, "0x"],
  });
  assert.throws(() => screenScatterMintApiResponse(request(), affiliate), { code: "AFFILIATE_UNSUPPORTED" });

  const signature = response();
  signature.mintTransaction.data = encodeFunctionData({
    abi: SCATTER_MINT_ABI,
    functionName: "mint",
    args: [{ key: `0x${"00".repeat(32)}`, proof: [] }, 1n, ZERO, "0x01"],
  });
  assert.throws(() => screenScatterMintApiResponse(request(), signature), { code: "AFFILIATE_UNSUPPORTED" });
});

test("rejects ambiguous request and response shapes and hostile JSON", () => {
  const multiple = request();
  multiple.lists.push({ id: "another", quantity: 1 });
  assert.throws(() => screenScatterMintApiResponse(multiple, response()), { code: "INVALID_LIST" });

  assert.throws(
    () => screenScatterMintApiResponse({ ...request(), affiliateAddress: ZERO }, response()),
    { code: "INVALID_SCHEMA" },
  );
  assert.throws(
    () => screenScatterMintApiResponse(request(), { ...response(), approvals: [] }),
    { code: "INVALID_SCHEMA" },
  );

  let invoked = 0;
  const hostile = response();
  Object.defineProperty(hostile.mintTransaction, "data", {
    enumerable: true,
    get() { invoked += 1; return "0x"; },
  });
  assert.throws(() => screenScatterMintApiResponse(request(), hostile), { code: "INVALID_JSON" });
  assert.equal(invoked, 0);
});
