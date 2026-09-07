import { getAddress, isAddress } from "viem";

import { ENTRY_POINT_V08 } from "./punk-agent-account-setup.mjs";

export const PUNK_AGENT_ACCOUNT_DEPLOYMENT_SCHEMA =
  "GOGH_PUNK_AGENT_ACCOUNT_DEPLOYMENT_V1";
export const PUNK_AGENT_ACCOUNT_DEPLOYMENT_STATUSES = Object.freeze([
  "UNDEPLOYED", "DEPLOYED",
]);

const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const DEPLOYED_CONTRACTS = Object.freeze([
  "GoghPunkAgentAccount", "GoghPunkAgentAccountRegistry",
]);
const CONFIGURATION_GATES = Object.freeze([
  "sourceVerified", "adapterRegistrationConfirmed", "bundlerConfigured",
  "sessionSignerConfigured", "receiptReconciliationEnabled", "workerEnabled",
]);

function fail(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail("INVALID_MANIFEST", `${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  plain(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_MANIFEST", `${label} has an unexpected field set`);
  }
}

function address(value, label) {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    fail("INVALID_MANIFEST", `${label} must be an EVM address`);
  }
  return getAddress(value);
}

function contractRecord(value, name) {
  exactKeys(value, [
    "address", "deploymentTransaction", "deploymentBlock", "runtimeBytecodeHash",
    "verificationStatus",
  ], `contracts.${name}`);
  const deploymentTransaction = String(value.deploymentTransaction ?? "").toLowerCase();
  const runtimeBytecodeHash = String(value.runtimeBytecodeHash ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(deploymentTransaction)
    || !/^0x[0-9a-f]{64}$/.test(runtimeBytecodeHash)
    || !Number.isSafeInteger(value.deploymentBlock) || value.deploymentBlock <= 0
    || value.verificationStatus !== "VERIFIED") {
    fail("INVALID_MANIFEST", `${name} deployment evidence is incomplete`);
  }
  return Object.freeze({ address: address(value.address, `${name}.address`),
    deploymentTransaction, deploymentBlock: value.deploymentBlock,
    runtimeBytecodeHash, verificationStatus: "VERIFIED" });
}

export function normalizePunkAgentAccountDeployment(value) {
  exactKeys(value, [
    "schema", "version", "status", "chainId", "network", "canonicalCollection",
    "entryPoint", "contracts", "reusedContracts", "configuration", "authorization", "notes",
  ], "manifest");
  if (value.schema !== PUNK_AGENT_ACCOUNT_DEPLOYMENT_SCHEMA || value.version !== 1
    || !PUNK_AGENT_ACCOUNT_DEPLOYMENT_STATUSES.includes(value.status)
    || value.chainId !== 4663 || value.network !== "Robinhood Chain"
    || address(value.canonicalCollection, "canonicalCollection").toLowerCase() !== COLLECTION
    || address(value.entryPoint, "entryPoint").toLowerCase() !== ENTRY_POINT_V08) {
    fail("INVALID_MANIFEST", "Punk Agent Account deployment identity is invalid");
  }
  exactKeys(value.contracts, DEPLOYED_CONTRACTS, "contracts");
  exactKeys(value.reusedContracts, [
    "ArtAdapterRegistry", "AutomatedSeaDropStudioFreeMintAdapter", "SeaDrop",
  ], "reusedContracts");
  const reusedContracts = Object.freeze(Object.fromEntries(Object.entries(value.reusedContracts)
    .map(([name, item]) => [name, address(item, `reusedContracts.${name}`)])));
  exactKeys(value.configuration, CONFIGURATION_GATES, "configuration");
  if (CONFIGURATION_GATES.some((gate) => typeof value.configuration[gate] !== "boolean")) {
    fail("INVALID_MANIFEST", "deployment configuration gates must be boolean");
  }
  exactKeys(value.authorization, [
    "deploymentAuthorized", "automaticSubmissionEnabled",
  ], "authorization");
  if (typeof value.authorization.deploymentAuthorized !== "boolean"
    || typeof value.authorization.automaticSubmissionEnabled !== "boolean"
    || typeof value.notes !== "string" || value.notes.length < 1 || value.notes.length > 2_000) {
    fail("INVALID_MANIFEST", "deployment authorization or notes are invalid");
  }
  const contracts = {};
  for (const name of DEPLOYED_CONTRACTS) {
    const record = value.contracts[name];
    contracts[name] = record === null ? null : contractRecord(record, name);
  }
  if (value.status === "UNDEPLOYED") {
    if (Object.values(contracts).some(Boolean)
      || Object.values(value.configuration).some(Boolean)
      || value.authorization.deploymentAuthorized
      || value.authorization.automaticSubmissionEnabled) {
      fail("INVALID_MANIFEST", "undeployed manifest cannot grant readiness or authority");
    }
  } else if (Object.values(contracts).some((record) => record === null)
    || !value.authorization.deploymentAuthorized) {
    fail("INVALID_MANIFEST", "deployed manifest lacks verified contract evidence");
  }
  return Object.freeze({ ...value, canonicalCollection: getAddress(value.canonicalCollection),
    entryPoint: getAddress(value.entryPoint), contracts: Object.freeze(contracts),
    reusedContracts, configuration: Object.freeze({ ...value.configuration }),
    authorization: Object.freeze({ ...value.authorization }) });
}

export function punkAgentAccountReadiness(value) {
  const manifest = normalizePunkAgentAccountDeployment(value);
  const blockers = [];
  if (manifest.status !== "DEPLOYED") blockers.push("CONTRACTS_NOT_DEPLOYED");
  for (const gate of CONFIGURATION_GATES) {
    if (!manifest.configuration[gate]) blockers.push(gate.replaceAll(/([A-Z])/g, "_$1").toUpperCase());
  }
  if (!manifest.authorization.automaticSubmissionEnabled) {
    blockers.push("AUTOMATIC_SUBMISSION_NOT_AUTHORIZED");
  }
  const setupBlockers = blockers.filter((blocker) => [
    "CONTRACTS_NOT_DEPLOYED", "SOURCE_VERIFIED", "ADAPTER_REGISTRATION_CONFIRMED",
  ].includes(blocker));
  return Object.freeze({ ready: blockers.length === 0,
    automaticExecutionReady: blockers.length === 0,
    ownerSetupReady: setupBlockers.length === 0, status: manifest.status,
    setupBlockers: Object.freeze(setupBlockers),
    blockers: Object.freeze(blockers), maximumOwnerTransactions: 2,
    walletPopupRequiredPerMint: false,
    accountRegistry: manifest.contracts.GoghPunkAgentAccountRegistry?.address ?? null,
    accountImplementation: manifest.contracts.GoghPunkAgentAccount?.address ?? null,
    entryPoint: manifest.entryPoint });
}
