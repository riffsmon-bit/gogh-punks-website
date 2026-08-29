import { enrollAutomationV3Punk } from "./automation-v3-worker-state.mjs";
import { readAutomationV3PunkState } from "./autonomy-v3-live.mjs";

const MAX_BACKFILL_PUNKS = 200;
const MAX_CONCURRENCY = 4;

function tokenId(value) {
  const normalized = String(value);
  if (!/^(?:0|[1-9][0-9]{0,3})$/.test(normalized)) {
    throw new TypeError("Backfill Punk token ID is invalid");
  }
  return normalized;
}

export function normalizeAutomationV3BackfillTokenIds(values) {
  if (!Array.isArray(values) || values.length > MAX_BACKFILL_PUNKS) {
    throw new TypeError("Backfill Punk list is invalid");
  }
  const normalized = values.map(tokenId);
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError("Backfill Punk list contains duplicates");
  }
  return Object.freeze(normalized.sort((left, right) => Number(left) - Number(right)));
}

function inactiveReason(punk, nowSeconds) {
  if (punk?.created !== true) return "ACCOUNT_NOT_CREATED";
  if (punk?.authorization?.active !== true || punk?.authorization?.effective !== true) {
    return "AUTHORIZATION_INACTIVE";
  }
  const validUntil = punk?.authorization?.validUntil;
  if (typeof validUntil === "string" && /^[0-9]+$/.test(validUntil)
    && BigInt(validUntil) <= BigInt(nowSeconds + 30)) return "AUTHORIZATION_EXPIRED";
  return "POLICY_INACTIVE";
}

export async function backfillAutomationV3Enrollments(tokenIds, options = {}) {
  const ids = normalizeAutomationV3BackfillTokenIds(tokenIds);
  const apply = options.apply === true;
  if (options.apply !== undefined && typeof options.apply !== "boolean") {
    throw new TypeError("Backfill apply flag is invalid");
  }
  const concurrency = options.concurrency ?? MAX_CONCURRENCY;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new TypeError("Backfill concurrency is invalid");
  }
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new TypeError("Backfill clock is invalid");
  }
  const readPunk = options.readPunk ?? readAutomationV3PunkState;
  const enroll = options.enroll ?? enrollAutomationV3Punk;
  if (typeof readPunk !== "function" || typeof enroll !== "function") {
    throw new TypeError("Backfill dependencies are invalid");
  }

  const results = new Array(ids.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      const index = cursor;
      cursor += 1;
      const selected = ids[index];
      try {
        const punk = await readPunk(selected);
        if (!punk || punk.tokenId !== selected || typeof punk.created !== "boolean"
          || typeof punk.active !== "boolean") {
          throw new TypeError("Live Punk state is invalid");
        }
        if (punk.created !== true || punk.active !== true) {
          results[index] = Object.freeze({
            tokenId: selected, status: "SKIPPED", reason: inactiveReason(punk, nowSeconds),
          });
          continue;
        }
        if (apply) await enroll(punk);
        results[index] = Object.freeze({
          tokenId: selected,
          status: apply ? "ENROLLED" : "WOULD_ENROLL",
          reason: null,
        });
      } catch {
        results[index] = Object.freeze({
          tokenId: selected, status: "SKIPPED", reason: "LIVE_CHECK_FAILED",
        });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length || 1) }, worker));
  const counts = Object.freeze({
    discovered: results.length,
    eligible: results.filter(({ status }) => status === "WOULD_ENROLL"
      || status === "ENROLLED").length,
    enrolled: results.filter(({ status }) => status === "ENROLLED").length,
    skipped: results.filter(({ status }) => status === "SKIPPED").length,
  });
  return Object.freeze({
    schema: "GOGH_AUTOMATION_V3_ENROLLMENT_BACKFILL_V1",
    mode: apply ? "APPLY" : "DRY_RUN",
    counts,
    results: Object.freeze(results),
    authorizesAgent: false,
    sendsTransaction: false,
  });
}
