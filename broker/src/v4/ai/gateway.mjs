// Provider credentials can go only to the provider's public API or the exact
// platform-injected Netlify gateway. Caller-supplied endpoint overrides do not
// change that boundary, and normalization must not conceal traversal or ports.
function normalizedBase(value) {
  if (typeof value !== "string" || !value || value !== value.trim()) throw new TypeError("AI base URL is invalid");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash
    || !["/", "/v1", "/v1/", "/.netlify/ai", "/.netlify/ai/"].includes(url.pathname)
    || value !== url.href && `${value}/` !== url.href) throw new TypeError("AI base URL is invalid");
  return url.href.replace(/\/$/, "");
}

export function managedProviderEndpoint({ environment, baseVariable, directOrigin, path }) {
  const configured = environment[baseVariable];
  if (configured === undefined) return `${directOrigin}${path}`;
  const base = normalizedBase(configured);
  if (base === directOrigin) return `${base}${path}`;
  if (base === `${directOrigin}/v1` && path.startsWith("/v1/")) return `${base}${path.slice(3)}`;
  const gateway = normalizedBase(environment.NETLIFY_AI_GATEWAY_URL);
  if (!base.endsWith("/.netlify/ai") || base !== gateway) throw new TypeError("AI base URL does not match the Netlify gateway");
  return `${base}${path}`;
}

export function netlifyGatewayEndpoint(environment, path) {
  const base = normalizedBase(environment.NETLIFY_AI_GATEWAY_URL);
  if (!base.endsWith("/.netlify/ai")) throw new TypeError("Netlify AI gateway is invalid");
  return `${base}${path}`;
}
