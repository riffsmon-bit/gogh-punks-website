import { createHash } from "node:crypto";
import { getDatabase } from "@netlify/database";

import { activatePunkSkill, normalizePunkSkill } from
  "../../broker/src/v4/punk-skill.mjs";
import { canonicalJson } from "../../broker/src/scout/canonical-json.mjs";
import { ROBINHOOD } from "../../broker/src/config.mjs";
import { PublicError, json, readJson, requireSameOrigin } from "./_shared/http.mjs";
import { v2Failure } from "./_shared/v2-http.mjs";
import { readV2PunkAuthority } from "./_shared/v2-ownership.mjs";
import { isV2DeployPreviewUrl, requireV2DeployPreview } from "./_shared/v2-review.mjs";
import { requireV2Session } from "./_shared/v2-session.mjs";

const OWNER = /^0x[0-9a-f]{40}$/;
const TOKEN = /^(?:0|[1-9]\d{0,3})$/;

function origin(request) {
  if (isV2DeployPreviewUrl(request)) requireV2DeployPreview(request);
  else requireSameOrigin(request);
}

function bodyValue(value) {
  const fields = ["owner", "skill", "tokenId"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || fields.some((field) => !Object.hasOwn(value, field))) {
    throw new PublicError(400, "INVALID_REQUEST", "The Punk skill confirmation is invalid.");
  }
  const owner = String(value.owner ?? "").toLowerCase();
  const tokenId = String(value.tokenId ?? "");
  if (!OWNER.test(owner) || !TOKEN.test(tokenId) || !value.skill
    || typeof value.skill !== "object" || Array.isArray(value.skill)) {
    throw new PublicError(400, "INVALID_REQUEST", "Choose one owned Punk and one skill draft.");
  }
  return Object.freeze({ owner, tokenId, skill: value.skill });
}

function confirmationHash(skill) {
  return `0x${createHash("sha256").update(canonicalJson(skill)).digest("hex")}`;
}

export async function handleV2Skill(request, {
  pool = getDatabase().pool, readAuthority = readV2PunkAuthority,
  requireSession = requireV2Session, now = new Date(),
} = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    origin(request);
    const body = bodyValue(await readJson(request, 16_000));
    const session = await requireSession(request, pool, now);
    if (session.walletAddress !== body.owner) throw new PublicError(403,
      "NOT_CURRENT_OWNER", "Sign in with the connected Punk owner.");
    const authority = await readAuthority(body.tokenId, { expectedOwner: body.owner });
    let skill;
    try {
      const draft = normalizePunkSkill(body.skill);
      skill = activatePunkSkill(draft, { owner: body.owner, punkTokenId: body.tokenId,
        punkWallet: authority.punkWallet });
    } catch {
      throw new PublicError(400, "INVALID_SKILL",
        "That skill does not match this Punk or requests unsupported authority.");
    }
    const confirmedAt = new Date(now).toISOString();
    const proofHash = confirmationHash(skill);
    const database = await pool.connect();
    try {
      await database.query("BEGIN");
      await database.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
        [ROBINHOOD.chainId, Number(body.tokenId)]);
      const inserted = await database.query(`INSERT INTO broker_v2_punk_skills
        (skill_id, chain_id, collection_address, token_id, schema_name, schema_version,
         name, description, capabilities, authority, policy_effect, state, configured_by,
         ownership_block, owner_confirmation_hash, created_at, activated_at, updated_at)
        VALUES ($1, $2, $3, $4::numeric, 'GOGH_PUNK_SKILL_V1', 1, $5, $6, $7::jsonb,
          'READ_ONLY', 'NONE', 'ACTIVE', $8, $9::bigint, $10, $11, $11, $11)
        ON CONFLICT (skill_id) DO NOTHING RETURNING skill_id`, [skill.skillId,
        ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, body.tokenId, skill.name,
        skill.description, JSON.stringify(skill.capabilities), body.owner,
        authority.blockNumber, proofHash, confirmedAt]);
      if (!inserted.rows[0]) {
        const existing = await database.query(`SELECT name, description, capabilities,
            configured_by, state, owner_confirmation_hash
          FROM broker_v2_punk_skills WHERE skill_id = $1 AND chain_id = $2
            AND collection_address = $3 AND token_id = $4::numeric FOR UPDATE`,
        [skill.skillId, ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, body.tokenId]);
        const row = existing.rows[0];
        if (!row || row.name !== skill.name || row.description !== skill.description
          || canonicalJson(row.capabilities) !== canonicalJson(skill.capabilities)
          || row.configured_by !== body.owner || row.state !== "ACTIVE"
          || row.owner_confirmation_hash !== proofHash) {
          throw new PublicError(409, "SKILL_STATE_CHANGED",
            "That skill identity already belongs to different confirmed evidence.");
        }
      } else {
        await database.query(`INSERT INTO broker_v2_activity
          (chain_id, punk_token_id, activity_type, public_detail, occurred_at)
          VALUES ($1, $2::numeric, 'SKILL_LEARNED', $3::jsonb, $4)`, [ROBINHOOD.chainId,
          body.tokenId, JSON.stringify({ skillId: skill.skillId, name: skill.name,
            capabilities: skill.capabilities, authority: "READ_ONLY", policyEffect: "NONE",
            ownerConfirmationHash: proofHash }), confirmedAt]);
      }
      await database.query("COMMIT");
    } catch (error) { await database.query("ROLLBACK"); throw error; }
    finally { database.release(); }
    return json({ ok: true, tokenId: body.tokenId, skill, ownerConfirmationHash: proofHash,
      persisted: true, transactionPrepared: false, transactionSubmitted: false }, 200, {
      "cache-control": "private, no-store", "netlify-cdn-cache-control": "no-store",
    });
  } catch (error) { return v2Failure(error); }
}

export default handleV2Skill;

export const config = { path: "/api/v2/skill", method: "POST", rateLimit: {
  action: "rate_limit", aggregateBy: ["domain", "ip"], windowLimit: 10, windowSize: 60,
} };
