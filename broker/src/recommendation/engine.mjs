import { scoreOpportunity } from "../analysis/scoring.mjs";

function decision(scores, riskLabel) {
  if (riskLabel === "UNKNOWN" || scores.contractRiskScore >= 70) return "RESEARCH";
  if (scores.opportunityScore >= 76 && scores.tasteMatch >= 75) return "COLLECT";
  if (scores.opportunityScore >= 60) return "RECOMMEND";
  if (scores.opportunityScore >= 42) return "WATCH";
  return "IGNORE";
}

export function recommendOpportunity(input) {
  const scores = scoreOpportunity(input);
  const recommendation = decision(scores, input.riskLabel ?? "UNKNOWN");
  const reasons = [];
  if (scores.tasteMatch >= 80) reasons.push("strong match for this Punk’s Taste Profile");
  if (scores.artScore >= 80) reasons.push("high artistic assessment");
  if (scores.creatorScore >= 70) reasons.push("positive but non-definitive creator history");
  if (scores.liquidityScore < 35) reasons.push("secondary liquidity is currently thin");
  if (scores.contractRiskScore >= 50) reasons.push("contract controls require additional review");
  if ((input.riskLabel ?? "UNKNOWN") === "UNKNOWN") reasons.push("contract risk remains unknown");
  return Object.freeze({
    scores,
    recommendation,
    explanation: reasons.length
      ? `${reasons.join("; ")}.`
      : "No strong positive or negative signal dominates the current evidence.",
    disclaimer: "This is a curatorial recommendation, not a promise of profit or contract safety.",
  });
}
