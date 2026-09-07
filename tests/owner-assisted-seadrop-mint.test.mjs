import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, parseAbi } from "viem";

import {
  buildOwnerAssistedSeaDropTransaction,
  ownerAssistedMintArtifact,
} from "../broker/src/v4/owner-assisted-seadrop-mint.mjs";
import {
  confirmOwnerAssistedMint,
  OwnerAssistedMintError,
  submitOwnerAssistedMint,
  validateOwnerAssistedMintArtifact,
} from "../site/owner-assisted-seadrop-mint.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const PUNK_WALLET = "0x2222222222222222222222222222222222222222";
const COLLECTION = "0x3333333333333333333333333333333333333333";
const SEA_DROP = "0x00005ea00ac477b1030ce78506496e8c2de24bf5";
const FEE_RECIPIENT = "0x0000a26b00c1f0df003000390027140000faa719";
const NOW = new Date("2026-09-06T18:00:00.000Z");
const ATTEMPT = Object.freeze({
  attemptId: "123e4567-e89b-42d3-a456-426614174000",
  idempotencyKey: "ab".repeat(32),
});

const ACCOUNT_ABI = parseAbi([
  "function execute(address to,uint256 value,bytes data,uint8 operation) payable returns (bytes result)",
]);
const SEA_DROP_ABI = parseAbi([
  "function mintPublic(address nftContract,address feeRecipient,address minterIfNotPayer,uint256 quantity) payable",
]);

function artifact() {
  const transaction = buildOwnerAssistedSeaDropTransaction({
    owner: OWNER, punkWallet: PUNK_WALLET, collection: COLLECTION,
  });
  return ownerAssistedMintArtifact({
    opportunity: {
      opportunityId: "seadrop:test-collection:public",
      collectionName: "Test Collection",
      collectionContract: COLLECTION,
    },
    evidence: { expectedTokenId: "42", pinnedBlock: "123", estimatedGasWei: "1000" },
    transaction,
  }, { maxGasPerMintWei: "2000" }, NOW, ATTEMPT);
}

test("owner-assisted free-mint envelope calls fixed SeaDrop through the selected Punk Wallet", () => {
  const transaction = buildOwnerAssistedSeaDropTransaction({
    owner: OWNER, punkWallet: PUNK_WALLET, collection: COLLECTION,
  });
  assert.deepEqual({ from: transaction.from, to: transaction.to, value: transaction.value }, {
    from: OWNER, to: PUNK_WALLET, value: "0x0",
  });
  const accountCall = decodeFunctionData({ abi: ACCOUNT_ABI, data: transaction.data });
  assert.equal(accountCall.functionName, "execute");
  assert.equal(accountCall.args[0].toLowerCase(), SEA_DROP);
  assert.equal(accountCall.args[1], 0n);
  assert.equal(accountCall.args[3], 0);
  const mintCall = decodeFunctionData({ abi: SEA_DROP_ABI, data: accountCall.args[2] });
  assert.equal(mintCall.functionName, "mintPublic");
  assert.equal(mintCall.args[0].toLowerCase(), COLLECTION);
  assert.equal(mintCall.args[1].toLowerCase(), FEE_RECIPIENT);
  assert.equal(mintCall.args[2], "0x0000000000000000000000000000000000000000");
  assert.equal(mintCall.args[3], 1n);
});

test("browser accepts an unexpired server artifact only for its bound owner and Punk Wallet", () => {
  const mint = artifact();
  const validated = validateOwnerAssistedMintArtifact(mint, {
    owner: OWNER, account: PUNK_WALLET,
  }, NOW.getTime());
  assert.equal(validated.owner, OWNER);
  assert.equal(validated.account, PUNK_WALLET);
  assert.equal(validated.collection, COLLECTION);

  assert.throws(() => validateOwnerAssistedMintArtifact(mint, {
    owner: COLLECTION, account: PUNK_WALLET,
  }, NOW.getTime()), (error) => error instanceof OwnerAssistedMintError
    && error.code === "INVALID_ARTIFACT");
  assert.throws(() => validateOwnerAssistedMintArtifact(mint, {
    owner: OWNER, account: PUNK_WALLET,
  }, NOW.getTime() + 91_000), (error) => error instanceof OwnerAssistedMintError
    && error.code === "EXPIRED_ARTIFACT");
});

test("submitting is a separate explicit wallet operation", async () => {
  const prepared = validateOwnerAssistedMintArtifact(artifact(), {
    owner: OWNER, account: PUNK_WALLET,
  }, NOW.getTime());
  const calls = [];
  const provider = { request: async (request) => {
    calls.push(request);
    return `0x${"ab".repeat(32)}`;
  } };
  assert.equal(calls.length, 0);
  const hash = await submitOwnerAssistedMint(provider, prepared);
  assert.equal(hash, `0x${"ab".repeat(32)}`);
  assert.deepEqual(calls, [{ method: "eth_sendTransaction", params: [prepared.transaction] }]);
});

test("confirmation derives the actual token from the mint receipt during a public-mint race", async () => {
  const prepared = validateOwnerAssistedMintArtifact(artifact(), {
    owner: OWNER, account: PUNK_WALLET,
  }, NOW.getTime());
  const hash = `0x${"cd".repeat(32)}`;
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const rawReceipt = { transactionHash: hash, blockNumber: "0x7b", status: "0x1", logs: [{
    address: COLLECTION, data: "0x", topics: [transferTopic, `0x${"0".repeat(64)}`,
      `0x${"0".repeat(24)}${PUNK_WALLET.slice(2)}`, `0x${43n.toString(16).padStart(64, "0")}`],
  }] };
  const provider = { request: async ({ method }) => {
    if (method === "eth_getTransactionReceipt") return rawReceipt;
    if (method === "eth_call") return `0x${"0".repeat(24)}${PUNK_WALLET.slice(2)}`;
    throw new Error(`unexpected ${method}`);
  } };
  const receipt = await confirmOwnerAssistedMint(provider, prepared, hash);
  assert.equal(receipt.expectedTokenId, "42");
  assert.equal(receipt.tokenId, "43");
});
