import { ROBINHOOD } from "../config.mjs";
import {
  failedOpenSeaNft,
  OpenSeaMetadataSource,
} from "./opensea.mjs";

function errorCode(error) {
  if (typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)) {
    return error.code;
  }
  if (error?.name === "AbortError") return "OPENSEA_TIMEOUT";
  if (error instanceof RangeError) return "OPENSEA_RESPONSE_LIMIT";
  if (error instanceof TypeError) return "OPENSEA_INVALID_RESPONSE";
  return "OPENSEA_REQUEST_FAILED";
}

function refreshHoursFor(record, configuration) {
  if (record.status === "AVAILABLE") return configuration.availableRefreshHours;
  if (record.status === "NOT_FOUND") return configuration.notFoundRefreshHours;
  return configuration.errorRefreshHours;
}

export async function refreshOpenSeaMetadata({ repository, source, configuration }) {
  if (!configuration.enabled) throw new Error("BROKER_METADATA_ENABLED must be exactly true");
  const candidates = await repository.pendingCandidates(ROBINHOOD.chainId, {
    limit: configuration.batchSize,
  });
  const summary = { queued: candidates.length, available: 0, notFound: 0, failed: 0 };
  for (const candidate of candidates) {
    let record;
    let failureCode = null;
    try {
      record = await source.nft(candidate);
    } catch (error) {
      failureCode = errorCode(error);
      record = failedOpenSeaNft(candidate.collection, candidate.tokenId);
    }
    await repository.save(record, {
      refreshHours: refreshHoursFor(record, configuration),
      errorCode: failureCode,
    });
    if (record.status === "AVAILABLE") summary.available += 1;
    else if (record.status === "NOT_FOUND") summary.notFound += 1;
    else summary.failed += 1;
  }
  return Object.freeze({
    ok: summary.failed === 0,
    chainId: ROBINHOOD.chainId,
    provider: "OPENSEA_V2",
    readOnly: true,
    authoritative: false,
    executionEnabled: false,
    ...summary,
  });
}

export function createOpenSeaSource(environment, configuration) {
  return new OpenSeaMetadataSource({
    apiKey: environment.OPENSEA_API_KEY,
    timeoutMs: configuration.timeoutMs,
  });
}
