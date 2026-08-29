import { metadataConfiguration, PostgresMetadataRepository } from "./broker/metadata-repository.mjs";
import { createOpenSeaSource, refreshOpenSeaMetadata } from "../../broker/src/metadata/worker.mjs";
import {
  backgroundRpcDecision, logBackgroundRpcSkip,
} from "./_shared/background-rpc-policy.mjs";

export default async function handler() {
  const decision = backgroundRpcDecision(process.env, "BROKER_METADATA");
  if (!decision.enabled) {
    logBackgroundRpcSkip(decision);
    return;
  }
  const configuration = metadataConfiguration(process.env);
  if (!configuration.enabled) {
    console.log(JSON.stringify({ event: "BROKER_METADATA_SKIPPED", reason: "DISABLED" }));
    return;
  }
  if (!process.env.OPENSEA_API_KEY?.trim()) {
    console.log(JSON.stringify({ event: "BROKER_METADATA_SKIPPED", reason: "NOT_CONFIGURED" }));
    return;
  }
  try {
    const result = await refreshOpenSeaMetadata({
      repository: new PostgresMetadataRepository(),
      source: createOpenSeaSource(process.env, configuration),
      configuration,
    });
    console.log(JSON.stringify({ event: "BROKER_METADATA_REFRESH", ...result }));
  } catch (error) {
    console.error(JSON.stringify({
      event: "BROKER_METADATA_ERROR",
      type: error?.name ?? "Error",
      message: String(error?.message ?? "Metadata refresh failed").slice(0, 200),
    }));
    throw error;
  }
}

// Offset from the five-minute analysis/scout workers. This enrichment worker is
// feature-flagged off by default and makes at most the configured bounded batch.
export const config = { schedule: "3-59/10 * * * *" };
