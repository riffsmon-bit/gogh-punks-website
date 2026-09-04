export const V1_SHUTDOWN_AT = "2026-09-05T22:00:00Z";
export const V1_SHUTDOWN_AT_MS = Date.parse(V1_SHUTDOWN_AT);

export const BROKER_V1_STATES = Object.freeze({
  ACTIVE: "V1_ACTIVE",
  SUNSET_PENDING: "V1_SUNSET_PENDING",
  SHUTDOWN_EXECUTING: "V1_SHUTDOWN_EXECUTING",
  RETIRED: "V1_RETIRED",
  V2_COMING_SOON: "V2_COMING_SOON",
});

export const BROKER_MIGRATION_PAUSED = "PAUSED_MIGRATION";
export const BROKER_MIGRATION_PAUSE_REASON = "SYSTEM_PAUSED_FOR_V4_MIGRATION";
export const V1_RETIRED_REASON = "V1_RETIRED";
export const V1_REGISTRATION_CLOSED = "V1_REGISTRATION_CLOSED";
export const HOSTED_FUNDING_PAUSE_CODE = "HOSTED_FUNDING_RETIRED";
export const HOSTED_FUNDING_PAUSE_MESSAGE =
  "Hosted agent funding is retired while Gogh Punks transitions to self-funded Punk Wallets.";

function timeValue(options = {}) {
  const now = options.now ?? Date.now;
  const value = typeof now === "function" ? now() : now;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("invalid broker clock");
  return value;
}

export function brokerMigrationState(environment = process.env, options = {}) {
  const nowMs = timeValue(options);
  const manuallyPaused = String(environment.BROKER_V4_MIGRATION_STATE ?? "").trim()
    === BROKER_MIGRATION_PAUSED;
  const cutoffReached = nowMs >= V1_SHUTDOWN_AT_MS;
  const transitionComplete = cutoffReached
    && environment.BROKER_V1_RETIREMENT_COMPLETE === "true";
  const paused = manuallyPaused || cutoffReached;
  const state = cutoffReached ? BROKER_V1_STATES.RETIRED
    : manuallyPaused ? BROKER_MIGRATION_PAUSED : BROKER_V1_STATES.SUNSET_PENDING;
  const transitionState = cutoffReached
    ? transitionComplete ? BROKER_V1_STATES.V2_COMING_SOON
      : BROKER_V1_STATES.SHUTDOWN_EXECUTING
    : BROKER_V1_STATES.SUNSET_PENDING;
  const reason = cutoffReached ? V1_RETIRED_REASON
    : manuallyPaused ? BROKER_MIGRATION_PAUSE_REASON : null;
  return Object.freeze({
    state,
    v1State: cutoffReached ? BROKER_V1_STATES.RETIRED : BROKER_V1_STATES.ACTIVE,
    transitionState,
    paused,
    cutoffReached,
    transitionComplete,
    reason,
    serverNow: new Date(nowMs).toISOString(),
    shutdownAt: V1_SHUTDOWN_AT,
    shutdownAtEpochMs: V1_SHUTDOWN_AT_MS,
    timezone: "America/Detroit",
    displayTime: "September 5 • 6:00 PM EDT",
    hostedExecutionEnabled: !paused,
    hostedFundingEnabled: false,
    registrationEnabled: !paused,
    withdrawalsEnabled: true,
  });
}

function stoppedError(migration, fallbackMessage) {
  const error = new Error(migration.cutoffReached
    ? "Art Broker V1 has retired. No new V1 transaction may be submitted."
    : fallbackMessage);
  error.name = migration.cutoffReached ? "BrokerV1RetiredError" : "BrokerMigrationPausedError";
  error.code = migration.reason ?? V1_RETIRED_REASON;
  error.shutdownAt = migration.shutdownAt;
  return error;
}

export function assertHostedExecutionEnabled(environment = process.env, options = {}) {
  const migration = brokerMigrationState(environment, options);
  if (!migration.hostedExecutionEnabled) {
    throw stoppedError(migration, "The Art Broker is paused for the V4 Punk Wallet migration.");
  }
  return migration;
}

export function assertV1RegistrationEnabled(environment = process.env, options = {}) {
  const migration = brokerMigrationState(environment, options);
  if (!migration.registrationEnabled) {
    const error = stoppedError(migration, "New V1 registration is paused for migration.");
    error.code = V1_REGISTRATION_CLOSED;
    throw error;
  }
  return migration;
}

export function assertHostedFundingEnabled(environment = process.env, options = {}) {
  const migration = brokerMigrationState(environment, options);
  if (!migration.hostedFundingEnabled) {
    const error = new Error(HOSTED_FUNDING_PAUSE_MESSAGE);
    error.name = "HostedFundingPausedError";
    error.code = HOSTED_FUNDING_PAUSE_CODE;
    error.shutdownAt = migration.shutdownAt;
    throw error;
  }
  return migration;
}
