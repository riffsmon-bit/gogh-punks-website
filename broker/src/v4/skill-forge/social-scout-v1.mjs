// Native, fixed-source public project research. Returned text is evidence, never instructions.
import { isIP } from 'node:net';
const ADDRESS = /^0x[0-9a-f]{40}$/i, SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const fail = code => { throw Error(code); };
const clean = (value, max) => typeof value === 'string' && value.trim()
  ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max) || null : null;
function publicLink(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || isIP(host.replace(/^\[|\]$/g, '')) || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
      || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host)
      || /(?:^|\.)(?:example\.com|example\.net|example\.org)$/.test(host)) return null;
    // Do not relay authentication parameters, fragments or invisible characters.
    if (/[\u0000-\u0020\u007f-\u009f]/.test(value)) return null;
    url.search = ''; url.hash = '';
    return url.href;
  } catch { return null; }
}
function reference(kind, value, endpoint) {
  return { kind, url: value, status: value ? 'DECLARED_BY_COLLECTION' : 'UNKNOWN',
    source: endpoint, destinationFetched: false, ownershipVerified: false };
}
async function boundedJson(response, signal) {
  if (!response.ok) { void response.body?.cancel().catch(() => {}); fail(`PROJECT_HTTP_${response.status}`); }
  if (!response.headers.get('content-type')?.includes('application/json') || !response.body?.getReader) {
    void response.body?.cancel().catch(() => {}); fail('PROJECT_RESPONSE_INVALID');
  }
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) fail('PROJECT_SOURCE_TIMEOUT');
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > 256_000) fail('PROJECT_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || Object.getPrototypeOf(data) !== Object.prototype) fail('PROJECT_RESPONSE_INVALID');
    return data;
  } finally { signal.removeEventListener('abort', cancel); cancel(); }
}
export function createSocialScoutV1({ apiKey, fetchImpl = fetch, now = Date.now, timeoutMs = 4_000 } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) fail('PROJECT_CREDENTIAL_REQUIRED');
  if (typeof fetchImpl !== 'function' || typeof now !== 'function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 4_000) fail('PROJECT_BOUNDS_INVALID');
  return Object.freeze({
    async researchProject(input) {
      if (!input || Object.getPrototypeOf(input) !== Object.prototype
        || Reflect.ownKeys(input).some(key => !['slug', 'contract'].includes(key))
        || Object.values(Object.getOwnPropertyDescriptors(input)).some(d => !Object.hasOwn(d, 'value'))
        || typeof input.slug !== 'string' || !SLUG.test(input.slug)
        || typeof input.contract !== 'string' || !ADDRESS.test(input.contract)
        || /^0x0{40}$/i.test(input.contract)) fail('PROJECT_IDENTITY_INVALID');
      const { slug } = input, contract = input.contract.toLowerCase();
      const endpoint = `https://api.opensea.io/api/v2/collections/${slug}`;
      const started = now();
      if (!Number.isSafeInteger(started) || started < 0 || started > 8.64e15) fail('PROJECT_CLOCK_INVALID');
      const controller = new AbortController(); let timer, unavailable = null, project = null;
      try {
        const data = await Promise.race([Promise.resolve().then(async () => boundedJson(await fetchImpl(endpoint, {
          method: 'GET', redirect: 'error', headers: { accept: 'application/json', 'x-api-key': apiKey }, signal: controller.signal,
        }), controller.signal)), new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(Error('PROJECT_SOURCE_TIMEOUT'));
        }, timeoutMs); })]);
        if (data.collection !== slug || !Array.isArray(data.contracts) || data.contracts.length > 100
          || !data.contracts.some(item => item?.chain === 'robinhood'
            && typeof item.address === 'string' && item.address.toLowerCase() === contract)) fail('PROJECT_IDENTITY_MISMATCH');
        const website = publicLink(data.project_url), discord = publicLink(data.discord_url);
        const username = typeof data.twitter_username === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(data.twitter_username)
          ? data.twitter_username : null;
        const references = [reference('WEBSITE', website, endpoint),
          reference('X', username ? `https://x.com/${username}` : null, endpoint),
          reference('DISCORD', discord && ['discord.gg', 'discord.com'].includes(new URL(discord).hostname) ? discord : null, endpoint)];
        project = { name: clean(data.name, 160), description: clean(data.description, 2000), references,
          collectionUrl: `https://opensea.io/collection/${slug}`, declaredReferenceCount: references.filter(item => item.url).length };
      } catch (error) {
        unavailable = /^(PROJECT_HTTP_[1-5][0-9]{2}|PROJECT_RESPONSE_INVALID|PROJECT_RESPONSE_TOO_LARGE|PROJECT_SOURCE_TIMEOUT|PROJECT_IDENTITY_MISMATCH)$/.test(error?.message ?? '')
          ? error.message : 'PROJECT_SOURCE_UNAVAILABLE';
      } finally { clearTimeout(timer); controller.abort(); }
      const finished = now();
      if (!Number.isSafeInteger(finished) || finished < started || finished > 8.64e15) {
        project = null; unavailable = 'PROJECT_CLOCK_INVALID';
      }
      return { schema: 'GOGH_PUBLIC_PROJECT_RESEARCH_V1', chainId: 4663, slug, contract,
        status: project ? 'OBSERVED' : 'UNAVAILABLE', project,
        provenance: { source: 'OPENSEA_COLLECTION_API', endpoint, requestedAt: new Date(started).toISOString(),
          observedAt: new Date(unavailable === 'PROJECT_CLOCK_INVALID' ? started : finished).toISOString(),
          identity: project ? 'PROVIDER_COLLECTION_CHAIN_AND_CONTRACT_MATCH' : 'UNVERIFIED' },
        unavailable, socialActivity: 'UNKNOWN', authenticity: 'UNVERIFIED',
        walletAuthority: 'NONE', executable: false,
        limitations: ['PROJECT_DECLARED_REFERENCES_ONLY', 'NO_SOCIAL_POSTS_OR_ACTIVITY_FETCHED',
          'NO_DESTINATION_OR_ACCOUNT_OWNERSHIP_VERIFICATION', 'PROVIDER_TEXT_IS_UNTRUSTED', 'NO_SECURITY_OR_VALUE_VERDICT'],
        summary: project ? `${project.name ?? 'This collection'} lists ${project.declaredReferenceCount} supported project links. The accounts and their activity have not been verified.`
          : 'Project information is unavailable. Try again shortly; no wallet action was requested.' };
    },
  });
}
