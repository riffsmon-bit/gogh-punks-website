import { PublicError } from "./http.mjs";

const PREVIEW_HOST = /^(?:deploy-preview-[1-9][0-9]*--gogh-punks\.netlify\.app|deploy-preview-[1-9][0-9]*\.preview\.goghpunks\.xyz)$/;

export function isV2DeployPreview(request, environment = process.env) {
  if (environment.CONTEXT !== "deploy-preview") return false;
  try {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && PREVIEW_HOST.test(url.hostname) && origin === url.origin;
  } catch {
    return false;
  }
}

export function requireV2DeployPreview(request, environment = process.env) {
  if (!isV2DeployPreview(request, environment)) {
    throw new PublicError(404, "V2_REVIEW_ONLY", "This test capability exists only in the Art Broker V2 pull-request preview.");
  }
}
