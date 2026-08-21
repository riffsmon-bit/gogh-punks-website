import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.cwd(), "site");
const pages = [
  "index.html",
  "404.html",
  "broker/index.html",
  "discover/index.html",
  "punk/index.html",
];
const failures = [];

function fail(message) {
  failures.push(message);
}

function localTarget(reference) {
  if (
    reference.startsWith("http://") ||
    reference.startsWith("https://") ||
    reference.startsWith("#") ||
    reference.startsWith("mailto:")
  ) {
    return null;
  }

  const path = reference.split(/[?#]/, 1)[0] || "/";
  if (path.startsWith("/api/")) return null;
  if (path === "/") return join(root, "index.html");
  if (path.startsWith("/punk/") && path !== "/punk/index.html") {
    return join(root, "punk", "index.html");
  }
  if (path.endsWith("/")) return join(root, path.replace(/^\//, ""), "index.html");
  return join(root, normalize(path.replace(/^\//, "")));
}

for (const page of pages) {
  const path = join(root, page);
  const html = readFileSync(path, "utf8");
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const reference = match[1];
    if (!reference) continue;
    const target = localTarget(reference);
    if (!target) continue;
    try {
      readFileSync(target);
    } catch {
      fail(`${page} references missing file ${reference}`);
    }
  }

  if (html.includes("localhost") || html.includes("127.0.0.1")) {
    fail(`${page} contains a local-only URL`);
  }
}

const index = readFileSync(join(root, "index.html"), "utf8");
for (const required of [
  "https://discord.gg/NgRzPNra6s",
  "https://opensea.io/collection/gogh-punks-255843210",
  "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6",
  "SOLD OUT",
  "FINAL CIRCULATING SUPPLY",
  "4,295",
  "5,016",
  "maxSupply() equals the historical mint count",
  "Trade on OpenSea",
  "Coming next · The Art Broker",
  "Punk Account",
  "Art Scout",
  "Living Gallery",
  "Art Mandate",
  "transaction features remain",
]) {
  if (!index.includes(required)) fail(`home page is missing required value ${required}`);
}

if (index.includes("/verify/")) {
  fail("home page still exposes the retired GTD capture page");
}
if (index.includes("0.003 ETH")) {
  fail("home page still contains the previous public mint price");
}
if (
  index.includes("GTD PHASE IS OPEN") ||
  index.includes("PUBLIC MINT IS OPEN") ||
  index.includes(">Mint on OpenSea")
) {
  fail("home page still presents the ended mint as open");
}
if (
  index.includes("2026-08-14T23:15:00.000Z") ||
  index.includes("2026-08-15T23:15:00.000Z") ||
  index.includes("August 15, 2026 · 7:15 PM EDT")
) {
  fail("home page still contains the previous public mint start time");
}

const collectionIds = [1, 4, 7, 10, 13, 16, 20, 23, 26, 30, 36, 38, 44, 49, 56, 75];
const hashes = new Set();
for (const id of collectionIds) {
  const path = join(root, "assets", "collection", `${id}.png`);
  const image = readFileSync(path);
  if (image.toString("ascii", 1, 4) !== "PNG") fail(`${id}.png is not a PNG`);
  if (image.readUInt32BE(16) !== 768 || image.readUInt32BE(20) !== 768) {
    fail(`${id}.png is not 768x768`);
  }
  hashes.add(createHash("sha256").update(image).digest("hex"));
}

if (hashes.size !== collectionIds.length) {
  fail("selected website preview images contain a duplicate");
}

for (const file of ["styles.css", "main.js", "robots.txt", "site.webmanifest"]) {
  if (!extname(file) && file !== "robots.txt") fail(`unexpected site asset ${file}`);
  readFileSync(join(root, file));
}

for (const file of ["broker.css", "broker.js", "wallet.js", "canary-execution.js", "keccak256.js"]) {
  readFileSync(join(root, file));
}

const brokerPages = pages
  .filter((page) => page.includes("/"))
  .map((page) => readFileSync(join(root, page), "utf8"))
  .join("\n");
for (const required of [
  "Autonomous execution",
  "DISABLED",
  "Art Mandate",
  "Curator Journal",
  "LOWER RISK",
  "data-wallet-connect",
  "Wallet disconnected · no automatic signatures or transactions",
  "data-canary-execution",
]) {
  if (!brokerPages.includes(required)) fail(`broker pages are missing required value ${required}`);
}

const searchable = pages
  .map((page) => readFileSync(join(root, page), "utf8"))
  .concat(
    readFileSync(join(root, "main.js"), "utf8"),
    readFileSync(join(root, "broker.js"), "utf8"),
    readFileSync(join(root, "wallet.js"), "utf8"),
    readFileSync(join(root, "canary-execution.js"), "utf8"),
    readFileSync(join(root, "keccak256.js"), "utf8"),
  )
  .join("\n");

for (const forbidden of [
  "DISCORD_BOT_TOKEN",
  "PRIVATE_KEY",
  "SESSION_HMAC_SECRET",
  "seed phrase=",
]) {
  if (searchable.includes(forbidden)) {
    fail(`public site contains forbidden secret marker ${forbidden}`);
  }
}

const netlifyConfiguration = readFileSync(resolve(process.cwd(), "netlify.toml"), "utf8");
for (const required of [
  "img-src 'self' data: https://i.seadn.io",
  "frame-ancestors 'none'",
  "connect-src 'self'",
]) {
  if (!netlifyConfiguration.includes(required)) {
    fail(`Netlify security headers are missing ${required}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`PASS ${pages.length} pages and ${collectionIds.length} unique collection previews`);
  console.log("PASS Discord, OpenSea, contract, assets, dimensions, and secret scan");
}
