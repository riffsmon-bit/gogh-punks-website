import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_EXECUTION_MANIFEST_BYTES,
  readBoundedExecutionJson,
} from "./build-owner-direct-free-mint-execution.mjs";

const MAX_RESPONSE_BYTES = 32_768;

class PublishReviewError extends Error {
  constructor(code) {
    super(code);
    this.name = "PublishReviewError";
    this.code = code;
  }
}

function fail(code) {
  throw new PublishReviewError(code);
}

export function parsePublishReviewArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== "--artifact"
    || typeof argv[1] !== "string" || argv[1].length === 0 || argv[1].length > 4_096
    || argv[1].startsWith("--") || !argv[1].toLowerCase().endsWith(".json")) {
    fail("INVALID_ARGUMENTS");
  }
  return Object.freeze({ artifact: argv[1] });
}

function siteOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("INVALID_SITE_URL");
  }
  if ((parsed.protocol !== "https:" && parsed.hostname !== "localhost")
    || parsed.username || parsed.password || parsed.search || parsed.hash
    || !["", "/"].includes(parsed.pathname)) fail("INVALID_SITE_URL");
  return parsed.origin;
}

function reviewToken(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 4_096
    || /[\r\n\0]/.test(value)) fail("REVIEW_TOKEN_NOT_CONFIGURED");
  return value;
}

export async function publishCanaryExecutionReview(argv, dependencies = {}) {
  const args = parsePublishReviewArguments(argv);
  const origin = siteOrigin(dependencies.siteUrl ?? process.env.SITE_URL);
  const token = reviewToken(dependencies.token ?? process.env.CANARY_EXECUTION_REVIEW_TOKEN);
  const readJson = dependencies.readJson ?? readBoundedExecutionJson;
  const fetchFunction = dependencies.fetchFunction ?? fetch;
  const artifact = await readJson(
    resolve(dependencies.cwd ?? process.cwd(), args.artifact),
    MAX_EXECUTION_MANIFEST_BYTES * 4,
    "owner-direct execution artifact",
  );
  const response = await fetchFunction(`${origin}/api/admin/broker-canary-execution-review`, {
    method: "POST",
    redirect: "error",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ artifact }),
  });
  const length = Number(response.headers?.get?.("content-length") ?? 0);
  if (length > MAX_RESPONSE_BYTES) fail("INVALID_RESPONSE");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) fail("INVALID_RESPONSE");
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail("INVALID_RESPONSE");
  }
  if (!response.ok || payload?.ok !== true || payload.status !== "REVIEW_HASH_ACTIVE"
    || !/^0x[0-9a-f]{64}$/.test(payload.executionGate?.artifactSha256 ?? "")
    || !/^(?:0|[1-9]\d*)$/.test(payload.executionGate?.expiresAt ?? "")) {
    fail(payload?.code === "NOT_DEPLOYED" ? "NOT_DEPLOYED" : "REVIEW_NOT_ACTIVATED");
  }
  return Object.freeze({
    status: payload.status,
    artifactSha256: payload.executionGate.artifactSha256,
    expiresAt: payload.executionGate.expiresAt,
  });
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  try {
    const result = await publishCanaryExecutionReview(process.argv.slice(2));
    process.stdout.write(
      `REVIEW_HASH_ACTIVE ${result.artifactSha256} expiresAt=${result.expiresAt}\n`,
    );
  } catch (error) {
    process.stderr.write(`REVIEW_HASH_NOT_ACTIVE [${error?.code ?? "UNEXPECTED_FAILURE"}]\n`);
    process.exitCode = 2;
  }
}
