const PREVIEW_CONTEXTS = new Set(["deploy-preview", "branch-deploy"]);

function allowedTasks(environment) {
  const configured = environment.BACKGROUND_RPC_ALLOWED_TASKS;
  if (configured === undefined) return null;
  return new Set(configured.split(",").map((value) => value.trim()).filter(Boolean));
}

export function backgroundRpcDecision(environment = process.env, task = "BACKGROUND_TASK") {
  const context = typeof environment.CONTEXT === "string" ? environment.CONTEXT : "";
  if (environment.PAUSE_BACKGROUND_RPC === "true") {
    return Object.freeze({ enabled: false, reason: "EMERGENCY_PAUSE", task, context });
  }
  if (PREVIEW_CONTEXTS.has(context)
    && environment.ENABLE_PREVIEW_BACKGROUND_RPC !== "true") {
    return Object.freeze({ enabled: false, reason: "PREVIEW_DISABLED", task, context });
  }
  const allowlist = allowedTasks(environment);
  if (allowlist !== null && !allowlist.has(task)) {
    return Object.freeze({ enabled: false, reason: "TASK_NOT_ALLOWED", task, context });
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
