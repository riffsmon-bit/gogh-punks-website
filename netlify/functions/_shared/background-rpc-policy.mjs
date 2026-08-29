const PREVIEW_CONTEXTS = new Set(["deploy-preview", "branch-deploy"]);

export function backgroundRpcDecision(environment = process.env, task = "BACKGROUND_TASK") {
  const context = typeof environment.CONTEXT === "string" ? environment.CONTEXT : "";
  if (environment.PAUSE_BACKGROUND_RPC === "true") {
    return Object.freeze({ enabled: false, reason: "EMERGENCY_PAUSE", task, context });
  }
  if (PREVIEW_CONTEXTS.has(context)
    && environment.ENABLE_PREVIEW_BACKGROUND_RPC !== "true") {
    return Object.freeze({ enabled: false, reason: "PREVIEW_DISABLED", task, context });
  }
  return Object.freeze({ enabled: true, reason: null, task, context });
}

export function logBackgroundRpcSkip(decision, report = console.log) {
  if (!decision || decision.enabled !== false || typeof report !== "function") {
    throw new TypeError("invalid background RPC decision");
  }
  report(JSON.stringify({
    event: "BACKGROUND_RPC_SKIPPED",
    task: decision.task,
    reason: decision.reason,
    context: decision.context || null,
  }));
}
