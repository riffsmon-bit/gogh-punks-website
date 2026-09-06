import { PublicError } from "./http.mjs";

export function v2TokenIdFrom(request, suffix = "") {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new URL(request.url).pathname.match(new RegExp(`^/api/v2/punks/(\\d+)${escaped}$`));
  if (!match || !/^(?:0|[1-9]\d{0,3})$/.test(match[1])) {
    throw new PublicError(400, "INVALID_TOKEN_ID", "Choose a valid Gogh Punk.");
  }
  return match[1];
}
