import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { keccak256 } from "viem";
import { ROBINHOOD } from "../src/config.mjs";
import {
  buildOwnerReviewFreeMintProposal,
  FreeMintProposalError,
} from "../src/recommendation/owner-approved-free-mint-proposal.mjs";
import {
  parseFreeMintProposalArguments,
  runFreeMintProposalCli,
} from "../../scripts/build-free-mint-proposal.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ACCOUNT = "0x1111111111111111111111111111111111111111";
const OWNER = "0x2222222222222222222222222222222222222222";
const ADAPTER = "0x3333333333333333333333333333333333333333";
const VENUE = "0x4444444444444444444444444444444444444444";
const COLLECTION = "0x5555555555555555555555555555555555555555";
const MINT_SELECTOR = "0xaabbccdd";
const EMPTY_ADAPTER_DATA_HASH = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const OPPORTUNITY_ID = `0x${"11".repeat(32)}`;
const REASONING_HASH = `0x${"22".repeat(32)}`;
const ADAPTER_CODE_HASH = `0x${"33".repeat(32)}`;

function validInput(overrides = {}) {
  return {
    chainId: 4663,
    punkCollection: ROBINHOOD.canonicalCollection,
    punkTokenId: "4242",
    punkAccount: ACCOUNT,
    expectedOwner: OWNER,
    ownerReview: true,
    opportunityType: "FREE_MINT",
    assetStandard: "ERC721",
    adapter: ADAPTER,
    venue: VENUE,
    collection: COLLECTION,
    mintSelector: MINT_SELECTOR,
    tokenId: "9001",
    assetAmount: "1",
    currency: ZERO_ADDRESS,
    expectedPrice: "0",
    maxPrice: "0",
    maxSlippageBps: "0",
    expiresAt: "1120",
    nonce: "7",
    policyVersion: "3",
    opportunityId: OPPORTUNITY_ID,
    reasoningHash: REASONING_HASH,
    adapterCodeHash: ADAPTER_CODE_HASH,
    ...overrides,
  };
}

function cliArgs(input) {
  return [
    "--chain-id", String(input.chainId),
    "--punk-collection", input.punkCollection,
    "--punk-token-id", String(input.punkTokenId),
    "--punk-account", input.punkAccount,
    "--expected-owner", input.expectedOwner,
    "--owner-review",
    "--opportunity-type", input.opportunityType,
    "--asset-standard", input.assetStandard,
    "--adapter", input.adapter,
    "--venue", input.venue,
    "--collection", input.collection,
    "--mint-selector", input.mintSelector,
    "--token-id", String(input.tokenId),
    "--asset-amount", String(input.assetAmount),
    "--currency", input.currency,
    "--expected-price", String(input.expectedPrice),
    "--max-price", String(input.maxPrice),
    "--max-slippage-bps", String(input.maxSlippageBps),
    "--expires-at", String(input.expiresAt),
    "--nonce", String(input.nonce),
    "--policy-version", String(input.policyVersion),
    "--opportunity-id", input.opportunityId,
    "--reasoning-hash", input.reasoningHash,
    "--adapter-code-hash", input.adapterCodeHash,
  ];
}

test("builds a human-review-only free-mint proposal", () => {
  const result = buildOwnerReviewFreeMintProposal(validInput(), { nowSeconds: 1_000 });
  assert.equal(result.hashAlgorithm, "SHA256_CANONICAL_JSON_V1");
  assert.match(result.proposalHash, /^0x[0-9a-f]{64}$/);
  assert.equal(result.proposal.schema, "GOGH_OWNER_REVIEW_FREE_MINT_PROPOSAL_V1");
  assert.equal(result.proposal.stage, "LOCAL_OWNER_REVIEW");
  assert.deepEqual(result.proposal.punk, {
    chainId: 4663,
    collection: ROBINHOOD.canonicalCollection,
    tokenId: "4242",
    account: ACCOUNT,
    expectedOwner: OWNER,
  });
  assert.equal(result.proposal.intent.opportunityType, "FREE_MINT");
  assert.equal(result.proposal.intent.assetStandard, "ERC721");
  assert.equal(result.proposal.intent.tokenId, "9001");
  assert.equal(result.proposal.intent.assetAmount, "1");
  assert.equal(result.proposal.intent.currency, ZERO_ADDRESS);
  assert.equal(result.proposal.intent.expectedPrice, "0");
  assert.equal(result.proposal.intent.maxPrice, "0");
  assert.equal(result.proposal.intent.maxSlippageBps, 0);
  assert.equal(result.proposal.intent.createdAt, 1_000);
  assert.equal(result.proposal.intent.expiresAt, 1_120);
  assert.deepEqual(result.proposal.humanReview.target, {
    adapter: ADAPTER,
    venue: VENUE,
    collection: COLLECTION,
    mintSelector: MINT_SELECTOR,
    adapterDataPolicy: "EMPTY_ONLY",
    adapterDataHash: EMPTY_ADAPTER_DATA_HASH,
  });
  assert.equal(result.proposal.humanReview.target.adapterDataHash, keccak256("0x"));
  assert.deepEqual(result.proposal.eip712, {
    domain: {
      name: "Gogh Punk Account",
      version: "1",
      chainId: 4663,
      verifyingContract: ACCOUNT,
    },
    primaryType: "AcquisitionIntent",
    adapterDataPolicy: "EMPTY_ONLY",
    adapterDataHash: EMPTY_ADAPTER_DATA_HASH,
    intentDigest: "0x9575e5fcfec798dc286a90c637dd7978b7721ec1cd7f5d824bf0861a46b9e5c4",
    derivation: "LOCAL_CURRENT_GOGH_PUNK_ACCOUNT_V1",
    liveDeploymentVerified: false,
    ownerApprovalObtained: false,
  });
  assert.deepEqual(result.proposal.authorization, {
    executionPath: "OWNER_APPROVAL_REQUIRED",
    ownerReviewRequested: true,
    ownerApprovalObtained: false,
    approvalPurchasesStaged: true,
    executionEnabled: false,
    autonomousPurchasesEnabled: false,
    autonomousMintsEnabled: false,
    unknownCollectionExecutionEnabled: false,
    sellingEnabled: false,
  });
  assert.deepEqual(result.proposal.localArtifacts, {
    signingPerformed: false,
    submissionPerformed: false,
    chainWritePerformed: false,
  });
  assert.equal(Object.hasOwn(result.proposal.intent, "target"), false);
  assert.equal(Object.hasOwn(result.proposal.intent, "calldata"), false);
  assert.equal(Object.hasOwn(result.proposal.intent, "adapterData"), false);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.proposal));
});

test("proposal hashes are deterministic and bind every reviewed intent field", () => {
  const first = buildOwnerReviewFreeMintProposal(validInput(), { nowSeconds: 1_000 });
  const second = buildOwnerReviewFreeMintProposal(validInput(), { nowSeconds: 1_000 });
  assert.equal(first.proposalHash, second.proposalHash);

  const changedInputs = [
    ["punkTokenId", "1798"],
    ["punkAccount", "0x6666666666666666666666666666666666666666"],
    ["expectedOwner", "0x7777777777777777777777777777777777777777"],
    ["assetStandard", "ERC1155"],
    ["adapter", "0x8888888888888888888888888888888888888888"],
    ["venue", "0x9999999999999999999999999999999999999999"],
    ["collection", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    ["mintSelector", "0x11223344"],
    ["tokenId", "9002"],
    ["expiresAt", "1119"],
    ["nonce", "8"],
    ["policyVersion", "4"],
    ["opportunityId", `0x${"44".repeat(32)}`],
    ["reasoningHash", `0x${"55".repeat(32)}`],
    ["adapterCodeHash", `0x${"66".repeat(32)}`],
  ];
  for (const [field, value] of changedInputs) {
    const changed = buildOwnerReviewFreeMintProposal(
      validInput({ [field]: value }),
      { nowSeconds: 1_000 },
    );
    assert.notEqual(first.proposalHash, changed.proposalHash, field);
  }
  const changedCreationTime = buildOwnerReviewFreeMintProposal(
    validInput(),
    { nowSeconds: 1_001 },
  );
  assert.notEqual(first.proposalHash, changedCreationTime.proposalHash, "createdAt");
});

test("canonical EIP-712 digest binds every current AcquisitionIntent field", () => {
  const first = buildOwnerReviewFreeMintProposal(validInput(), { nowSeconds: 1_000 });
  const digestChanges = [
    ["punkAccount", "0x6666666666666666666666666666666666666666"],
    ["expectedOwner", "0x7777777777777777777777777777777777777777"],
    ["assetStandard", "ERC1155"],
    ["adapter", "0x8888888888888888888888888888888888888888"],
    ["venue", "0x9999999999999999999999999999999999999999"],
    ["collection", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    ["tokenId", "9002"],
    ["expiresAt", "1119"],
    ["nonce", "8"],
    ["policyVersion", "4"],
    ["opportunityId", `0x${"44".repeat(32)}`],
    ["reasoningHash", `0x${"55".repeat(32)}`],
    ["adapterCodeHash", `0x${"66".repeat(32)}`],
  ];
  for (const [field, value] of digestChanges) {
    const changed = buildOwnerReviewFreeMintProposal(
      validInput({ [field]: value }),
      { nowSeconds: 1_000 },
    );
    assert.notEqual(first.proposal.eip712.intentDigest, changed.proposal.eip712.intentDigest, field);
  }
  const changedCreationTime = buildOwnerReviewFreeMintProposal(
    validInput(),
    { nowSeconds: 1_001 },
  );
  assert.notEqual(
    first.proposal.eip712.intentDigest,
    changedCreationTime.proposal.eip712.intentDigest,
    "createdAt",
  );
});

test("rejects arbitrary execution fields before building a typed intent", () => {
  for (const forbidden of [
    "target",
    "calldata",
    "arbitraryCalldata",
    "adapterData",
    "adapterDataHash",
    "adapterDataPolicy",
    "ownerApproved",
  ]) {
    assert.throws(
      () => buildOwnerReviewFreeMintProposal(
        { ...validInput(), [forbidden]: "0xdeadbeef" },
        { nowSeconds: 1_000 },
      ),
      (error) => error instanceof FreeMintProposalError && error.code === "UNKNOWN_FIELD",
    );
  }
});

test("free-mint proposal invariants fail closed", () => {
  const invalidCases = [
    [{ chainId: 1 }, "INVALID_FIXED_VALUE"],
    [{ punkCollection: COLLECTION }, "NONCANONICAL_PUNK"],
    [{ punkAccount: ZERO_ADDRESS }, "ZERO_ADDRESS"],
    [{ expectedOwner: ZERO_ADDRESS }, "ZERO_ADDRESS"],
    [{ ownerReview: false }, "OWNER_REVIEW_REQUIRED"],
    [{ opportunityType: "MINT" }, "FREE_MINT_ONLY"],
    [{ assetStandard: "ERC20" }, "INVALID_ASSET_STANDARD"],
    [{ assetAmount: "2" }, "INVALID_FIXED_VALUE"],
    [{ currency: "not-an-address" }, "INVALID_ADDRESS"],
    [{ currency: COLLECTION }, "NATIVE_CURRENCY_ONLY"],
    [{ expectedPrice: "1" }, "INVALID_FIXED_VALUE"],
    [{ maxPrice: "1" }, "INVALID_FIXED_VALUE"],
    [{ maxSlippageBps: "1" }, "INVALID_FIXED_VALUE"],
    [{ adapter: ZERO_ADDRESS }, "ZERO_ADDRESS"],
    [{ venue: ZERO_ADDRESS }, "ZERO_ADDRESS"],
    [{ collection: ZERO_ADDRESS }, "ZERO_ADDRESS"],
    [{ mintSelector: "0x1234" }, "INVALID_BYTES4"],
    [{ mintSelector: "0x00000000" }, "ZERO_BYTES4"],
    [{ expiresAt: "1000" }, "INTENT_EXPIRED"],
    [{ expiresAt: "1121" }, "EXPIRY_TOO_LONG"],
    [{ nonce: "-1" }, "INVALID_INTEGER"],
    [{ policyVersion: "0" }, "INVALID_INTEGER"],
    [{ opportunityId: "0x1234" }, "INVALID_BYTES32"],
    [{ reasoningHash: `0x${"00".repeat(32)}` }, "ZERO_BYTES32"],
    [{ adapterCodeHash: "not-a-hash" }, "INVALID_BYTES32"],
  ];
  for (const [override, code] of invalidCases) {
    assert.throws(
      () => buildOwnerReviewFreeMintProposal(validInput(override), { nowSeconds: 1_000 }),
      (error) => error instanceof FreeMintProposalError && error.code === code,
      JSON.stringify(override),
    );
  }
});

test("every typed field is independently required and unknown symbol fields are rejected", () => {
  for (const field of Object.keys(validInput())) {
    const missing = validInput();
    delete missing[field];
    assert.throws(
      () => buildOwnerReviewFreeMintProposal(missing, { nowSeconds: 1_000 }),
      (error) => error.code === "MISSING_FIELD" && error.message.endsWith(field),
      field,
    );
  }
  const symbolInput = validInput();
  symbolInput[Symbol("hidden")] = "unsafe";
  assert.throws(
    () => buildOwnerReviewFreeMintProposal(symbolInput, { nowSeconds: 1_000 }),
    (error) => error.code === "UNKNOWN_FIELD",
  );
});

test("CLI parser accepts only named fields and an explicit owner-review switch", () => {
  const parsed = parseFreeMintProposalArguments(cliArgs(validInput()));
  assert.equal(parsed.ownerReview, true);
  assert.equal(parsed.opportunityType, "FREE_MINT");
  assert.equal(parsed.tokenId, "9001");
  assert.equal(parsed.mintSelector, MINT_SELECTOR);
  assert.throws(
    () => parseFreeMintProposalArguments(["--target", COLLECTION]),
    /unknown argument/,
  );
  assert.throws(
    () => parseFreeMintProposalArguments(["--owner-review", "--owner-review"]),
    /duplicate/,
  );
  assert.throws(
    () => parseFreeMintProposalArguments(["--owner-approved"]),
    /unknown argument/,
  );
});

test("local CLI emits review JSON and never signs, submits, or writes to chain", () => {
  const now = Math.floor(Date.now() / 1_000);
  const input = validInput({ expiresAt: String(now + 60) });
  const direct = runFreeMintProposalCli(cliArgs(input), { nowSeconds: now });
  assert.equal(direct.proposal.humanReview.expiresInSeconds, 60);

  const result = spawnSync(process.execPath, [
    "scripts/build-free-mint-proposal.mjs",
    ...cliArgs(input),
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.proposalHash, /^0x[0-9a-f]{64}$/);
  assert.equal(output.proposal.stage, "LOCAL_OWNER_REVIEW");
  assert.equal(output.proposal.localArtifacts.signingPerformed, false);
  assert.equal(output.proposal.localArtifacts.submissionPerformed, false);
  assert.equal(output.proposal.localArtifacts.chainWritePerformed, false);

  const rejected = spawnSync(process.execPath, [
    "scripts/build-free-mint-proposal.mjs",
    "--target", COLLECTION,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(rejected.status, 2);
  assert.equal(rejected.stdout, "");
  assert.match(rejected.stderr, /unknown argument/);
});
