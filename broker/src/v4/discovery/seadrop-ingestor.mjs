import { createHash } from "node:crypto";

import { normalizeV2Opportunity } from "../opportunity.mjs";

export const V2_SEADROP = "0x00005ea00ac477b1030ce78506496e8c2de24bf5";
export const V2_SEADROP_ADAPTER = "0xd4316dfbcfa3f51f1a9de77aaa5d9e6edf848777";
export const V2_ADAPTER_REGISTRY = "0x421d51709fe21736a35ffa2a86b157df1b030ee2";
export const V2_OPEN_SEA_FEE_RECIPIENT = "0x0000a26b00c1f0df003000390027140000faa719";
export const V2_SEADROP_CODE_HASH =
  "0x53e4b9339cf624803c9a7d0195576cca5b917920813508d86b3eb93dcbabeb5c";
export const V2_SEADROP_ADAPTER_CODE_HASH =
  "0x8e99aa5602225a4aadcccc2ee4e0e5c42477ed40b5d927ee964e81d204b8b56b";
export const V2_REVIEWED_COLLECTION_CODE_HASHES = Object.freeze([
  "0xe3e252831cdd0c11e1327d04a57ddd9bfa11ef49d50edb524040d98bfb228bc4",
  "0x69e7a7158f30acb817dc83a4e21af19a216c3a2ae57db423599ca82f321e3041",
]);
const REVIEWED_COLLECTION_CODE_HASHES = new Set(V2_REVIEWED_COLLECTION_CODE_HASHES);

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;

function address(value, label) {
  const output = String(value ?? "").toLowerCase();
  if (!ADDRESS.test(output)) throw new TypeError(`${label} is invalid`);
  return output;
}

function hash(value, label) {
  const output = String(value ?? "").toLowerCase();
  if (!HASH.test(output)) throw new TypeError(`${label} is invalid`);
  return output;
}

function uint(value, label) {
  const output = String(value ?? "");
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(output)) throw new TypeError(`${label} is invalid`);
  return output;
}

function timestampFromSeconds(value) {
  const seconds = BigInt(value);
  if (seconds === 0n || seconds > 253_402_300_799n) return null;
  return new Date(Number(seconds) * 1_000).toISOString();
}

function screeningInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("SeaDrop observation is invalid");
  }
  const drop = value.drop;
  const contracts = value.contracts;
  if (!drop || typeof drop !== "object" || Array.isArray(drop)
    || !contracts || typeof contracts !== "object" || Array.isArray(contracts)) {
    throw new TypeError("SeaDrop observation is invalid");
  }
  const normalized = {
    collection: address(value.collection, "collection"),
    updateBlockNumber: uint(value.updateBlockNumber, "update block"),
    updateBlockHash: hash(value.updateBlockHash, "update block hash"),
    updateTransactionHash: hash(value.updateTransactionHash, "update transaction hash"),
    pinnedBlockNumber: uint(value.pinnedBlockNumber, "pinned block"),
    pinnedBlockHash: hash(value.pinnedBlockHash, "pinned block hash"),
    checkedAt: new Date(value.checkedAt).toISOString(),
    collectionName: String(value.collectionName ?? "Unknown SeaDrop collection").trim().slice(0, 160),
    maxSupply: value.maxSupply === null ? null : Number(value.maxSupply),
    totalSupply: value.totalSupply === null ? null : Number(value.totalSupply),
    drop: {
      priceWei: uint(drop.priceWei, "mint price"),
      startTime: uint(drop.startTime, "start time"),
      endTime: uint(drop.endTime, "end time"),
      walletLimit: Number(drop.walletLimit),
      restrictFeeRecipients: drop.restrictFeeRecipients === true,
    },
    contracts: {
      seaDropCodeHash: hash(contracts.seaDropCodeHash, "SeaDrop code hash"),
      adapterCodeHash: hash(contracts.adapterCodeHash, "adapter code hash"),
      collectionCodeHash: hash(contracts.collectionCodeHash, "collection code hash"),
    },
    adapterRegistered: value.adapterRegistered === true,
    feeRecipientAllowed: value.feeRecipientAllowed === true,
  };
  if (!normalized.collectionName || !Number.isInteger(normalized.drop.walletLimit)
    || normalized.drop.walletLimit < 0 || normalized.drop.walletLimit > 65_535
    || normalized.maxSupply !== null && (!Number.isSafeInteger(normalized.maxSupply)
      || normalized.maxSupply < 0)
    || normalized.totalSupply !== null && (!Number.isSafeInteger(normalized.totalSupply)
      || normalized.totalSupply < 0)
    || !Number.isFinite(Date.parse(normalized.checkedAt))) {
    throw new TypeError("SeaDrop observation is invalid");
  }
  return Object.freeze(normalized);
}

export function screenSeaDropDiscoveryObservation(value, now = new Date()) {
  const observation = screeningInput(value);
  const nowSeconds = BigInt(Math.floor(new Date(now).getTime() / 1_000));
  const reasons = [];
  const blockingReasons = new Set();
  const block = (reason) => { reasons.push(reason); blockingReasons.add(reason); };
  if (observation.contracts.seaDropCodeHash !== V2_SEADROP_CODE_HASH) {
    block("SEADROP_CODE_CHANGED");
  }
  if (observation.contracts.adapterCodeHash !== V2_SEADROP_ADAPTER_CODE_HASH) {
    block("ADAPTER_CODE_CHANGED");
  }
  if (!REVIEWED_COLLECTION_CODE_HASHES.has(observation.contracts.collectionCodeHash)) {
    block("UNREVIEWED_COLLECTION_RUNTIME");
  }
  if (observation.drop.priceWei !== "0") block("PAID_MINT_UNSUPPORTED");
  if (BigInt(observation.drop.startTime) > nowSeconds) reasons.push("MINT_NOT_STARTED");
  if (BigInt(observation.drop.endTime) <= nowSeconds) block("MINT_ENDED");
  if (observation.drop.walletLimit < 1) block("WALLET_LIMIT_DISABLED");
  if (observation.drop.restrictFeeRecipients && !observation.feeRecipientAllowed) {
    block("FEE_RECIPIENT_NOT_ALLOWED");
  }
  if (observation.maxSupply === null || observation.totalSupply === null) {
    reasons.push("SUPPLY_STATE_UNKNOWN");
  } else if (observation.totalSupply >= observation.maxSupply) block("COLLECTION_SOLD_OUT");
  if (!observation.adapterRegistered) reasons.push("ADAPTER_NOT_REGISTERED");
  const status = blockingReasons.size ? "BLOCKED" : reasons.length ? "NEEDS_REVIEW" : "PASSED";
  const inputHash = createHash("sha256").update(JSON.stringify(observation)).digest("hex");
  return Object.freeze({ status, reasons: Object.freeze(reasons), inputHash, observation,
    contractIdentified: true, eligibleWithoutSimulation: false,
    disclaimer: "Discovery screening reduces known risks but does not guarantee safety." });
}

export function seaDropObservationToOpportunity(value, now = new Date()) {
  const screen = screenSeaDropDiscoveryObservation(value, now);
  const { observation } = screen;
  const createdAt = observation.checkedAt;
  const startTime = timestampFromSeconds(observation.drop.startTime);
  const candidateEndTime = timestampFromSeconds(observation.drop.endTime);
  const endTime = candidateEndTime && (!startTime || Date.parse(candidateEndTime) > Date.parse(startTime))
    ? candidateEndTime : null;
  return Object.freeze({ screen, opportunity: normalizeV2Opportunity({
    schema: "GOGH_NORMALIZED_OPPORTUNITY_V2", version: 2,
    opportunityId: `seadrop:${observation.collection}:public`, chainId: 4663,
    collectionContract: observation.collection, mintContract: V2_SEADROP,
    adapter: V2_SEADROP_ADAPTER, mintStage: "PUBLIC",
    mintMethod: "mintPublic(address,address,address,uint256)",
    priceWei: observation.drop.priceWei,
    estimatedGasCostWei: "0",
    supply: observation.maxSupply, walletLimit: observation.drop.walletLimit || null,
    startTime, endTime,
    website: null, socialUrls: { x: null, discord: null, farcaster: null },
    sourceUrls: [`https://robinhoodchain.blockscout.com/address/${observation.collection}`],
    artStyles: [], imageReference: null, collectionName: observation.collectionName,
    contractCodeHash: observation.contracts.collectionCodeHash,
    adapterCodeHash: observation.contracts.adapterCodeHash,
    screeningStatus: screen.status, simulationStatus: "UNAVAILABLE",
    riskLevel: screen.status === "BLOCKED" ? "HIGH" : screen.status === "PASSED" ? "LOW" : "UNKNOWN",
    riskScore: screen.status === "BLOCKED" ? 100 : screen.status === "PASSED" ? 10 : 50,
    expectedNftReceiver: null, unexpectedApprovals: false, unexpectedTransfers: false,
    createdAt, updatedAt: new Date(now).toISOString(),
  }, now) });
}

export async function ingestSeaDropObservations({ observations, repository, pool,
  now = new Date() }) {
  if (!Array.isArray(observations) || observations.length > 100 || !repository
    || typeof repository.ingest !== "function" || !pool || typeof pool.query !== "function") {
    throw new TypeError("SeaDrop ingestion request is invalid");
  }
  const results = [];
  for (const raw of observations) {
    const { opportunity, screen } = seaDropObservationToOpportunity(raw, now);
    const saved = await repository.ingest(opportunity, {
      kind: "ROBINHOOD_SEADROP_EVENT",
      identity: screen.observation.updateTransactionHash,
      url: `https://robinhoodchain.blockscout.com/tx/${screen.observation.updateTransactionHash}`,
      discoveredAt: screen.observation.checkedAt,
      evidence: {
        updateBlockNumber: screen.observation.updateBlockNumber,
        updateBlockHash: screen.observation.updateBlockHash,
        contractIdentified: true,
        externalCalldataAccepted: false,
      },
    });
    await pool.query(`INSERT INTO broker_v2_security_screenings
      (opportunity_id, input_hash, status, reasons, contract_code_hash,
       adapter_code_hash, checked_at, evidence)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb)
      ON CONFLICT (opportunity_id, input_hash) DO NOTHING`, [saved.opportunityId,
      screen.inputHash, screen.status, JSON.stringify(screen.reasons),
      opportunity.contractCodeHash, opportunity.adapterCodeHash, opportunity.updatedAt,
      JSON.stringify({ pinnedBlockNumber: screen.observation.pinnedBlockNumber,
        pinnedBlockHash: screen.observation.pinnedBlockHash,
        seaDropCodeHash: screen.observation.contracts.seaDropCodeHash,
        adapterRegistered: screen.observation.adapterRegistered,
        feeRecipientAllowed: screen.observation.feeRecipientAllowed })]);
    results.push(Object.freeze({ opportunityId: saved.opportunityId,
      collectionContract: opportunity.collectionContract, screeningStatus: screen.status,
      simulationStatus: "UNAVAILABLE", eligible: false, reasons: screen.reasons }));
  }
  return Object.freeze(results);
}
