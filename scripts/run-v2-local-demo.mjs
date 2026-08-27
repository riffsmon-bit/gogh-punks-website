import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.cwd(), "site");
const portValue = process.env.GOGH_V2_DEMO_PORT ?? "8888";
if (!/^[1-9][0-9]{0,4}$/.test(portValue) || Number(portValue) > 65_535) {
  throw new TypeError("GOGH_V2_DEMO_PORT must be a valid local port");
}
const port = Number(portValue);
const types = Object.freeze({ ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" });

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
  console.log("LOCAL SIMULATION ONLY · no RPC, wallet signature, or transaction submission");
});
