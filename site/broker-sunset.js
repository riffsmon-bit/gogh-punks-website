const CANONICAL_SHUTDOWN_AT = "2026-09-04T22:00:00Z";
const CANONICAL_SHUTDOWN_MS = Date.parse(CANONICAL_SHUTDOWN_AT);

const root = document.querySelector("[data-v1-sunset]");
let reference = null;

function text(selector, value) {
  const element = root?.querySelector(selector);
  if (element) element.textContent = value;
}

function showRetired(retired) {
  const pending = root?.querySelector("[data-v1-sunset-pending]");
  const complete = root?.querySelector("[data-v1-sunset-retired]");
  if (pending) pending.hidden = retired;
  if (complete) complete.hidden = !retired;
  document.documentElement.dataset.v1Lifecycle = retired ? "retired" : "sunset-pending";
}

function render() {
  if (!root || !reference) return;
  const nowMs = reference.serverMs + (performance.now() - reference.monotonicMs);
  const remaining = Math.max(0, CANONICAL_SHUTDOWN_MS - nowMs);
  const totalSeconds = Math.floor(remaining / 1_000);
  text("[data-v1-days]", String(Math.floor(totalSeconds / 86_400)).padStart(2, "0"));
  text("[data-v1-hours]", String(Math.floor(totalSeconds / 3_600) % 24).padStart(2, "0"));
  text("[data-v1-minutes]", String(Math.floor(totalSeconds / 60) % 60).padStart(2, "0"));
  text("[data-v1-seconds]", String(totalSeconds % 60).padStart(2, "0"));
  showRetired(reference.cutoffReached || remaining === 0);
}

async function synchronize() {
  if (!root) return;
  try {
    const response = await fetch("/api/broker/v1-lifecycle", {
      headers: { accept: "application/json" }, cache: "no-store",
    });
    const payload = await response.json();
    const lifecycle = payload?.lifecycle;
    const serverMs = Date.parse(lifecycle?.serverNow);
    if (!response.ok || payload?.ok !== true || lifecycle?.shutdownAt !== CANONICAL_SHUTDOWN_AT
      || !Number.isFinite(serverMs)) throw new Error("invalid lifecycle response");
    reference = Object.freeze({
      serverMs,
      monotonicMs: performance.now(),
      cutoffReached: lifecycle.cutoffReached === true,
    });
    text("[data-v1-reference]",
      `Server-synchronized cutoff · ${lifecycle.displayTime} · ${CANONICAL_SHUTDOWN_AT}`);
    render();
  } catch {
    text("[data-v1-reference]",
      "Server time is temporarily unavailable. Backend retirement safeguards remain authoritative.");
  }
}

if (root) {
  synchronize();
  window.setInterval(render, 250);
  window.setInterval(synchronize, 30_000);
}
