import { createHash } from "node:crypto";
import { V2_ART_STYLES } from "./collecting-intent.mjs";

export const ART_CLASSIFICATION_SCHEMA = Object.freeze({ type: "object",
  properties: Object.freeze({ artStyles: { type: "array", items: { type: "string", enum: V2_ART_STYLES } },
    summary: { type: "string" }, confidence: { type: "integer" } }),
  required: Object.freeze(["artStyles", "summary", "confidence"]), additionalProperties: false });

function bounded(value, maximum) {
  const output = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!output || output.length > maximum) throw new TypeError("collection evidence is invalid");
  return output;
}

export function collectionAnalysisInputHash(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.chainId !== 4663
    || !/^0x[0-9a-f]{40}$/.test(String(value.collectionContract ?? ""))
    || !/^0x[0-9a-f]{64}$/.test(String(value.contractCodeHash ?? ""))) {
    throw new TypeError("collection analysis identity is invalid");
  }
  const identity = ["GOGH_ART_CLASSIFICATION_V1", "4663", value.collectionContract,
    value.contractCodeHash, String(value.imageReference ?? ""), String(value.metadataHash ?? "")].join("|");
  return createHash("sha256").update(identity).digest("hex");
}

export async function classifyCollectionOnce({ repository, router, opportunityId, evidence,
  context = {} }) {
  if (!repository || typeof repository.analyzeOnce !== "function" || !router) {
    throw new TypeError("art classification dependencies are invalid");
  }
  const inputHash = collectionAnalysisInputHash(evidence);
  return repository.analyzeOnce({ opportunityId, inputHash, analyze: async () => {
    const result = await router.run("CLASSIFY_ART", {
      instructions: "Classify the visible art and collection description. Use only the supplied evidence. Return a concise factual summary. Classification never grants mint authority.",
      prompt: `Collection: ${bounded(evidence.collectionName, 160)}\nDescription: ${bounded(evidence.description, 4000)}\nImage reference: ${bounded(evidence.imageReference, 2048)}`,
      schema: ART_CLASSIFICATION_SCHEMA, maxOutputTokens: 600,
    }, context);
    const confidence = Number(result.value.confidence);
    if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100
      || !Array.isArray(result.value.artStyles) || result.value.artStyles.length > 12
      || result.value.artStyles.some((style) => !V2_ART_STYLES.includes(style))
      || typeof result.value.summary !== "string" || !result.value.summary.trim()
      || result.value.summary.length > 4_000) throw new TypeError("art classification is invalid");
    return Object.freeze({ artStyles: Object.freeze([...new Set(result.value.artStyles)].sort()),
      summary: result.value.summary.trim(), confidence,
      provider: result.provider, modelRegistryKey: result.registryKey });
  } });
}
