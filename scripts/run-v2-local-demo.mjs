import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { localWalletConfiguration, localWalletReferer } from
  "./lib/v2-local-wallet-config.mjs";
import { fetchLocalBrokerRead, LOCAL_BROKER_READ_PATHS } from
  "./lib/v2-local-read-proxy.mjs";
import { V2LocalSimulation } from "./lib/v2-local-simulation.mjs";

const root = resolve(process.cwd(), "site");
const portValue = process.env.GOGH_V2_DEMO_PORT ?? "8888";
if (!/^[1-9][0-9]{0,4}$/.test(portValue) || Number(portValue) > 65_535) {
  throw new TypeError("GOGH_V2_DEMO_PORT must be a valid local port");
}
const port = Number(portValue);
const simulation = new V2LocalSimulation();
const MAX_JSON_BYTES = 16_384;
const types = Object.freeze({ ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" });

function json(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const type = request.headers["content-type"]?.split(";", 1)[0]?.trim();
  if (type !== "application/json") throw new TypeError("application/json is required");
  const declared = request.headers["content-length"];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_JSON_BYTES)) {
    throw new TypeError("request is too large");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new TypeError("request is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function localApiRequest(request) {
  return Boolean(localWalletReferer(request.headers.referer, port));
}

async function handleSimulationApi(request, response, requestUrl) {
  if (!localApiRequest(request)) {
    json(response, { ok: false, code: "LOCAL_PAGE_ONLY" }, 403);
    return;
  }
  try {
    if (request.method === "GET" && requestUrl.pathname === "/api/local-v2/session") {
      json(response, { ok: true, session: simulation.session(requestUrl.searchParams.get("tokenId")) });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/local-v2/activity") {
      json(response, { ok: true, ...simulation.activity(requestUrl.searchParams.get("tokenId")) });
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { allow: "GET, POST" }).end();
      return;
    }
    const body = await readJson(request);
    const output = requestUrl.pathname === "/api/local-v2/policy"
      ? { policy: simulation.savePolicy(body) }
      : requestUrl.pathname === "/api/local-v2/directed/resolve"
        ? await simulation.resolve(body)
        : requestUrl.pathname === "/api/local-v2/directed/simulate"
          ? { result: await simulation.simulate(body) }
          : requestUrl.pathname === "/api/local-v2/scout"
            ? { result: simulation.scout(body) }
            : null;
    if (!output) {
      json(response, { ok: false, code: "NOT_FOUND" }, 404);
      return;
    }
    json(response, { ok: true, ...output });
  } catch (error) {
    json(response, { ok: false, code: error?.code ?? "INVALID_LOCAL_REQUEST",
      message: error?.message ?? "Local simulation failed" }, 400);
  }
}

function localPath(urlValue) {
  const url = new URL(urlValue, `http://127.0.0.1:${port}`);
  let pathname = decodeURIComponent(url.pathname);
  if (/^\/broker\/punk\/\d+\/?$/.test(pathname)) pathname = "/broker/punk/index.html";
  else if (/^\/punk\/\d+\/?$/.test(pathname)) pathname = "/punk/index.html";
  else if (pathname.endsWith("/")) pathname += "index.html";
  const target = resolve(root, `.${pathname}`);
  if (target !== root && !target.startsWith(`${root}${sep}`)) return null;
  return target;
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (requestUrl.pathname.startsWith("/api/local-v2/")) {
    await handleSimulationApi(request, response, requestUrl);
    return;
  }
  if (requestUrl.pathname === "/api/broker/wallet-config") {
    if (request.method !== "GET") {
      response.writeHead(405, { allow: "GET" }).end();
      return;
    }
    const origin = localWalletReferer(request.headers.referer, port);
    if (!origin) {
      json(response, { ok: false, code: "LOCAL_WALLET_PAGE_ONLY" }, 403);
      return;
    }
    try {
      const wallet = await localWalletConfiguration({ origin });
      json(response, { ok: true, wallet });
    } catch {
      json(response, { ok: false, code: "LOCAL_WALLET_CONFIG_UNAVAILABLE" }, 503);
    }
    return;
  }
  if (LOCAL_BROKER_READ_PATHS.includes(requestUrl.pathname)) {
    if (request.method !== "GET") {
      response.writeHead(405, { allow: "GET" }).end();
      return;
    }
    if (!localApiRequest(request)) {
      json(response, { ok: false, code: "LOCAL_PAGE_ONLY" }, 403);
      return;
    }
    try {
      const upstream = await fetchLocalBrokerRead({ pathname: requestUrl.pathname,
        searchParams: requestUrl.searchParams });
      response.writeHead(upstream.status, { "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store", "x-content-type-options": "nosniff" });
      response.end(upstream.body);
    } catch {
      json(response, { ok: false, code: "LOCAL_READ_UNAVAILABLE" }, 503);
    }
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }
  const target = localPath(request.url ?? "/");
  try {
    if (!target || !(await stat(target)).isFile()) throw new Error("not found");
    const body = await readFile(target);
    response.writeHead(200, { "content-type": types[extname(target)] ?? "application/octet-stream",
      "cache-control": "no-store", "x-content-type-options": "nosniff" });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    const body = await readFile(resolve(root, "404.html"));
    response.writeHead(404, { "content-type": types[".html"], "cache-control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : body);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Gogh Punks V2 local demo: http://127.0.0.1:${port}/broker/punk/93?demo=1`);
  console.log("LOCAL SIMULATION ONLY · optional Reown connection; no signature or transaction submission");
});
