import { createHash } from "node:crypto";

import { encodeFunctionData, keccak256, parseAbi } from "viem";

import { normalizeV2Opportunity } from "./opportunity.mjs";
import {
  V2_OPEN_SEA_FEE_RECIPIENT,
  V2_REVIEWED_COLLECTION_CODE_HASHES,
  V2_SEADROP,
  V2_SEADROP_ADAPTER,
  V2_SEADROP_ADAPTER_CODE_HASH,
  V2_SEADROP_CODE_HASH,
} from "./discovery/seadrop-ingestor.mjs";

export const V2_OWNER_ASSISTED_MINT_SCHEMA = "GOGH_V2_OWNER_ASSISTED_SEADROP_MINT_V1";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADDRESS = /^0x[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REVIEWED_COLLECTION_HASHES = new Set(V2_REVIEWED_COLLECTION_CODE_HASHES);

const SEA_DROP_ABI = parseAbi([
  "function getPublicDrop(address nftContract) view returns ((uint80 mintPrice,uint48 startTime,uint48 endTime,uint16 maxTotalMintableByWallet,uint16 feeBps,bool restrictFeeRecipients))",
  "function getFeeRecipientIsAllowed(address nftContract,address feeRecipient) view returns (bool)",
  "function mintPublic(address nftContract,address feeRecipient,address minterIfNotPayer,uint256 quantity) payable",
]);
const COLLECTION_ABI = parseAbi([
  "function getMintStats(address minter) view returns (uint256 minterNumMinted,uint256 currentTotalMinted,uint256 maxSupply)",
]);
const ACCOUNT_ABI = parseAbi([
  "function execute(address to,uint256 value,bytes data,uint8 operation) payable returns (bytes result)",
]);

export class V2OwnerAssistedMintError extends Error {
  constructor(code, message) { super(message); this.name = "V2OwnerAssistedMintError"; this.code = code; }
}

function fail(code, message) { throw new V2OwnerAssistedMintError(code, message); }

function address(value, label) {
  const output = String(value ?? "").toLowerCase();
  if (!ADDRESS.test(output)) fail("INVALID_ADDRESS", `${label} is invalid`);
  return output;
}

function tupleValue(value, key, index) {
  const output = value?.[key] ?? value?.[index];
  if (output === undefined) fail("RPC_MALFORMED", `SeaDrop ${key} is unavailable`);
  return output;
}

function inputHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function ownerAssistedTransactionEnvelopeHash(transaction) {
  if (!transaction || typeof transaction !== "object" || Array.isArray(transaction)) {
    throw new TypeError("owner-assisted transaction is invalid");
  }
  const from = address(transaction.from, "transaction owner");
  const to = address(transaction.to, "transaction Punk Wallet");
  const value = String(transaction.value ?? "").toLowerCase();
  const data = String(transaction.data ?? "").toLowerCase();
  if (value !== "0x0" || !/^0x(?:[0-9a-f]{2})+$/.test(data)) {
    throw new TypeError("owner-assisted transaction envelope is invalid");
  }
  return createHash("sha256").update([
    "GOGH_V2_OWNER_ASSISTED_TRANSACTION_V1", "4663", from, to, value, data,
  ].join("|")).digest("hex");
}

export function buildOwnerAssistedSeaDropTransaction({ owner, punkWallet, collection }) {
  const from = address(owner, "owner");
  const account = address(punkWallet, "Punk Wallet");
  const nft = address(collection, "collection");
  const innerData = encodeFunctionData({ abi: SEA_DROP_ABI, functionName: "mintPublic",
    args: [nft, V2_OPEN_SEA_FEE_RECIPIENT, ZERO_ADDRESS, 1n] });
  const data = encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "execute",
    args: [V2_SEADROP, 0n, innerData, 0] });
  return Object.freeze({ from, to: account, value: "0x0", data: data.toLowerCase(),
    dataKeccak256: keccak256(data).toLowerCase() });
}

export async function simulateOwnerAssistedSeaDropMint({ client, authority,
  opportunity: rawOpportunity, now = new Date() }) {
  if (!client || typeof client.getBlockNumber !== "function"
    || typeof client.getBlock !== "function"
    || typeof client.readContract !== "function" || typeof client.getCode !== "function"
    || typeof client.call !== "function" || typeof client.estimateGas !== "function"
    || typeof client.getGasPrice !== "function") {
    throw new TypeError("owner-assisted simulation client is invalid");
  }
  const opportunity = normalizeV2Opportunity(rawOpportunity, now);
  const owner = address(authority?.owner, "current owner");
  const punkWallet = address(authority?.punkWallet, "Punk Wallet");
  if (authority?.activated !== true) fail("PUNK_WALLET_INACTIVE", "Activate this Punk Wallet first");
  if (opportunity.screeningStatus !== "PASSED" || opportunity.priceWei !== "0"
    || opportunity.mintContract !== V2_SEADROP || opportunity.adapter !== V2_SEADROP_ADAPTER
    || opportunity.adapterCodeHash !== V2_SEADROP_ADAPTER_CODE_HASH
    || opportunity.mintMethod !== "mintPublic(address,address,address,uint256)"
    || !REVIEWED_COLLECTION_HASHES.has(opportunity.contractCodeHash)) {
    fail("UNSUPPORTED_OPPORTUNITY", "This opportunity is not a screened zero-price SeaDrop mint");
  }

  const blockNumber = await client.getBlockNumber();
  const [block, seaDropCode, adapterCode, collectionCode, drop, stats] = await Promise.all([
    client.getBlock({ blockNumber }),
    client.getCode({ address: V2_SEADROP, blockNumber }),
    client.getCode({ address: V2_SEADROP_ADAPTER, blockNumber }),
    client.getCode({ address: opportunity.collectionContract, blockNumber }),
    client.readContract({ address: V2_SEADROP, abi: SEA_DROP_ABI,
      functionName: "getPublicDrop", args: [opportunity.collectionContract], blockNumber }),
    client.readContract({ address: opportunity.collectionContract, abi: COLLECTION_ABI,
      functionName: "getMintStats", args: [punkWallet], blockNumber }),
  ]);
  if (!block || block.number !== blockNumber || typeof block.timestamp !== "bigint") {
    fail("RPC_MALFORMED", "the current Robinhood block is unavailable");
  }
  if (keccak256(seaDropCode ?? "0x").toLowerCase() !== V2_SEADROP_CODE_HASH
    || keccak256(adapterCode ?? "0x").toLowerCase() !== V2_SEADROP_ADAPTER_CODE_HASH
    || keccak256(collectionCode ?? "0x").toLowerCase() !== opportunity.contractCodeHash) {
    fail("CODE_CHANGED", "a reviewed contract changed before simulation");
  }
  const mintPrice = BigInt(tupleValue(drop, "mintPrice", 0));
  const startTime = BigInt(tupleValue(drop, "startTime", 1));
  const endTime = BigInt(tupleValue(drop, "endTime", 2));
  const walletLimit = BigInt(tupleValue(drop, "maxTotalMintableByWallet", 3));
  const restrictFeeRecipients = tupleValue(drop, "restrictFeeRecipients", 5) === true;
  const minterMinted = BigInt(tupleValue(stats, "minterNumMinted", 0));
  const currentSupply = BigInt(tupleValue(stats, "currentTotalMinted", 1));
  const maxSupply = BigInt(tupleValue(stats, "maxSupply", 2));
  if (mintPrice !== 0n) fail("PRICE_CHANGED", "the mint is no longer free");
  if (block.timestamp < startTime || block.timestamp > endTime) {
    fail("MINT_CLOSED", "the public mint is not open now");
  }
  if (walletLimit === 0n || minterMinted >= walletLimit) {
    fail("WALLET_LIMIT_REACHED", "this Punk Wallet reached the collection mint limit");
  }
  if (currentSupply >= maxSupply) fail("SOLD_OUT", "the collection sold out");
  if (restrictFeeRecipients) {
    const allowed = await client.readContract({ address: V2_SEADROP, abi: SEA_DROP_ABI,
      functionName: "getFeeRecipientIsAllowed",
      args: [opportunity.collectionContract, V2_OPEN_SEA_FEE_RECIPIENT], blockNumber });
    if (allowed !== true) fail("FEE_RECIPIENT_BLOCKED", "the reviewed SeaDrop fee recipient is not allowed");
  }

  const transaction = buildOwnerAssistedSeaDropTransaction({ owner, punkWallet,
    collection: opportunity.collectionContract });
  const request = { account: owner, to: punkWallet, value: 0n, data: transaction.data,
    blockNumber };
  const [simulation, gasEstimate, gasPrice] = await Promise.all([
    client.call(request), client.estimateGas(request), client.getGasPrice(),
  ]);
  if (!simulation || typeof simulation.data !== "string" || gasEstimate <= 0n || gasPrice <= 0n) {
    fail("SIMULATION_FAILED", "the exact Punk Wallet mint did not simulate successfully");
  }
  const expectedTokenId = currentSupply + 1n;
  const gasCostWei = gasEstimate * gasPrice;
  const simulatedAt = new Date(now).toISOString();
  const evidence = Object.freeze({ status: "PASSED", success: true, reverted: false,
    valueWei: "0", nftReceiver: punkWallet, expectedTokenId: expectedTokenId.toString(),
    estimatedGasWei: gasCostWei.toString(), gasUnits: gasEstimate.toString(),
    gasPriceWei: gasPrice.toString(), callDidNotRevert: true,
    effectTraceAvailable: false, postconditionPendingReceipt: true,
    pinnedBlock: blockNumber.toString(), simulatedAt,
    inputHash: inputHash({ opportunityId: opportunity.opportunityId, punkWallet,
      blockNumber: blockNumber.toString(), transactionHash: transaction.dataKeccak256 }) });
  return Object.freeze({ opportunity, transaction, evidence });
}

export function ownerAssistedMintArtifact(simulation, intent, now = new Date(), attempt = null) {
  const created = Math.floor(new Date(now).getTime() / 1_000);
  const expiresAt = created + 90;
  const attemptId = String(attempt?.attemptId ?? "").toLowerCase();
  const idempotencyKey = String(attempt?.idempotencyKey ?? "").toLowerCase();
  if (!UUID.test(attemptId) || !SHA256.test(idempotencyKey)) {
    throw new TypeError("owner-assisted execution attempt is invalid");
  }
  return Object.freeze({ schema: V2_OWNER_ASSISTED_MINT_SCHEMA, version: 1, chainId: 4663,
    attemptId, idempotencyKey,
    opportunityId: simulation.opportunity.opportunityId,
    collectionName: simulation.opportunity.collectionName,
    collection: simulation.opportunity.collectionContract,
    expectedTokenId: simulation.evidence.expectedTokenId, quantity: "1", mintPriceWei: "0",
    maxGasCostWei: String(intent.maxGasPerMintWei), createdAt: created, expiresAt,
    pinnedBlock: simulation.evidence.pinnedBlock,
    estimatedGasCostWei: simulation.evidence.estimatedGasWei,
    transaction: simulation.transaction,
    safety: Object.freeze({ ownerApprovalRequired: true, serverSigner: false,
      exactPunkWalletEntryPoint: true, fixedSeaDrop: V2_SEADROP,
      fixedFeeRecipient: V2_OPEN_SEA_FEE_RECIPIENT, quantityOne: true,
      zeroMintPrice: true, nftReceiver: simulation.transaction.to,
      freshBrowserSimulationRequired: true, submissionPerformed: false }) });
}
