import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ROBINHOOD } from "../broker/src/config.mjs";
import {
  evaluateCanonicalRegistryRuntimeEvidence,
  evaluateDeploymentSourceVerificationAdoption,
} from "../scripts/canary-preflight.mjs";
import { sourceVerificationCanonicalSha256 } from
  "../broker/src/recommendation/source-verification-adoption.mjs";

const expectedHash = "0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735";
const contractNames = [
  "ArtAdapterRegistry",
  "ArtAgentRegistry",
  "BrokerPolicyModule",
  "GoghPunkAccountV1",
  "GoghPunkAccountRegistry",
];

function verifiedManifest() {
  const manifest = {
    contracts: Object.fromEntries(
      contractNames.map((name) => [name, { verificationStatus: "VERIFIED" }]),
    ),
    sourceVerificationAdoption: null,
    notes: "Verified manifest fixture.",
  };
  const pendingManifest = structuredClone(manifest);
  for (const name of contractNames) {
    pendingManifest.contracts[name].verificationStatus = "NOT_SUBMITTED";
  }
  manifest.sourceVerificationAdoption = {
    schema: "GOGH_BLOCKSCOUT_SOURCE_VERIFICATION_ADOPTION_V1",
    gateSchema: "GOGH_BLOCKSCOUT_VERIFIED_MANIFEST_PROPOSAL_V1",
    gateVersion: 1,
    chainId: 4663,
    explorerOrigin: "https://robinhoodchain.blockscout.com",
    pendingProposalSha256: `0x${"11".repeat(32)}`,
    pendingManifestSha256: sourceVerificationCanonicalSha256(pendingManifest),
    pendingManifestNotes: pendingManifest.notes,
    verificationEvidenceSha256: `0x${"22".repeat(32)}`,
    verifiedContracts: [...contractNames],
    observedAt: "2026-08-20T15:58:00.000Z",
  };
  return manifest;
}

test("pins the verified canonical ERC-6551 registry runtime hash in config and manifest", async () => {
  assert.equal(ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash, expectedHash);
  const manifest = JSON.parse(await readFile(
    new URL("../deployments/robinhood.json", import.meta.url),
    "utf8",
  ));
  assert.equal(manifest.canonicalERC6551RegistryRuntimeCodeHash, expectedHash);
});

test("requires manifest, primary RPC, and secondary RPC evidence to match the pin", () => {
  const matching = evaluateCanonicalRegistryRuntimeEvidence({
    manifestRuntimeCodeHash: expectedHash.toUpperCase().replace("0X", "0x"),
    primaryBytecode: "0x6000",
    secondaryBytecode: "0x6000",
  }, () => expectedHash);
  assert.deepEqual(matching, {
    expected: expectedHash,
    manifestHash: expectedHash,
    primaryHash: expectedHash,
    secondaryHash: expectedHash,
    manifestMatches: true,
    primaryMatches: true,
    secondaryMatches: true,
    providersAgree: true,
    valid: true,
  });

  const providerMismatch = evaluateCanonicalRegistryRuntimeEvidence({
    manifestRuntimeCodeHash: expectedHash,
    primaryBytecode: "0x6000",
    secondaryBytecode: "0x6001",
  }, (bytecode) => bytecode === "0x6000" ? expectedHash : `0x${"11".repeat(32)}`);
  assert.equal(providerMismatch.primaryMatches, true);
  assert.equal(providerMismatch.secondaryMatches, false);
  assert.equal(providerMismatch.providersAgree, false);
  assert.equal(providerMismatch.valid, false);
});

test("fails closed for missing code, empty code, and a malformed or wrong manifest hash", () => {
  for (const evidence of [
    {
      manifestRuntimeCodeHash: null,
      primaryBytecode: "0x6000",
      secondaryBytecode: "0x6000",
    },
    {
      manifestRuntimeCodeHash: `0x${"22".repeat(32)}`,
      primaryBytecode: "0x6000",
      secondaryBytecode: "0x6000",
    },
    {
      manifestRuntimeCodeHash: expectedHash,
      primaryBytecode: undefined,
      secondaryBytecode: "0x6000",
    },
    {
      manifestRuntimeCodeHash: expectedHash,
      primaryBytecode: "0x",
      secondaryBytecode: "0x6000",
    },
  ]) {
    assert.equal(
      evaluateCanonicalRegistryRuntimeEvidence(evidence, () => expectedHash).valid,
      false,
    );
  }
});

test("foundation preflight reads registry code from both providers at the pinned block", async () => {
  const source = await readFile(
    new URL("../scripts/canary-preflight.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /CanonicalERC6551RegistrySecondary/);
  assert.match(source, /secondary\.getCode\(\{ address: ROBINHOOD\.canonicalERC6551Registry, blockNumber \}\)/);
  assert.match(source, /canonicalRegistryRuntimeEvidence\.valid/);
  assert.match(source, /confirmations < 20 \|\| confirmations > 256/);
  assert.match(source, /between 20 and 256/);
});

test("foundation preflight requires a cryptographically bound source-verification adoption", () => {
  const manifest = verifiedManifest();
  const result = evaluateDeploymentSourceVerificationAdoption(manifest);
  assert.equal(result.sha256,
    sourceVerificationCanonicalSha256(manifest.sourceVerificationAdoption));
  assert.deepEqual(result.adoption.verifiedContracts, contractNames);

  const handFlipped = verifiedManifest();
  handFlipped.sourceVerificationAdoption = null;
  assert.throws(
    () => evaluateDeploymentSourceVerificationAdoption(handFlipped),
    /sourceVerificationAdoption must be an object/,
  );

  const wrongOrder = verifiedManifest();
  wrongOrder.sourceVerificationAdoption.verifiedContracts.reverse();
  assert.throws(
    () => evaluateDeploymentSourceVerificationAdoption(wrongOrder),
    /verified contract set\/order is wrong/,
  );
});
