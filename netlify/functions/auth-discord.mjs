import {
  discordAuthorizationUrl,
  DiscordError,
  exchangeDiscordCode,
  getDiscordUser,
  validateGuildMember,
} from "./_shared/discord.mjs";
import { createDiscordSession } from "./_shared/database.mjs";
import { getSiteUrl } from "./_shared/config.mjs";
import { publicFailure } from "./_shared/http.mjs";
import {
  clearCookie,
  cookie,
  OAUTH_STATE_COOKIE,
  parseCookies,
  randomToken,
  safeEqual,
  SESSION_COOKIE,
} from "./_shared/session.mjs";

function secureCookies() {
  return new URL(getSiteUrl()).protocol === "https:";
}

function verificationRedirect(code = null) {
  const url = new URL("/verify/", getSiteUrl());
  if (code) url.searchParams.set("auth", code);
  return url.toString();
}

function redirectWithCookie(location, setCookies) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const value of setCookies) headers.append("set-cookie", value);
  return new Response(null, { status: 302, headers });
}

function oauthErrorCode(error) {
  if (error instanceof DiscordError) return error.code;
  return "AUTH_UNAVAILABLE";
}

export default async function handler(request) {
  try {
    const path = new URL(request.url).pathname;
    const secure = secureCookies();
    if (path === "/api/auth/discord") {
      const state = randomToken();
      return redirectWithCookie(discordAuthorizationUrl(state), [
        cookie(OAUTH_STATE_COOKIE, state, {
          path: "/api/auth/discord",
          sameSite: "Lax",
          secure,
          maxAge: 600,
        }),
      ]);
    }

    const callbackUrl = new URL(request.url);
    const state = callbackUrl.searchParams.get("state") ?? "";
    const code = callbackUrl.searchParams.get("code") ?? "";
    const expectedState = parseCookies(request).get(OAUTH_STATE_COOKIE) ?? "";
    const clearState = clearCookie(OAUTH_STATE_COOKIE, {
      path: "/api/auth/discord",
      sameSite: "Lax",
      secure,
    });
    if (!state || !code || !expectedState || !safeEqual(state, expectedState)) {
      return redirectWithCookie(verificationRedirect("OAUTH_STATE_INVALID"), [clearState]);
    }

    try {
      const accessToken = await exchangeDiscordCode(code);
      const discordUser = await getDiscordUser(accessToken);
      await validateGuildMember(discordUser);
      const session = await createDiscordSession(discordUser);
      return redirectWithCookie(verificationRedirect("connected"), [
        clearState,
        cookie(SESSION_COOKIE, session.token, {
          path: "/",
          sameSite: "Strict",
          secure,
          maxAge: Math.max(
            1,
            Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
          ),
        }),
      ]);
    } catch (error) {
      return redirectWithCookie(verificationRedirect(oauthErrorCode(error)), [clearState]);
    }
  } catch (error) {
    return publicFailure(error);
  }
}

export const config = {
  path: ["/api/auth/discord", "/api/auth/discord/callback"],
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowLimit: 20,
    windowSize: 60,
  },
};
