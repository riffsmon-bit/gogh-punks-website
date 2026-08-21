const REQUIRED_CAPTURE_CAP = 200;
const REQUIRED_CHAIN_ID = 4663;

export class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigurationError";
    this.code = "SERVICE_NOT_CONFIGURED";
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new ConfigurationError(`${name} is not configured.`);
  return value;
}

function discordId(name, value) {
  if (!/^\d{17,20}$/.test(value)) {
    throw new ConfigurationError(`${name} is not a valid Discord ID.`);
  }
  return value;
}

function nonNegativeNumber(name, value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new ConfigurationError(`${name} must be a non-negative number.`);
  }
  return number;
}

export function getCaptureConfig() {
  const configuredCap = Number(process.env.GTD_CAPTURE_CAP ?? REQUIRED_CAPTURE_CAP);
  const configuredChain = Number(process.env.CHAIN_ID ?? REQUIRED_CHAIN_ID);
  if (configuredCap !== REQUIRED_CAPTURE_CAP) {
    throw new ConfigurationError(
      `GTD_CAPTURE_CAP must remain ${REQUIRED_CAPTURE_CAP}.`,
    );
  }
  if (configuredChain !== REQUIRED_CHAIN_ID) {
    throw new ConfigurationError(`CHAIN_ID must remain ${REQUIRED_CHAIN_ID}.`);
  }
  return {
    cap: REQUIRED_CAPTURE_CAP,
    chainId: REQUIRED_CHAIN_ID,
    allocationLimit: 3,
    priceEth: "0",
    sessionMinutes: 20,
    signatureMinutes: 10,
  };
}

export function getSiteUrl() {
  const raw = process.env.SITE_URL?.trim() || process.env.URL?.trim();
  if (!raw) throw new ConfigurationError("SITE_URL is not configured.");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigurationError("SITE_URL is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new ConfigurationError("SITE_URL must use HTTPS outside local development.");
  }
  return url.origin;
}

export function getDiscordConfig() {
  return {
    clientId: discordId("DISCORD_CLIENT_ID", required("DISCORD_CLIENT_ID")),
    clientSecret: required("DISCORD_CLIENT_SECRET"),
    botToken: required("DISCORD_BOT_TOKEN"),
    guildId: discordId("DISCORD_GUILD_ID", required("DISCORD_GUILD_ID")),
    gtdRoleId: discordId("DISCORD_GTD_ROLE_ID", required("DISCORD_GTD_ROLE_ID")),
    visitorRoleId: process.env.DISCORD_VISITOR_ROLE_ID
      ? discordId("DISCORD_VISITOR_ROLE_ID", process.env.DISCORD_VISITOR_ROLE_ID.trim())
      : null,
    minimumAccountAgeHours: nonNegativeNumber(
      "GTD_MIN_DISCORD_ACCOUNT_AGE_HOURS",
      process.env.GTD_MIN_DISCORD_ACCOUNT_AGE_HOURS ?? 24,
    ),
  };
}

export function getRpcUrl() {
  const raw = required("RPC_URL");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigurationError("RPC_URL is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new ConfigurationError("RPC_URL must use HTTPS.");
  }
  return url.toString();
}

export function getAdminExportToken() {
  const token = required("ADMIN_EXPORT_TOKEN");
  if (token.length < 32) {
    throw new ConfigurationError("ADMIN_EXPORT_TOKEN must contain at least 32 characters.");
  }
  return token;
}

export function getCanaryExecutionReviewToken() {
  const token = required("CANARY_EXECUTION_REVIEW_TOKEN");
  if (token.length < 32) {
    throw new ConfigurationError(
      "CANARY_EXECUTION_REVIEW_TOKEN must contain at least 32 characters.",
    );
  }
  return token;
}
