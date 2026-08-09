import { getDiscordConfig, getSiteUrl } from "./config.mjs";

const DISCORD_API = "https://discord.com/api/v10";

export class DiscordError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = "DiscordError";
    this.code = code;
    this.status = status;
  }
}

async function discordFetch(path, options = {}, authorization) {
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(authorization ? { authorization } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new DiscordError(
      response.status === 404 ? "NOT_MEMBER" : "DISCORD_API_ERROR",
      `Discord returned HTTP ${response.status}.`,
      response.status,
    );
  }
  return response.status === 204 ? null : response.json();
}

export function discordAuthorizationUrl(state) {
  const { clientId } = getDiscordConfig();
  const redirectUri = `${getSiteUrl()}/api/auth/discord/callback`;
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export async function exchangeDiscordCode(code) {
  const { clientId, clientSecret } = getDiscordConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${getSiteUrl()}/api/auth/discord/callback`,
  });
  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new DiscordError(
      "DISCORD_OAUTH_FAILED",
      "Discord sign-in could not be completed.",
      401,
    );
  }
  const payload = await response.json();
  if (!payload.access_token || payload.token_type !== "Bearer") {
    throw new DiscordError(
      "DISCORD_OAUTH_FAILED",
      "Discord returned an invalid sign-in response.",
      401,
    );
  }
  return payload.access_token;
}

export async function getDiscordUser(accessToken) {
  return discordFetch("/users/@me", {}, `Bearer ${accessToken}`);
}

function discordAccountCreatedAt(discordUserId) {
  const discordEpoch = 1_420_070_400_000n;
  return Number((BigInt(discordUserId) >> 22n) + discordEpoch);
}

export async function validateGuildMember(discordUser) {
  const { botToken, guildId, minimumAccountAgeHours } = getDiscordConfig();
  const member = await discordFetch(
    `/guilds/${guildId}/members/${discordUser.id}`,
    {},
    `Bot ${botToken}`,
  );
  if (member.pending) {
    throw new DiscordError(
      "SCREENING_REQUIRED",
      "Accept the Gogh Punks server rules in Discord before claiming GTD.",
      403,
    );
  }
  const ageHours = (Date.now() - discordAccountCreatedAt(discordUser.id)) / 3_600_000;
  if (ageHours < minimumAccountAgeHours) {
    throw new DiscordError(
      "ACCOUNT_TOO_NEW",
      `Discord accounts must be at least ${minimumAccountAgeHours} hours old.`,
      403,
    );
  }
  return member;
}

async function updateMemberRole(discordUserId, roleId, method) {
  if (!roleId) return;
  const { botToken, guildId } = getDiscordConfig();
  await discordFetch(
    `/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`,
    { method },
    `Bot ${botToken}`,
  );
}

export async function syncGtdRoles(discordUserId) {
  const { botToken, guildId, gtdRoleId, visitorRoleId } = getDiscordConfig();
  const member = await discordFetch(
    `/guilds/${guildId}/members/${discordUserId}`,
    {},
    `Bot ${botToken}`,
  );
  const roles = new Set(member.roles ?? []);
  if (!roles.has(gtdRoleId)) await updateMemberRole(discordUserId, gtdRoleId, "PUT");
  if (visitorRoleId && !roles.has(visitorRoleId)) {
    await updateMemberRole(discordUserId, visitorRoleId, "PUT");
  }
}
