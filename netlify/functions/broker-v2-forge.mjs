import { getDatabase } from '@netlify/database';
import { pathToFileURL } from 'node:url';
import { createPublicClient, http } from 'viem';
import deployment from '../../deployments/robinhood-skill-forge.json' with { type: 'json' };
import { FORGE_CATALOG } from '../../site/forge-catalog.js';
import { ROBINHOOD } from '../../broker/src/config.mjs';
import { createOriginalForgeProfileReader } from '../../broker/src/v4/skill-forge/original-punk-profile.mjs';
import { loadResearchSkillCatalog } from '../../broker/src/v4/skill-forge/research-runtime.mjs';
import { inspectContract, retrieveInlineMetadata, rankTraitSample } from '../../broker/src/v4/skill-forge/research-tools.mjs';
import { createMarketReader } from '../../broker/src/v4/skill-forge/market-reader.mjs';
import { getRpcUrl } from './_shared/config.mjs';
import { json, readJson, PublicError, requireSameOrigin } from './_shared/http.mjs';
import { v2Failure } from './_shared/v2-http.mjs';
import { requireV2Session } from './_shared/v2-session.mjs';
import { readV2ChatAuthority, assertV2ChatAuthorityUnchanged } from './_shared/v2-ownership.mjs';
import { v2TokenIdFrom } from './_shared/v2-route.mjs';

// Merge seam for the existing V2 lab: diagnostics remain distinct from learned capabilities.
// No POST in this function can learn, equip, mint, burn, enroll or call a wallet.
export async function handleForge(request, { pool, environment = process.env, manifest = deployment,
  sessionReader = requireV2Session, authorityReader = readV2ChatAuthority,
  continuityReader = assertV2ChatAuthorityUnchanged, originCheck = requireSameOrigin,
  clientFactory = () => createPublicClient({ transport: http(getRpcUrl(), { timeout: 8000, retryCount: 0 }) }),
  // included_files retain these repository-relative paths in the function task root.
  // Do not resolve paths relative to bundled import.meta.url (all modules move into one file).
  packageLoader = () => loadResearchSkillCatalog({ root: pathToFileURL(`${process.cwd()}/`) }), inspector = inspectContract,
  metadataReader = retrieveInlineMetadata, marketFactory = createMarketReader,
} = {}) {
  if (!['GET', 'POST'].includes(request.method)) return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const tokenId = v2TokenIdFrom(request, '/forge');
    if (request.method === 'POST') originCheck(request);
    const session = await sessionReader(request, pool);
    const authority = await authorityReader(tokenId, { expectedOwner: session.walletAddress });
    const allowedOwner = String(environment.GOGH_FORGE_TEST_OWNER ?? '').toLowerCase();
    const labAvailable = /^0x[0-9a-f]{40}$/.test(allowedOwner) && allowedOwner === authority.owner.toLowerCase();
    const client = clientFactory();
    const profileReader = createOriginalForgeProfileReader({ client, deployment: manifest,
      packages: manifest.status === 'READ_ONLY_CANARY' ? await packageLoader() : [] });
    const profile = await profileReader({ tokenId, owner: authority.owner });
    const base = { ok: true, tokenId, owner: authority.owner, punkWallet: authority.punkWallet,
      chainId: 4663, mode: 'READ_ONLY_RESEARCH_LAB', labAvailable, profile,
      productionTraining: false, canBurn: false, canLearn: false, canEquip: false,
      trainingCredits: profile.trainingCredits, learnedSkills: profile.learnedSkills,
      equippedSkills: profile.equippedSkills, unlockedSlots: profile.unlockedSlots,
      productionReadyCount: 0, walletAuthority: 'NONE', catalog: FORGE_CATALOG,
      marketAvailable: labAvailable && Boolean(environment.OPENSEA_API_KEY),
      note: 'Original Punk ownership controls this profile. Lab tests do not grant training or wallet authority.' };
    let action = null, result;
    if (request.method === 'POST') {
      if (!labAvailable) throw new PublicError(403, 'FORGE_LAB_LOCKED', 'The controlled Forge lab is not enabled for this owner.');
      const body = await readJson(request, 1024);
      if (!body || Array.isArray(body) || Object.keys(body).some(key => !['action', 'sampleTokenIds'].includes(key))
        || !FORGE_CATALOG.some(skill => skill.test && skill.test === body.action)
        || (body.action !== 'rank_trait_sample' && body.sampleTokenIds !== undefined)) {
        throw new PublicError(400, 'FORGE_ACTION_NOT_ALLOWED', 'Choose an available read-only test. Training and burns are locked.');
      }
      action = body.action;
      if (action === 'inspect_contract') result = await inspector({ client, contract: ROBINHOOD.canonicalCollection });
      else if (action === 'rank_trait_sample') {
        const ids = body.sampleTokenIds;
        if (!Array.isArray(ids) || ids.length !== 3 || !ids.includes(tokenId)
          || ids.some(id => typeof id !== 'string' || !/^(0|[1-9]\d{0,3})$/.test(id)) || new Set(ids).size !== 3) {
          throw new PublicError(400, 'INVALID_FORGE_SAMPLE', 'Choose three distinct token IDs including the selected Punk.');
        }
        const metadata = await metadataReader({ client, contract: ROBINHOOD.canonicalCollection, tokenIds: ids });
        result = { ...rankTraitSample(metadata.tokens, { numericMode: 'categorical' }),
          blockNumber: metadata.blockNumber, blockHash: metadata.blockHash, metadataHash: metadata.metadataHash };
      } else {
        if (!environment.OPENSEA_API_KEY) throw new PublicError(503, 'FORGE_MARKET_UNAVAILABLE', 'The market read credential is unavailable. No sample data substituted.');
        result = await marketFactory({ apiKey: environment.OPENSEA_API_KEY }).getListings({
          slug: 'gogh-punks-255843210', contract: ROBINHOOD.canonicalCollection, limit: 5 });
      }
    }
    // Includes Transfer logs and canonical block checks: same-owner round trips also invalidate reads.
    await continuityReader(authority);
    return json({ ...base, ...(action ? { action, result, observedAt: new Date().toISOString() } : {}) });
  } catch (error) {
    if (error instanceof PublicError) return v2Failure(error);
    return json({ ok: false, code: 'FORGE_TEST_UNAVAILABLE', message: 'Forge state or research could not be verified. No skill, credit, loadout or wallet authority changed.' }, 503);
  }
}
export default request => handleForge(request, { pool: getDatabase().pool });
export const config = { path: '/api/v2/punks/:tokenId/forge', method: ['GET', 'POST'], rateLimit: {
  action: 'rate_limit', aggregateBy: ['ip'], windowLimit: 12, windowSize: 60,
} };
