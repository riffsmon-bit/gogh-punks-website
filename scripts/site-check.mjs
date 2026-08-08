import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.cwd(), "site");
const pages = ["index.html", "verify/index.html", "404.html"];
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
  if (path === "/") return join(root, "index.html");
  if (path === "/verify/" || path.startsWith("/verify/")) {
    return join(root, "verify/index.html");
  }
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
]) {
  if (!index.includes(required)) fail(`home page is missing required value ${required}`);
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

const searchable = pages
  .map((page) => readFileSync(join(root, page), "utf8"))
  .concat(readFileSync(join(root, "main.js"), "utf8"))
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

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`PASS ${pages.length} pages and ${collectionIds.length} unique collection previews`);
  console.log("PASS Discord, OpenSea, contract, assets, dimensions, and secret scan");
}
