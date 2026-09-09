import { getDatabase } from '@netlify/database';
import { createPublicClient, http } from 'viem';
import { FORGE_CATALOG } from '../../site/forge-catalog.js';
import { ROBINHOOD } from '../../broker/src/config.mjs';
import { inspectContract, retrieveInlineMetadata, rankTraitSample } from '../../broker/src/v4/skill-forge/research-tools.mjs';
import { createMarketReader } from '../../broker/src/v4/skill-forge/market-reader.mjs';
import { getRpcUrl } from './_shared/config.mjs';
import { json, readJson, PublicError, requireSameOrigin } from './_shared/http.mjs';
import { v2Failure } from './_shared/v2-http.mjs';
import { requireV2Session } from './_shared/v2-session.mjs';
import { readV2PunkAuthority } from './_shared/v2-ownership.mjs';
import { v2TokenIdFrom } from './_shared/v2-route.mjs';

// Separate diagnostic bench. TESTING packages are never installed or promoted to READY.
export async function handleForge(request, { pool, environment = process.env,
  sessionReader = requireV2Session, authorityReader = readV2PunkAuthority,
  originCheck = requireSameOrigin,
  clientFactory = () => createPublicClient({ transport: http(getRpcUrl(), { timeout: 8000, retryCount: 0 }) }),
  inspector = inspectContract, metadataReader = retrieveInlineMetadata, marketFactory = createMarketReader,
} = {}) {
  if (!['GET', 'POST'].includes(request.method)) return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const tokenId = v2TokenIdFrom(request, '/forge');
    if (request.method === 'POST') originCheck(request);
    const session = await sessionReader(request, pool);
    const authority = await authorityReader(tokenId, { expectedOwner: session.walletAddress });
    const allowedOwner = String(environment.GOGH_FORGE_TEST_OWNER ?? '').toLowerCase();
    const labAvailable = /^0x[0-9a-f]{40}$/.test(allowedOwner) && allowedOwner === authority.owner.toLowerCase();
    const base = { ok: true, tokenId, owner: authority.owner, punkWallet: authority.punkWallet,
      chainId: 4663, mode: 'READ_ONLY_RESEARCH_LAB', labAvailable,
      productionTraining: false, canBurn: false, canLearn: false, canEquip: false,
      trainingCredits: null, learnedSkills: null, equippedSkills: null, unlockedSlots: null,
      productionReadyCount: 0, walletAuthority: 'NONE', catalog: FORGE_CATALOG,
      marketAvailable: labAvailable && Boolean(environment.OPENSEA_API_KEY),
      note: 'Live research tests do not learn or equip a skill. Permanent training contracts are not connected.' };
    if (request.method === 'GET') return json(base);
    if (!labAvailable) throw new PublicError(403, 'FORGE_LAB_LOCKED', 'The controlled Forge lab is not enabled for this owner.');
    const body = await readJson(request, 1024);
    if (!body || Array.isArray(body) || Object.keys(body).some(key => !['action', 'sampleTokenIds'].includes(key))
      || !FORGE_CATALOG.some(skill => skill.test === body.action)) {
      throw new PublicError(400, 'FORGE_ACTION_NOT_ALLOWED', 'Choose an available read-only skill test. Training and burns are locked.');
    }
    let result;
    const client = clientFactory();
    if (body.action === 'inspect_contract') result = await inspector({ client, contract: ROBINHOOD.canonicalCollection });
    else if (body.action === 'rank_trait_sample') {
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
    // Reject a transfer that occurred during a long provider request; never return old-owner context.
    await authorityReader(tokenId, { expectedOwner: session.walletAddress });
    return json({ ...base, action: body.action, observedAt: new Date().toISOString(), result });
  } catch (error) {
    if (error instanceof PublicError) return v2Failure(error);
    return json({ ok: false, code: 'FORGE_TEST_UNAVAILABLE', message: 'The live research test could not complete. No skill, credit, loadout or wallet authority changed.' }, 503);
  }
}
export default request => handleForge(request, { pool: getDatabase().pool });
export const config = { path: '/api/v2/punks/:tokenId/forge', method: ['GET', 'POST'], rateLimit: {
  action: 'rate_limit', aggregateBy: ['ip'], windowLimit: 12, windowSize: 60,
} };
