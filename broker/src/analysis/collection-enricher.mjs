import { ROBINHOOD, normalizeAddress } from "../config.mjs";
import { summarizeCollectionActivity } from "./collection-activity.mjs";
import { analyzeContractRisk } from "./contract-risk.mjs";

const STANDARDS = new Set(["ERC721", "ERC1155", "UNKNOWN"]);

function detectedStandard(evidence) {
  if (evidence.erc721 === true && evidence.erc1155 !== true) return "ERC721";
  if (evidence.erc1155 === true && evidence.erc721 !== true) return "ERC1155";
  return "UNKNOWN";
}

function safeObservedAt(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError("inspector returned invalid observedAt");
  return parsed.toISOString();
}

function canonicalBlockDate(value) {
  let seconds;
  try {
    seconds = BigInt(value);
  } catch {
    throw new TypeError("inspector returned invalid observedBlockTimestamp");
  }
  if (seconds < 0n || seconds > 8_640_000_000_000n) {
    throw new TypeError("inspector returned invalid observedBlockTimestamp");
  }
  const date = new Date(Number(seconds) * 1_000);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("inspector returned invalid observedBlockTimestamp");
  }
  return date.toISOString();
}

export class CollectionEnricher {
  constructor({ contractInspector, abiInspector = null, nftEvidenceInspector = null }) {
    if (!contractInspector || typeof contractInspector.inspect !== "function") {
      throw new TypeError("contractInspector is required");
    }
    if (abiInspector && typeof abiInspector.inspect !== "function") {
      throw new TypeError("abiInspector must expose inspect");
    }
    if (nftEvidenceInspector && typeof nftEvidenceInspector.inspect !== "function") {
      throw new TypeError("nftEvidenceInspector must expose inspect");
    }
    this.contractInspector = contractInspector;
    this.abiInspector = abiInspector;
    this.nftEvidenceInspector = nftEvidenceInspector;
  }

  async enrich(collection, {
    activityRows = [],
    activityTruncated = false,
    tokenIds = [],
  } = {}) {
    if (Number(collection?.chainId) !== ROBINHOOD.chainId) {
      throw new TypeError(`collection chainId must be ${ROBINHOOD.chainId}`);
    }
    const address = normalizeAddress(collection.address, "collection.address");
    const observedStandard = collection.standard ?? "UNKNOWN";
    if (!STANDARDS.has(observedStandard)) throw new TypeError("unsupported collection standard");

    const rpcEvidence = await this.contractInspector.inspect(address);
    let explorerEvidence = Object.freeze({
      sourceVerified: false,
      explorerEvidence: "UNAVAILABLE",
    });
    if (this.abiInspector) {
      try {
        explorerEvidence = await this.abiInspector.inspect(address);
      } catch (error) {
        explorerEvidence = Object.freeze({
          sourceVerified: false,
          explorerEvidence: "UNAVAILABLE",
          failureType: error?.name ?? "Error",
        });
      }
    }

    const interfaceStandard = detectedStandard(rpcEvidence);
    const standardConflict = observedStandard !== "UNKNOWN"
      && interfaceStandard !== "UNKNOWN"
      && observedStandard !== interfaceStandard;
    const riskEvidence = Object.freeze({
      ...rpcEvidence,
      ...explorerEvidence,
      sourceVerified: explorerEvidence.sourceVerified === true,
      observedStandard,
      interfaceStandard,
      standardConflict,
    });
    const risk = analyzeContractRisk(riskEvidence);
    const analyzedAt = safeObservedAt(rpcEvidence.observedAt);
    const analysisBlockTime = canonicalBlockDate(rpcEvidence.observedBlockTimestamp);
    const resolvedStandard = standardConflict
      ? observedStandard
      : interfaceStandard === "UNKNOWN" ? observedStandard : interfaceStandard;

    let nftEvidence = Object.freeze({
      status: "UNAVAILABLE",
      failureType: null,
      ownerSample: Object.freeze({ status: "UNAVAILABLE", requested: tokenIds.length, resolved: 0 }),
      metadata: Object.freeze({ status: "UNAVAILABLE", art: Object.freeze({ status: "UNAVAILABLE" }) }),
      executionEligible: false,
    });
    if (this.nftEvidenceInspector) {
      try {
        nftEvidence = await this.nftEvidenceInspector.inspect(address, {
          standard: resolvedStandard,
          tokenIds,
          blockNumber: rpcEvidence.observedBlock,
          expectedBlockHash: rpcEvidence.observedBlockHash,
          expectedBlockTimestamp: rpcEvidence.observedBlockTimestamp,
        });
      } catch (error) {
        nftEvidence = Object.freeze({
          status: "UNAVAILABLE",
          failureType: error?.name ?? "Error",
          ownerSample: Object.freeze({ status: "UNAVAILABLE", requested: tokenIds.length, resolved: 0 }),
          metadata: Object.freeze({ status: "UNAVAILABLE", art: Object.freeze({ status: "UNAVAILABLE" }) }),
          executionEligible: false,
        });
      }
    }
    const activity = summarizeCollectionActivity(activityRows, {
      now: analysisBlockTime,
      ownerSample: nftEvidence.ownerSample,
      truncated: activityTruncated,
    });
    const art = nftEvidence.metadata?.art ?? Object.freeze({ status: "UNAVAILABLE" });

    return Object.freeze({
      analyzerVersion: "collection-evidence-v2",
      chainId: ROBINHOOD.chainId,
      address,
      standard: resolvedStandard,
      sourceVerified: explorerEvidence.sourceVerified === true,
      proxyStatus: !rpcEvidence.bytecodePresent
        ? "UNKNOWN"
        : rpcEvidence.proxyDetected ? "PROXY" : "DIRECT",
      riskLabel: risk.label,
      riskScore: risk.score,
      riskConfidence: risk.confidence,
      analyzedAt,
      observedBlock: rpcEvidence.observedBlock,
      observedBlockHash: rpcEvidence.observedBlockHash,
      observedBlockTimestamp: rpcEvidence.observedBlockTimestamp,
      sourceMinBlock: activity.sourceMinBlock,
      sourceMaxBlock: activity.sourceMaxBlock,
      identity: nftEvidence.identity ?? Object.freeze({ status: "UNAVAILABLE" }),
      art,
      market: activity,
      evidence: Object.freeze({
        rpc: rpcEvidence,
        explorer: explorerEvidence,
        nft: nftEvidence,
        activity,
        observedStandard,
        interfaceStandard,
        standardConflict,
        risk,
      }),
      opportunityPatch: Object.freeze({
        contractRiskScore: risk.score,
        contractRiskConfidence: risk.confidence,
        artScore: art.artScore ?? null,
        artConfidence: art.confidence ?? 0,
        artStatus: art.status ?? "UNAVAILABLE",
        marketScore: activity.marketScore,
        marketConfidence: activity.marketConfidence,
        marketStatus: activity.status,
        liquidityScore: null,
        liquidityStatus: activity.liquidityStatus,
        riskLabel: risk.label,
        recommendation: "RESEARCH",
        autonomousExecutionEligible: false,
      }),
    });
  }
}
