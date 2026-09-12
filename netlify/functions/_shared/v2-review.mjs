import { PublicError, requireSameOrigin } from "./http.mjs";

const PREVIEW_HOST = /^(?:deploy-preview-[1-9][0-9]*--gogh-punks\.netlify\.app|deploy-preview-[1-9][0-9]*\.preview\.goghpunks\.xyz)$/;
const CHAT_HOST = /^(?:goghpunks\.xyz|www\.goghpunks\.xyz|gogh-punks\.netlify\.app|[a-z0-9][a-z0-9-]{0,62}--gogh-punks\.netlify\.app|[a-z0-9][a-z0-9-]{0,62}\.preview\.goghpunks\.xyz)$/;

export function isV2DeployPreviewUrl(request) {
  try {
    const url = new URL(request.url);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && PREVIEW_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

export function isV2DeployPreview(request) {
  try {
    const url = new URL(request.url);
    return isV2DeployPreviewUrl(request) && request.headers.get("origin") === url.origin;
  } catch {
    return false;
  }
}

export function requireV2DeployPreview(request) {
  if (!isV2DeployPreview(request)) {
    throw new PublicError(404, "V2_REVIEW_ONLY", "This test capability exists only in the Art Broker V2 pull-request preview.");
  }
}

// Owner-authenticated routes use the same implementation on production and
// trusted PR previews. A preview must originate from its own exact HTTPS host.
export function requireV2OwnerOrigin(request) {
  if (isV2DeployPreviewUrl(request)) requireV2DeployPreview(request);
  else requireSameOrigin(request);
  return request.headers.get("origin");
}

export function isV2ChatHost(request) {
  try {
    const url = new URL(request.url);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && CHAT_HOST.test(url.hostname) && request.headers.get("origin") === url.origin;
  } catch {
    return false;
  }
}

export function requireV2ChatHost(request) {
  if (!isV2ChatHost(request)) {
    throw new PublicError(404, "V2_CHAT_UNAVAILABLE",
      "Punk conversation is unavailable on this host.");
  }
}
