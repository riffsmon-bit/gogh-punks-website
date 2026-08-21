import { createHash } from "node:crypto";
import coreManifest from "../../../deployments/robinhood.json" with { type: "json" };
import canaryManifest from "../../../deployments/robinhood-canary.json" with { type: "json" };
import { ROBINHOOD } from "../../../broker/src/config.mjs";
import { requireVerifiedManifestAdoption } from
  "../../../broker/src/recommendation/source-verification-adoption.mjs";

const CORE_NAMES = Object.freeze([
  "ArtAdapterRegistry",
  "ArtAgentRegistry",
  "BrokerPolicyModule",
  "GoghPunkAccountV1",
  "GoghPunkAccountRegistry",
]);
const CANARY_NAMES = Object.freeze([
  "GoghOneShotCanaryArt",
  "GoghOneShotCanaryMintAdapter",
]);
const PUNK_TOKEN_ID = "1797";
const FUNCTION_SELECTOR = "0x4402cb61";
const MINT_SELECTOR = "0x40c10f19";
const REQUIRED_PROVENANCE_VERIFICATIONS = Object.freeze([
  "coreManifestHashVerified",
  "coreRegistryRuntimeHashVerified",
  "accountImplementationRuntimeHashVerified",
  "activatedAccountRuntimeHashVerified",
  "canonicalERC6551RegistryRuntimeHashVerified",
  "accountFooterVerified",
  "expectedOwnerVerified",
  "constructorInputsVerified",
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

function canonicalSha256(value) {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function address(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase()
    : null;
}

function bytes32(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)
    ? value.toLowerCase()
    : null;
}

function verifiedRecord(record, { receipt = false } = {}) {
  return Boolean(
    address(record?.address)
    && bytes32(record?.runtimeBytecodeHash)
    && bytes32(record?.deploymentTransaction)
    && Number.isSafeInteger(record?.deploymentBlock)
    && record.deploymentBlock > 0
    && (!receipt || record.receiptStatus === "SUCCESS")
    && record.verificationStatus === "VERIFIED",
  );
}

function verifiedAdoption(manifest, names) {
  try {
    requireVerifiedManifestAdoption(manifest, names);
    return true;
  } catch {
    return false;
  }
}

function disabled(reason) {
  return Object.freeze({
    deploymentStatus: "NOT_DEPLOYED",
    canaryStatus: "NOT_DEPLOYED",
    reason,
    accountRegistry: null,
    accountImplementation: null,
    policyModule: null,
    agentRegistry: null,
    adapterRegistry: null,
    canary: null,
  });
}

export function brokerDeploymentSurface(
  core = coreManifest,
  canary = canaryManifest,
) {
  if (!core || core.status !== "DEPLOYED" || core.chain?.chainId !== ROBINHOOD.chainId
    || address(core.canonicalCollection) !== ROBINHOOD.canonicalCollection
    || !address(core.protocolGuardian) || !verifiedAdoption(core, CORE_NAMES)
    || CORE_NAMES.some((name) => !verifiedRecord(core.contracts?.[name]))) {
    return disabled("CORE_MANIFEST_NOT_DEPLOYED");
  }
  const coreContracts = core.contracts;
  const coreManifestSha256 = canonicalSha256(core);
  if (!canary || canary.status !== "DEPLOYED" || canary.chain?.chainId !== ROBINHOOD.chainId
    || address(canary.canonicalCollection) !== ROBINHOOD.canonicalCollection
    || canary.coreDeploymentManifest !== "deployments/robinhood.json"
    || canary.coreDeploymentManifestStatusRequired !== "DEPLOYED"
    || String(canary.coreDeploymentManifestGitCommit ?? "").toLowerCase()
      !== String(core.gitCommit ?? "").toLowerCase()
    || bytes32(canary.coreDeploymentManifestSha256) !== coreManifestSha256
    || address(canary.coreGoghPunkAccountRegistry)
      !== address(coreContracts.GoghPunkAccountRegistry.address)
    || bytes32(canary.coreGoghPunkAccountRegistryRuntimeCodeHash)
      !== bytes32(coreContracts.GoghPunkAccountRegistry.runtimeBytecodeHash)
    || address(canary.coreGoghPunkAccountImplementation)
      !== address(coreContracts.GoghPunkAccountV1.address)
    || bytes32(canary.coreGoghPunkAccountImplementationRuntimeCodeHash)
      !== bytes32(coreContracts.GoghPunkAccountV1.runtimeBytecodeHash)
    || address(canary.canonicalERC6551Registry) !== ROBINHOOD.canonicalERC6551Registry
    || bytes32(canary.canonicalERC6551RegistryRuntimeCodeHash)
      !== ROBINHOOD.canonicalERC6551RegistryRuntimeCodeHash
    || String(canary.controllingPunkTokenId ?? "") !== PUNK_TOKEN_ID
    || !address(canary.expectedActivatedPunkAccount)
    || !address(canary.expectedOwnerAtPreparation)
    || !bytes32(canary.expectedActivatedPunkAccountRuntimeCodeHash)
    || !verifiedAdoption(canary, CANARY_NAMES)
    || canary.provenanceGate?.status !== "VERIFIED"
    || canary.provenanceGate?.dualRpcAgreementRequired !== true
    || REQUIRED_PROVENANCE_VERIFICATIONS.some(
      (field) => canary.provenanceGate?.[field] !== true,
    )
    || CANARY_NAMES.some((name) => !verifiedRecord(canary.contracts?.[name], { receipt: true }))) {
    return Object.freeze({
      deploymentStatus: "DEPLOYED",
      canaryStatus: "NOT_DEPLOYED",
      reason: "CANARY_MANIFEST_NOT_DEPLOYED",
      accountRegistry: address(coreContracts.GoghPunkAccountRegistry.address),
      accountImplementation: address(coreContracts.GoghPunkAccountV1.address),
      policyModule: address(coreContracts.BrokerPolicyModule.address),
      agentRegistry: address(coreContracts.ArtAgentRegistry.address),
      adapterRegistry: address(coreContracts.ArtAdapterRegistry.address),
      canary: null,
    });
  }

  const art = canary.contracts.GoghOneShotCanaryArt;
  const adapter = canary.contracts.GoghOneShotCanaryMintAdapter;
  return Object.freeze({
    deploymentStatus: "DEPLOYED",
    canaryStatus: "DEPLOYED",
    reason: null,
    accountRegistry: address(coreContracts.GoghPunkAccountRegistry.address),
    accountImplementation: address(coreContracts.GoghPunkAccountV1.address),
    policyModule: address(coreContracts.BrokerPolicyModule.address),
    agentRegistry: address(coreContracts.ArtAgentRegistry.address),
    adapterRegistry: address(coreContracts.ArtAdapterRegistry.address),
    canary: Object.freeze({
      chainId: ROBINHOOD.chainId,
      punkCollection: ROBINHOOD.canonicalCollection,
      punkTokenId: PUNK_TOKEN_ID,
      expectedOwner: address(canary.expectedOwnerAtPreparation),
      account: address(canary.expectedActivatedPunkAccount),
      accountRuntimeCodeHash: bytes32(canary.expectedActivatedPunkAccountRuntimeCodeHash),
      policyModule: address(coreContracts.BrokerPolicyModule.address),
      adapter: address(adapter.address),
      adapterRuntimeCodeHash: bytes32(adapter.runtimeBytecodeHash),
      venue: address(art.address),
      collection: address(art.address),
      artRuntimeCodeHash: bytes32(art.runtimeBytecodeHash),
      tokenId: String(canary.canaryArtTokenId),
      functionSelector: FUNCTION_SELECTOR,
      mintSelector: MINT_SELECTOR,
      value: "0",
      coreManifestSha256,
      canaryManifestSha256: canonicalSha256(canary),
    }),
  });
}

export const CURRENT_BROKER_DEPLOYMENT_SURFACE = brokerDeploymentSurface();
