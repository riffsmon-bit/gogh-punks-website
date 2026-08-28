let accessToken = null;
let intentId = null;
const result = document.querySelector("[data-result]");
const latency = document.querySelector("[data-latency]");
const tokenId = () => document.querySelector("[data-token-id]").value;
const url = () => document.querySelector("[data-url]").value;

async function post(path, body, headers = {}) {
  const response = await fetch(path, { method: "POST", headers: {
    accept: "application/json", "content-type": "application/json", ...headers },
  body: JSON.stringify(body), cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${payload.code}: ${payload.message}`);
  return payload;
}
document.querySelector("[data-authorize]").addEventListener("click", async () => {
  const session = await post("/api/local-connector/authorize", {});
  accessToken = session.accessToken;
  document.querySelector("[data-auth-state]").textContent =
    `Scoped local session ready until ${new Date(session.expiresAt).toLocaleTimeString()}`;
});

for (const button of document.querySelectorAll("[data-tool]")) {
  button.addEventListener("click", async () => {
    const tool = button.dataset.tool;
    const argumentsByTool = {
      list_my_punks: {}, get_punk_status: { tokenId: tokenId() },
      send_agent_scouting: { tokenId: tokenId() },
      inspect_opensea_mint: { tokenId: tokenId(), url: url() },
      prepare_directed_mint: { tokenId: tokenId(), url: url(), quantity: 1 },
      execute_directed_mint: { intentId },
    };
    const started = performance.now();
    try {
      const payload = await post("/api/local-connector/tools", {
        tool, arguments: argumentsByTool[tool], idempotencyKey: `console:${tool}:${crypto.randomUUID()}`,
      }, { authorization: `Bearer ${accessToken ?? ""}` });
      intentId = payload.result?.intentId ?? intentId;
      result.textContent = JSON.stringify(payload, null, 2);
    } catch (error) { result.textContent = error.message; }
    latency.textContent = `${Math.round(performance.now() - started)}ms`;
  });
}
