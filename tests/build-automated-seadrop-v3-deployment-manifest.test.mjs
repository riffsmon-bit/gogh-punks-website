import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { encodeAbiParameters } from "viem";

import {
  AUTOMATION_V3_DEPLOYMENT_ORDER,
  buildAutomatedSeaDropV3DeploymentManifestProposal,
  verifyAutomationV3SourceProvenance,
} from "../scripts/build-automated-seadrop-v3-deployment-manifest.mjs";

const RELEASE = "f75f72b8407a4f01fb6497a24cd67946a0845930";
const DEPLOYER = "0xF868ff40975F7C3AeDDF1B2CE026aE53897bA698";
const GUARDIAN = "0x2b05E3BB4895A00d52894B98839Ae421d4139Ec8";
const ADAPTER_REGISTRY = "0x421D51709Fe21736a35fFa2a86B157Df1b030EE2";
const AGENT_REGISTRY = "0xbffbccd20E796e0f3E745B274De60EF17a485Dde";
const COLLECTION = "0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6";
const CANONICAL_REGISTRY = "0x000000006551c19487814612e58FE06813775758";
const ZERO = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = `0x${"0".repeat(64)}`;
const H = (digit) => `0x${digit.repeat(64)}`;

const names = AUTOMATION_V3_DEPLOYMENT_ORDER;
const broadcastNames = [
  "AutomatedSeaDropStudioFreeMintAdapter", "BrokerPolicyModuleV2",
  "GoghPunkAccountV1", "GoghPunkAccountRegistryV3",
];
const addresses = {
  AutomatedSeaDropStudioFreeMintAdapter: "0x70e8b0361b36bab3b398ab9dD0D9E370A70912b2",
  BrokerPolicyModuleV3: "0x4a80F21513C788884B4935edC27d119D059c0a9B",
  GoghPunkAccountV3: "0xa2f76E063f50178FCe534E50E40a6Daab83F4eAd",
  GoghPunkAccountRegistryV3: "0x00E7D2A869cc6a8f61A4cE11A66A8874db1F78e3",
};
const args = {
  AutomatedSeaDropStudioFreeMintAdapter: [H("5"), H("d")],
  BrokerPolicyModuleV3: [GUARDIAN, ADAPTER_REGISTRY, addresses.AutomatedSeaDropStudioFreeMintAdapter],
  GoghPunkAccountV3: [addresses.BrokerPolicyModuleV3, AGENT_REGISTRY, ADAPTER_REGISTRY],
  GoghPunkAccountRegistryV3: [addresses.GoghPunkAccountV3, ZERO_HASH],
};
args.AutomatedSeaDropStudioFreeMintAdapter = [
  "0x53e4b9339cf624803c9a7d0195576cca5b917920813508d86b3eb93dcbabeb5c",
  "0xda60742d810ae5de9c087af2e82b05fb84e9112cfade927fca0db6490ea52519",
  "0x69e7a7158f30acb817dc83a4e21af19a216c3a2ae57db423599ca82f321e3041",
];

const paths = {
  AutomatedSeaDropStudioFreeMintAdapter:
    "contracts/out/AutomatedSeaDropStudioFreeMintAdapter.sol/AutomatedSeaDropStudioFreeMintAdapter.json",
  BrokerPolicyModuleV3: "contracts/out/BrokerPolicyModuleV3.sol/BrokerPolicyModuleV3.json",
  GoghPunkAccountV3: "contracts/out/GoghPunkAccountV1.sol/GoghPunkAccountV1.json",
  GoghPunkAccountRegistryV3:
    "contracts/out/GoghPunkAccountRegistryV3.sol/GoghPunkAccountRegistryV3.json",
};

async function artifacts() {
  return Object.fromEntries(await Promise.all(names.map(async (name) => [
    name, JSON.parse(await readFile(new URL(`../${paths[name]}`, import.meta.url), "utf8")),
  ])));
}

function fixture(compiledArtifacts) {
  const records = names.map((name, index) => {
    const artifact = compiledArtifacts[name];
    const constructor = artifact.abi.find((item) => item.type === "constructor");
    const encoded = encodeAbiParameters(constructor.inputs, args[name]);
    const input = `${artifact.bytecode.object}${encoded.slice(2)}`;
    const txHash = H(String(index + 1));
    const blockHash = H(String(index + 5));
    return {
      name, txHash, blockHash, blockNumber: 900 + index, input,
      code: artifact.deployedBytecode.object,
    };
  });
  const broadcastArtifact = {
    transactions: records.map((record, index) => ({
      hash: record.txHash,
      transactionType: "CREATE",
      contractName: broadcastNames[index],
      contractAddress: addresses[record.name],
      function: null,
      arguments: args[record.name],
      transaction: {
        from: DEPLOYER, gas: "0x100000", value: "0x0", input: record.input,
        nonce: `0x${(14 + index).toString(16)}`, chainId: "0x1237",
      },
      additionalContracts: [],
      isFixedGasLimit: false,
    })),
    receipts: records.map((record) => ({
      status: "0x1", transactionHash: record.txHash, transactionIndex: "0x0",
      blockHash: record.blockHash, blockNumber: `0x${record.blockNumber.toString(16)}`,
      from: DEPLOYER, to: null, contractAddress: addresses[record.name], logs: [],
    })),
    libraries: [], pending: [], returns: {}, timestamp: 1, chain: 4663, commit: "f75f72b",
  };
  const sourceProvenance = {
    releaseGitCommit: RELEASE, headCommit: RELEASE, artifactResolvedCommit: RELEASE,
    foundryArtifactCommit: "f75f72b", compilerInputsClean: true,
    offlineBuildCompleted: true, offlineBuildCommand: ["forge", "build", "--offline", "--force"],
  };
  function resultForRead(address, functionName) {
    const key = address.toLowerCase();
    const table = {
      [addresses.AutomatedSeaDropStudioFreeMintAdapter.toLowerCase()]: {
        expectedSeaDropCodeHash: args.AutomatedSeaDropStudioFreeMintAdapter[0],
        expectedCloneImplementationCodeHash: args.AutomatedSeaDropStudioFreeMintAdapter[1],
        expectedCloneRuntimeCodeHash:
          "0xe3e252831cdd0c11e1327d04a57ddd9bfa11ef49d50edb524040d98bfb228bc4",
        expectedStudioRuntimeCodeHash: args.AutomatedSeaDropStudioFreeMintAdapter[2],
      },
      [addresses.BrokerPolicyModuleV3.toLowerCase()]: {
        owner: GUARDIAN, pendingOwner: ZERO, adapterRegistry: ADAPTER_REGISTRY,
        automatedSeaDropAdapter: addresses.AutomatedSeaDropStudioFreeMintAdapter,
      },
      [addresses.GoghPunkAccountV3.toLowerCase()]: {
        GOGH_PUNKS: COLLECTION, ROBINHOOD_CHAIN_ID: 4663n,
        policyModule: addresses.BrokerPolicyModuleV3, agentRegistry: AGENT_REGISTRY,
        adapterRegistry: ADAPTER_REGISTRY,
      },
      [addresses.GoghPunkAccountRegistryV3.toLowerCase()]: {
        implementation: addresses.GoghPunkAccountV3, accountSalt: ZERO_HASH,
        canonicalRegistry: CANONICAL_REGISTRY,
      },
    };
    return table[key]?.[functionName];
  }
  function client(url, head) {
    return {
      transport: { url },
      getChainId: async () => 4663,
      getBlockNumber: async () => head,
      getBlock: async ({ blockNumber }) => {
        const record = records.find((item) => BigInt(item.blockNumber) === blockNumber);
        return record
          ? { number: blockNumber, hash: record.blockHash, timestamp: 1_000n,
            transactions: [record.txHash], blobGasUsed: undefined }
          : { number: blockNumber, hash: H("a"), timestamp: 2_000n,
            transactions: [], blobGasUsed: undefined };
      },
      getTransaction: async ({ hash }) => {
        const record = records.find((item) => item.txHash === hash);
        const index = records.indexOf(record);
        return { hash, from: DEPLOYER, to: null, value: 0n, chainId: 4663,
          nonce: 14 + index, input: record.input, maxFeePerBlobGas: undefined };
      },
      getTransactionReceipt: async ({ hash }) => {
        const record = records.find((item) => item.txHash === hash);
        return { status: "success", transactionHash: hash, transactionIndex: 0,
          blockNumber: BigInt(record.blockNumber), blockHash: record.blockHash,
          from: DEPLOYER, to: null, contractAddress: addresses[record.name],
          blobGasPrice: undefined };
      },
      getCode: async ({ address }) => records.find((item) => (
        addresses[item.name].toLowerCase() === address.toLowerCase()
      ))?.code,
      readContract: async ({ address, functionName }) => resultForRead(address, functionName),
    };
  }
  return {
    releaseGitCommit: RELEASE,
    confirmations: 20,
    broadcastArtifact,
    compiledArtifacts,
    sourceProvenance,
    readEndpoints: [
      { origin: "https://rpc.first.example", client: client("https://rpc.first.example", 1_000n) },
      { origin: "https://rpc.second.test", client: client("https://rpc.second.test", 1_004n) },
    ],
  };
}

test("builds a fail-closed V3 deployment proposal with configuration still disabled", async () => {
  const input = fixture(await artifacts());
  const result = await buildAutomatedSeaDropV3DeploymentManifestProposal(input);
  assert.equal(result.proposalStatus,
    "AUTOMATION_V3_MANIFEST_PROPOSAL_SOURCE_VERIFICATION_PENDING");
  assert.equal(result.manifest.status, "DEPLOYED");
  assert.equal(result.manifest.configuration.adapterRegistered, false);
  assert.equal(result.manifest.authorization.automaticSubmissionEnabled, false);
  assert.equal(result.manifest.contracts.GoghPunkAccountV3.receiptStatus, "SUCCESS");
  assert.equal(result.trustBindings.commonConfirmedBlock.number, 980);
});

test("rejects wrong runtime, constructor, provider, and critical bindings", async () => {
  const base = fixture(await artifacts());
  const mutations = [
    (value) => { value.readEndpoints[1].client.getCode = async () => "0x6000"; },
    (value) => { value.broadcastArtifact.transactions[0].arguments[0] = H("9"); },
    (value) => { value.readEndpoints[1].origin = "https://alias.first.example";
      value.readEndpoints[1].client.transport.url = "https://alias.first.example"; },
    (value) => { value.readEndpoints[1].client.readContract = async ({ functionName }) => (
      functionName === "owner" ? DEPLOYER
        : base.readEndpoints[0].client.readContract({
          address: addresses.BrokerPolicyModuleV3, functionName,
        })
    ); },
  ];
  for (const mutate of mutations) {
    const value = fixture(await artifacts());
    mutate(value);
    await assert.rejects(
      buildAutomatedSeaDropV3DeploymentManifestProposal(value),
      /MISMATCH|DISAGREEMENT|DUPLICATE|INITCODE/,
    );
  }
});

test("source provenance requires exact clean HEAD before and after offline build", async () => {
  const calls = [];
  const runProgram = async (program, arguments_) => {
    calls.push([program, ...arguments_]);
    if (program === "forge") return { stdout: "", stderr: "" };
    if (arguments_[0] === "status") return { stdout: "", stderr: "" };
    return { stdout: `${RELEASE}\n`, stderr: "" };
  };
  const result = await verifyAutomationV3SourceProvenance({
    releaseGitCommit: RELEASE,
    foundryArtifactCommit: "f75f72b",
    runProgram,
  });
  assert.equal(result.offlineBuildCompleted, true);
  assert.deepEqual(calls.filter(([program]) => program === "forge"), [
    ["forge", "build", "--offline", "--force"],
  ]);
});
