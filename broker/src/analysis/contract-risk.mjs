const SEVERITY = Object.freeze({ info: 0, low: 6, medium: 14, high: 28, critical: 45 });
const MINIMUM_LABEL_CONFIDENCE = 65;
const EVIDENCE_SIGNALS = Object.freeze([
  "sourceVerified",
  "erc721",
  "erc1155",
  "proxyDetected",
  "unverifiedImplementation",
  "delegatecallDetected",
  "unusualExternalCalls",
  "callbackSurface",
  "selfdestructDetected",
  "ownerCanMint",
  "ownerCanPause",
  "mutableMetadata",
  "transferRestrictions",
  "blacklistFunctionality",
  "unboundedOperatorApproval",
  "suspiciousBehavior",
  "royaltyMutable",
  "mintFunctionExposed",
  "pauseFunctionExposed",
  "metadataSetterExposed",
  "transferControlFunctionExposed",
  "blacklistFunctionExposed",
  "royaltySetterExposed",
  "upgradeFunctionExposed",
  "standardConflict",
]);

function resolved(value) {
  if (value === undefined || value === null) return false;
  if (typeof value !== "string") return true;
  return !new Set(["UNKNOWN", "UNVERIFIED", "UNAVAILABLE"]).has(value.toUpperCase());
}

export function analyzeContractRisk(evidence = {}) {
  if (!evidence.bytecodePresent) {
    return Object.freeze({
      score: 100,
      label: "UNKNOWN",
      relativeBand: "HIGHER_RISK",
      confidence: 0,
      evidenceCoverage: 0,
      findings: Object.freeze([
        Object.freeze({ code: "NO_BYTECODE_EVIDENCE", severity: "critical" }),
      ]),
      disclaimer: "No contract safety claim can be made without verified bytecode evidence.",
    });
  }

  const findings = [];
  const add = (condition, code, severity) => {
    if (condition === true) findings.push(Object.freeze({ code, severity }));
  };
  add(evidence.proxyDetected, "UPGRADEABLE_PROXY", "medium");
  add(evidence.unverifiedImplementation, "UNVERIFIED_IMPLEMENTATION", "high");
  add(evidence.ownerCanMint, "PRIVILEGED_MINT", "medium");
  add(evidence.ownerCanPause, "PRIVILEGED_PAUSE", "low");
  add(evidence.mutableMetadata, "MUTABLE_METADATA", "medium");
  add(evidence.transferRestrictions, "TRANSFER_RESTRICTIONS", "high");
  add(evidence.blacklistFunctionality, "BLACKLIST_FUNCTIONALITY", "high");
  add(evidence.unboundedOperatorApproval, "UNBOUNDED_OPERATOR_APPROVAL", "critical");
  add(evidence.delegatecallDetected, "DELEGATECALL_DETECTED", "high");
  add(evidence.unusualExternalCalls, "UNUSUAL_EXTERNAL_CALLS", "medium");
  add(evidence.callbackSurface, "CALLBACK_SURFACE", "low");
  add(evidence.selfdestructDetected, "SELFDESTRUCT_DETECTED", "high");
  add(evidence.suspiciousBehavior, "SUSPICIOUS_TRANSACTION_BEHAVIOR", "critical");
  add(evidence.royaltyMutable, "MUTABLE_ROYALTY", "low");
  add(evidence.mintFunctionExposed, "MINT_FUNCTION_EXPOSED", "low");
  add(evidence.pauseFunctionExposed, "PAUSE_FUNCTION_EXPOSED", "low");
  add(evidence.metadataSetterExposed, "METADATA_SETTER_EXPOSED", "medium");
  add(evidence.transferControlFunctionExposed, "TRANSFER_CONTROL_EXPOSED", "high");
  add(evidence.blacklistFunctionExposed, "BLACKLIST_FUNCTION_EXPOSED", "high");
  add(evidence.royaltySetterExposed, "ROYALTY_SETTER_EXPOSED", "low");
  add(evidence.upgradeFunctionExposed, "UPGRADE_FUNCTION_EXPOSED", "high");
  add(evidence.standardConflict, "NFT_STANDARD_CONFLICT", "high");
  add(!evidence.sourceVerified, "SOURCE_NOT_VERIFIED", "medium");
  const observedNftStandard = evidence.observedStandard === "ERC721"
    || evidence.observedStandard === "ERC1155";
  add(
    !observedNftStandard && !evidence.erc721 && !evidence.erc1155,
    "NFT_STANDARD_UNCONFIRMED",
    "high",
  );

  const raw = findings.reduce((total, finding) => total + SEVERITY[finding.severity], 0);
  const score = Math.min(100, raw);
  const relativeBand = score >= 60
    ? "HIGHER_RISK"
    : score >= 25
      ? "MEDIUM_RISK"
      : "LOWER_RISK";
  const checkedSignals = EVIDENCE_SIGNALS.filter((field) => resolved(evidence[field])).length;
  const confidence = Math.round((checkedSignals / EVIDENCE_SIGNALS.length) * 100);
  const label = confidence >= MINIMUM_LABEL_CONFIDENCE ? relativeBand : "UNKNOWN";
  if (label === "UNKNOWN") {
    findings.push(Object.freeze({ code: "INSUFFICIENT_EVIDENCE", severity: "info" }));
  }
  return Object.freeze({
    score,
    label,
    relativeBand,
    confidence,
    evidenceCoverage: confidence,
    checkedSignals,
    totalSignals: EVIDENCE_SIGNALS.length,
    findings: Object.freeze(findings),
    disclaimer: label === "UNKNOWN"
      ? "Evidence coverage is insufficient for a relative risk label; no safety claim is made."
      : `${label.replace("_", " ")} is a relative assessment, not a safety guarantee.`,
  });
}
