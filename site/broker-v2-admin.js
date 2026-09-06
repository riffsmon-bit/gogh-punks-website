const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const localPreview = location.protocol === "http:" && LOCAL_HOSTS.has(location.hostname);
let bearer = "";

const one = (selector) => document.querySelector(selector);
const text = (selector, value) => { const element = one(selector); if (element) element.textContent = String(value ?? "—"); };
const integer = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "—";

function providerRows(data) {
  const health = data.aiProviderHealth ?? {};
  const usage = Array.isArray(data.providerUsage) ? data.providerUsage : [];
  const names = [...new Set(["OPENAI", "ANTHROPIC", "XAI", "BANKR", ...Object.keys(health),
    ...usage.map((row) => String(row.provider ?? "").toUpperCase())])].filter(Boolean);
  one("[data-provider-list]").replaceChildren(...names.map((name) => {
    const row = document.createElement("div"); row.className = "provider-row";
    const calls = usage.find((item) => String(item.provider).toUpperCase() === name)?.calls ?? 0;
    const title = document.createElement("b"); title.textContent = name;
    const state = document.createElement("span"); state.textContent = health[name] ?? (Number(calls) ? "OBSERVED" : "NO CALLS");
    const detail = document.createElement("small"); detail.textContent = `${integer(calls)} calls in the current aggregate window`;
    row.append(title, state, detail); return row;
  }));
}

function serviceRows(data) {
  const services = data.services ?? { DISCOVERY: "DATABASE", SCREENING: "DATABASE",
    SIMULATION: "DATABASE", RPC: "ON_DEMAND", EXECUTOR: data.executor?.productionSubmissionEnabled ? "READY" : "DISABLED" };
  one("[data-service-health]").replaceChildren(...Object.entries(services).map(([name, state]) => {
    const row = document.createElement("div"); const term = document.createElement("dt");
    const value = document.createElement("dd"); term.textContent = name; value.textContent = state;
    value.dataset.health = String(state).toLowerCase(); row.append(term, value); return row;
  }));
}

function render(payload) {
  const data = payload.admin ?? payload;
  const opportunities = data.opportunities ?? {};
  const strategies = data.strategies ?? {};
  const execution = data.execution ?? {};
  text("[data-opportunities-discovered]", integer(opportunities.discovered ?? data.opportunitiesDiscovered));
  text("[data-opportunities-screened]", integer(opportunities.screened ?? data.opportunitiesScreened));
  text("[data-opportunities-blocked]", integer(opportunities.blocked ?? data.opportunitiesBlocked));
  text("[data-active-strategies]", integer(strategies.active ?? data.activeStrategies));
  text("[data-execution-attempts]", integer(execution.attempts ?? data.executionAttempts));
  text("[data-successful-mints]", integer(execution.successful ?? data.successfulMints));
  text("[data-provider-calls]", integer(data.providerUsage?.reduce?.((sum, row) => sum + Number(row.calls ?? 0), 0)
    ?? data.providerUsage));
  const cost = data.estimatedInfrastructureCostMicrousd
    ?? data.providerUsage?.reduce?.((sum, row) => sum + Number(row.estimated_cost_microusd ?? 0), 0) ?? 0;
  text("[data-estimated-cost]", `$${(Number(cost) / 1_000_000).toFixed(4)}`);
  text("[data-cache-utilization]", data.cacheUtilization === null || data.cacheUtilization === undefined
    ? "NO SAMPLE" : `${Math.round(Number(data.cacheUtilization) * 100)}%`);
  text("[data-failed-attempts]", `${integer(execution.failed ?? data.failedAttempts ?? 0)} / ${integer(execution.reconcile ?? 0)}`);
  text("[data-executor-state]", `EXECUTOR · ${data.executor?.productionSubmissionEnabled ? "READY" : "LOCKED"}`);
  text("[data-executor-blocker]", data.executor?.blocker
    ?? "The deployed Punk Wallet cannot originate and pay gas autonomously.");
  providerRows(data); serviceRows(data);
  text("[data-admin-state]", `Snapshot loaded · ${data.privacy ?? "AGGREGATED_ONLY"} · ${new Date().toLocaleTimeString()}`);
}

async function load() {
  text("[data-admin-state]", "Loading aggregated V2 operations…");
  const url = localPreview ? "/api/local-art-broker-v2/admin" : "/api/v2/admin";
  const headers = { accept: "application/json" };
  if (!localPreview) {
    if (!bearer) throw new Error("Enter the private admin bearer. It is kept in memory only.");
    headers.authorization = `Bearer ${bearer}`;
  }
  const response = await fetch(url, { headers, credentials: "same-origin", cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || payload.ok !== true) throw new Error(payload.message ?? "Operations snapshot is unavailable.");
  render(payload);
}

one("[data-admin-auth]").addEventListener("submit", async (event) => {
  event.preventDefault(); bearer = String(new FormData(event.currentTarget).get("token") ?? "").trim();
  event.currentTarget.reset();
  try { await load(); } catch (error) { text("[data-admin-state]", error.message); }
});
one("[data-admin-refresh]").addEventListener("click", async () => {
  try { await load(); } catch (error) { text("[data-admin-state]", error.message); }
});

if (localPreview) {
  one("[data-admin-preview]").hidden = false;
  one("[data-admin-auth]").hidden = true;
  load().catch((error) => text("[data-admin-state]", error.message));
}
