import { encodeAbiParameters, encodeEventTopics } from "viem";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import {
  attestCanaryMintReceipt,
  CANARY_MINT_RECEIPT_ABIS,
} from "../../scripts/canary-mint-receipt-attestation.mjs";
import {
  ACCOUNT,
  ADAPTER,
  ART,
  ART_TOKEN_ID,
  buildCanaryMintArtifactFixtures,
  fixtureHash,
  GUARDIAN,
  MINT_TX_HASH,
  OWNER,
  PARENT_BLOCK_HASH,
  PUNK_TOKEN_ID,
  RECEIPT_BLOCK_HASH,
  RECEIPT_BLOCK_NUMBER,
  RECEIPT_TIMESTAMP,
  runtimeCodeByAddress,
  TRANSACTION_INDEX,
  ZERO_ADDRESS,
} from "./canary-mint-fixtures.mjs";

export function canaryMintEventLog(event, args, emitter, logIndex, overrides = {}) {
  const unindexed = event.inputs.filter((input) => !input.indexed);
  const log = {
    address: emitter,
    blockHash: RECEIPT_BLOCK_HASH,
    blockNumber: RECEIPT_BLOCK_NUMBER,
    data: encodeAbiParameters(unindexed, unindexed.map((input) => args[input.name])),
    logIndex,
    topics: encodeEventTopics({ abi: [event], eventName: event.name, args }),
    transactionHash: MINT_TX_HASH,
    transactionIndex: TRANSACTION_INDEX,
  };
  return { ...log, ...overrides };
}

function receiptLogs(fixtures) {
  const opportunityId = fixtures.executionArtifact.reviewedAcquisition.intent.opportunityId;
  const reasoningHash = fixtures.executionArtifact.reviewedAcquisition.intent.reasoningHash;
  return [
    canaryMintEventLog(CANARY_MINT_RECEIPT_ABIS.acquisitionConsumedEvent, {
      account: ACCOUNT, opportunityId, currency: ZERO_ADDRESS, amount: 0n, spentToday: 0n,
      spentThisWeek: 0n, acquisitionsToday: 1, ownerApproved: true, policyVersion: 11n,
    }, fixtures.coreManifest.contracts.BrokerPolicyModule.address, 10n),
    canaryMintEventLog(CANARY_MINT_RECEIPT_ABIS.transferEvent, {
      from: ZERO_ADDRESS, to: ACCOUNT, tokenId: BigInt(ART_TOKEN_ID),
    }, ART, 11n),
    canaryMintEventLog(CANARY_MINT_RECEIPT_ABIS.erc721ReceivedEvent, {
      collection: ART, tokenId: BigInt(ART_TOKEN_ID), from: ZERO_ADDRESS,
      operator: ACCOUNT, state: 1n,
    }, ACCOUNT, 12n),
    canaryMintEventLog(CANARY_MINT_RECEIPT_ABIS.acquisitionExecutedEvent, {
      executor: OWNER, opportunityId, collection: ART, opportunityType: 2,
      assetStandard: 0, adapter: ADAPTER, venue: ART, tokenId: BigInt(ART_TOKEN_ID),
      assetAmount: 1n, currency: ZERO_ADDRESS, price: 0n, ownerApproved: true,
      reasoningHash, policyVersion: 11n, nonce: 0n, state: 2n,
    }, ACCOUNT, 13n),
  ];
}

function blockHash(number) {
  if (number === RECEIPT_BLOCK_NUMBER) return RECEIPT_BLOCK_HASH;
  if (number === RECEIPT_BLOCK_NUMBER - 1n) return PARENT_BLOCK_HASH;
  return `0x${number.toString(16).padStart(64, "0")}`;
}

function blockTimestamp(number) {
  return RECEIPT_TIMESTAMP + (number - RECEIPT_BLOCK_NUMBER);
}

export function createCanaryMintWorld(fixtures = buildCanaryMintArtifactFixtures()) {
  const logs = receiptLogs(fixtures);
  return {
    fixtures,
    chainId: 4663,
    head: RECEIPT_BLOCK_NUMBER + 20n,
    logs,
    extraLogs: [],
    transaction: {
      hash: MINT_TX_HASH,
      from: OWNER,
      to: ACCOUNT,
      value: 0n,
      input: fixtures.executionArtifact.transaction.data,
      blockHash: RECEIPT_BLOCK_HASH,
      blockNumber: RECEIPT_BLOCK_NUMBER,
      transactionIndex: TRANSACTION_INDEX,
      nonce: 77,
      maxFeePerBlobGas: undefined,
    },
    receipt: {
      transactionHash: MINT_TX_HASH,
      from: OWNER,
      to: ACCOUNT,
      blockHash: RECEIPT_BLOCK_HASH,
      blockNumber: RECEIPT_BLOCK_NUMBER,
      transactionIndex: TRANSACTION_INDEX,
      status: "success",
      contractAddress: null,
      logs,
      blobGasPrice: undefined,
    },
    runtimeCodes: runtimeCodeByAddress(fixtures),
    storage: new Map(),
    owner: OWNER,
    accountNonce: 1n,
    accountState: 2n,
    minted: true,
    artOwner: ACCOUNT,
    artBalance: 1n,
    artApproved: ZERO_ADDRESS,
    operatorApproved: false,
    parentMinted: false,
    parentArtBalance: 0n,
    nativeBalanceBefore: 42n,
    nativeBalanceAfter: 42n,
    policyVersion: 11n,
    policyGeneration: 1n,
    policyPaused: false,
    adapterActive: true,
  };
}

function requestBlockNumber(request) {
  return request.blockNumber === undefined ? RECEIPT_BLOCK_NUMBER : BigInt(request.blockNumber);
}

function readContract(world, request) {
  const target = request.address.toLowerCase();
  const name = request.functionName;
  const args = request.args ?? [];
  const blockNumber = requestBlockNumber(request);
  const core = world.fixtures.coreManifest.contracts;
  const policy = core.BrokerPolicyModule.address.toLowerCase();
  const adapterRegistry = core.ArtAdapterRegistry.address.toLowerCase();
  const agentRegistry = core.ArtAgentRegistry.address.toLowerCase();
  const accountRegistry = core.GoghPunkAccountRegistry.address.toLowerCase();

  if (name === "ownerOf") return target === ROBINHOOD.canonicalCollection
    ? world.owner : world.artOwner;
  if (name === "balanceOf") {
    if (target === ART && blockNumber === RECEIPT_BLOCK_NUMBER - 1n) return world.parentArtBalance;
    return world.artBalance;
  }
  if (name === "owner") return target === ACCOUNT ? world.owner : GUARDIAN;
  if (name === "pendingOwner") return ZERO_ADDRESS;
  if (name === "token") return { chainId: 4663n, tokenContract: ROBINHOOD.canonicalCollection,
    tokenId: BigInt(PUNK_TOKEN_ID) };
  if (name === "isCanonicalGoghPunkAccount") return true;
  if (name === "policyModule") return core.BrokerPolicyModule.address;
  if (name === "agentRegistry") return core.ArtAgentRegistry.address;
  if (name === "adapterRegistry") return core.ArtAdapterRegistry.address;
  if (name === "acquisitionNonce") return world.accountNonce;
  if (name === "state") return world.accountState;
  if (name === "ROBINHOOD_CHAIN_ID") return 4663n;
  if (name === "GOGH_PUNKS") return ROBINHOOD.canonicalCollection;
  if (name === "CANONICAL_ERC6551_REGISTRY" || name === "canonicalRegistry") {
    return ROBINHOOD.canonicalERC6551Registry;
  }
  if (name === "implementation") return core.GoghPunkAccountV1.address;
  if (name === "account") return ACCOUNT;
  if (name === "globallyPaused") return world.policyPaused;
  if (name === "featureFlags") return {
    scoutMode: true, approvalPurchases: true, autonomousPurchases: false,
    autonomousMints: false, unknownCollectionExecution: false, selling: false,
    autonomousSelling: false,
  };
  if (name === "policy") return {
    config: { mode: 2, maxSpendPerTransaction: 0n, maxSpendPerDay: 0n,
      maxSpendPerWeek: 0n, maxMintPrice: 0n, maxSecondaryPurchasePrice: 0n,
      minimumNativeReserve: 0n, maxAcquisitionsPerDay: 1, maxIntentAge: 120,
      maxSlippageBps: 0, requireCollectionAllowlist: true, allowUnknownCollections: false },
    configuredBy: OWNER, version: world.policyVersion,
    permissionGeneration: world.policyGeneration, accountPaused: false,
  };
  if (name === "effectiveMode") return 2;
  if (name === "mintControls") return { ownerApprovedMints: true,
    autonomousFreeMints: false, autonomousPaidMints: false };
  if (["approvedAdapters", "approvedMintContracts", "approvedCollections",
    "approvedSelectors"].includes(name)) return true;
  if (["deniedCollections", "deniedSelectors"].includes(name)) return false;
  if (name === "currencyPolicy") return { allowed: true, maxSpendPerTransaction: 0n,
    maxSpendPerDay: 0n, maxSpendPerWeek: 0n, maxMintPrice: 0n,
    maxSecondaryPurchasePrice: 0n };
  if (name === "venueCurrencyMaximum") return 0n;
  const timestamp = blockTimestamp(blockNumber);
  if (name === "usage") return { dayBucket: timestamp / 86_400n,
    weekBucket: timestamp / 604_800n, acquisitionsToday: 1,
    spentToday: 0n, spentThisWeek: 0n };
  if (name === "acquisitionUsage") return { dayBucket: timestamp / 86_400n,
    acquisitionsToday: 1 };
  if (name === "adapterRecord") {
    const commitment = world.fixtures.configBundleArtifact.review.adapterRegistrationCommitment;
    return { kind: 1, active: world.adapterActive, venue: ART,
      adapterCodeHash: world.fixtures.executionArtifact.confirmedEvidence.hashes.adapterRuntimeCode,
      venueCodeHash: world.fixtures.executionArtifact.confirmedEvidence.hashes.collectionRuntimeCode,
      versionHash: commitment.versionHash, metadataHash: commitment.metadataHash };
  }
  if (name === "kind") return 1;
  if (name === "venue" || name === "collection" || name === "canaryCollection") return ART;
  if (name === "mintSelector") return "0x40c10f19";
  if (name === "assetStandard") return 0;
  if (name === "boundAccount" || name === "punkAccount") return ACCOUNT;
  if (name === "boundTokenId" || name === "canaryTokenId") return BigInt(ART_TOKEN_ID);
  if (name === "minted") return blockNumber === RECEIPT_BLOCK_NUMBER - 1n
    ? world.parentMinted : world.minted;
  if (name === "getApproved") return world.artApproved;
  if (name === "isApprovedForAll") return world.operatorApproved;
  if (name === "punkAccountRegistry") return core.GoghPunkAccountRegistry.address;
  if (name === "controllingPunkTokenId") return BigInt(PUNK_TOKEN_ID);
  throw new Error(`unhandled read ${target}.${name}(${args.length})`);
}

export function canaryMintWorldClient(world, url) {
  return {
    transport: { url },
    async getChainId() { return world.chainId; },
    async getBlockNumber() { return world.head; },
    async getBlock(request) {
      const number = BigInt(request.blockNumber);
      const transactions = number === RECEIPT_BLOCK_NUMBER
        ? [fixtureHash("1"), fixtureHash("2"), fixtureHash("3"), MINT_TX_HASH]
        : [];
      return { number, hash: blockHash(number),
        parentHash: number === RECEIPT_BLOCK_NUMBER && world.parentHashOverride
          ? world.parentHashOverride : blockHash(number - 1n),
        timestamp: number === RECEIPT_BLOCK_NUMBER && world.receiptTimestampOverride
          ? world.receiptTimestampOverride : blockTimestamp(number),
        transactions, excessBlobGas: undefined };
    },
    async getTransaction() { return world.transaction; },
    async getTransactionReceipt() { return world.receipt; },
    async getCode({ address: target }) {
      if (target.toLowerCase() === OWNER) return "0x";
      return world.runtimeCodes.get(target.toLowerCase()) ?? "0x";
    },
    async getStorageAt({ address: target, slot }) {
      return world.storage.get(`${target.toLowerCase()}:${slot.toLowerCase()}`) ?? undefined;
    },
    async getBalance({ blockNumber }) {
      return BigInt(blockNumber) === RECEIPT_BLOCK_NUMBER - 1n
        ? world.nativeBalanceBefore : world.nativeBalanceAfter;
    },
    async getLogs(request) {
      const from = BigInt(request.fromBlock);
      const to = BigInt(request.toBlock);
      const targets = Array.isArray(request.address)
        ? request.address.map((item) => item.toLowerCase()) : [request.address.toLowerCase()];
      return [...world.logs, ...world.extraLogs].filter((log) => (
        targets.includes(log.address.toLowerCase())
          && log.blockNumber >= from && log.blockNumber <= to
      ));
    },
    async readContract(request) { return readContract(world, request); },
  };
}

export function canaryMintRpcDependencies(primaryWorld, secondaryWorld = primaryWorld) {
  return {
    primaryClient: canaryMintWorldClient(primaryWorld, "https://alpha-rpc.example/api"),
    secondaryClient: canaryMintWorldClient(secondaryWorld, "https://beta-rpc.test/key"),
    endpointOrigins: ["https://alpha-rpc.example", "https://beta-rpc.test"],
  };
}

export async function attestCanaryMintFixture(
  world = createCanaryMintWorld(),
  secondaryWorld = world,
  options = {},
  clock = () => Number(RECEIPT_TIMESTAMP),
) {
  return attestCanaryMintReceipt(
    world.fixtures,
    canaryMintRpcDependencies(world, secondaryWorld),
    { confirmations: 20, ...options },
    clock,
  );
}
