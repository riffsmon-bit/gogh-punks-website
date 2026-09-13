// Provider credentials can go only to the provider's public API or the exact
// platform-injected Netlify gateway. Caller-supplied endpoint overrides do not
// change that boundary, and normalization must not conceal traversal or ports.
function normalizedBase(value) {
  if (typeof value !== "string" || !value || value !== value.trim()) throw new TypeError("AI base URL is invalid");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash
    || !["/", "/v1", "/v1/", "/.netlify/ai", "/.netlify/ai/", "/.netlify/ai/v1", "/.netlify/ai/v1/"].includes(url.pathname)
    || value !== url.href && `${value}/` !== url.href) throw new TypeError("AI base URL is invalid");
  return url.href.replace(/\/$/, "");
}

export function managedProviderEndpoint({ environment, baseVariable, directOrigin, path }) {
  const configured = environment[baseVariable];
  if (configured === undefined) return `${directOrigin}${path}`;
  const base = normalizedBase(configured);
  if (base === directOrigin) return `${base}${path}`;
  const versionedBaseSupported = baseVariable === "OPENAI_BASE_URL" && path.startsWith("/v1/");
  if (versionedBaseSupported && base === `${directOrigin}/v1`) return `${base}${path.slice(3)}`;
  const gateway = normalizedBase(environment.NETLIFY_AI_GATEWAY_URL);
  if (!gateway.endsWith("/.netlify/ai")) throw new TypeError("Netlify AI gateway is invalid");
  if (base === gateway) return `${gateway}${path}`;
  // OpenAI's SDK normally appends /responses to a /v1 base. Support that exact
  // provider-specific form without broadening the authoritative gateway prefix.
  if (versionedBaseSupported && base === `${gateway}/v1`) return `${gateway}${path}`;
  throw new TypeError("AI base URL does not match the Netlify gateway");
}

export function netlifyGatewayEndpoint(environment, path) {
  const base = normalizedBase(environment.NETLIFY_AI_GATEWAY_URL);
  if (!base.endsWith("/.netlify/ai")) throw new TypeError("Netlify AI gateway is invalid");
  return `${base}${path}`;
}
