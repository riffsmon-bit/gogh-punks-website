import { snapshotExactRecord } from "../control-center/strict-record.mjs";

const MAX_WINDOW_SECONDS = 31 * 86_400;

export class ScoutingScheduleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ScoutingScheduleError";
    this.code = code;
  }
}
function fail(code, message) {
  throw new ScoutingScheduleError(code, message);
}

function instant(value, label) {
  if (typeof value !== "string" || value.length > 32) fail("INVALID_SCHEDULE", `${label} is invalid`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail("INVALID_SCHEDULE", `${label} must be an exact UTC timestamp`);
  }
  return value;
}

export function normalizeScoutingSchedule(value) {
  let input;
  try {
    input = snapshotExactRecord(value,
      ["schema", "tokenId", "startAt", "endAt", "timezone", "enabled"], "scouting schedule");
  } catch (error) {
    fail("INVALID_SCHEDULE", error.message);
  }
  if (input.schema !== "GOGH_SCOUTING_SCHEDULE_V1"
    || typeof input.tokenId !== "string" || !/^(?:0|[1-9][0-9]{0,3})$/.test(input.tokenId)
    || input.timezone !== "UTC" || typeof input.enabled !== "boolean") {
    fail("INVALID_SCHEDULE", "scouting schedule identity is invalid");
  }
  const startAt = instant(input.startAt, "schedule start");
  const endAt = instant(input.endAt, "schedule end");
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (end <= start || end - start > MAX_WINDOW_SECONDS * 1_000) {
    fail("INVALID_SCHEDULE", "schedule must last between one second and 31 days");
  }
  return Object.freeze({ schema: input.schema, tokenId: input.tokenId, startAt, endAt,
    timezone: "UTC", enabled: input.enabled });
}

export function evaluateScoutingSchedule(value, nowMs = Date.now()) {
  const schedule = normalizeScoutingSchedule(value);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) fail("INVALID_TIME", "current time is invalid");
  const start = Date.parse(schedule.startAt);
  const end = Date.parse(schedule.endAt);
  const state = !schedule.enabled ? "DISABLED" : nowMs < start ? "SCHEDULED"
    : nowMs >= end ? "EXPIRED" : "ACTIVE";
  return Object.freeze({ allowed: state === "ACTIVE", state, now: new Date(nowMs).toISOString(),
    startsAt: schedule.startAt, endsAt: schedule.endAt });
}
