import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createForgeRpcClients } from '../../../broker/src/v4/skill-forge/rpc-clients.mjs';
import { loadResearchSkillCatalog } from '../../../broker/src/v4/skill-forge/research-runtime.mjs';
import { createReadOnlySkillReleaseReview } from '../../../broker/src/v4/skill-forge/read-only-skill-release.mjs';
import { createSkillAdminStore, verifySkillAdminDatabaseRole } from '../../../broker/src/v4/skill-forge/skill-admin-store.mjs';
import { createSkillAdminCoordinator } from '../../../broker/src/v4/skill-forge/skill-admin-coordinator.mjs';
import { skillKey } from '../../../broker/src/v4/skill-forge/capability-resolver.mjs';
let pool;
export async function loadSkillAdminReleasePackages(release) {
  // Netlify bundles this module into another directory. Package files retain
  // their repository paths in included_files, so import.meta.url is not a root.
  const packages=await loadResearchSkillCatalog({root:pathToFileURL(`${process.cwd()}/`),
    selection:release.skills.map(({slug,version})=>({slug,version}))});
  for(const pack of packages){const item=release.skills.find(item=>item.slug===pack.slug&&item.version===pack.manifest.version);
    if(pack.manifestHash!==item.manifestHash||pack.instructionHash!==item.instructionHash)throw Error('SKILL_ADMIN_RELEASE_HASH_MISMATCH');}
  return packages;
}
export async function currentSkillAdminRelease() {
  // Immutable repository artifact only; request bodies and environment flags cannot approve a package.
  const artifact = JSON.parse(await readFile(resolve(process.cwd(),'deployments/robinhood-forge-skill-admin.json'),'utf8'));
  if (artifact.schema !== 'GOGH_READ_ONLY_SKILL_ADMIN_RELEASE_V1' || artifact.status !== 'REVIEWED_ADMIN_RELEASE'
    || artifact.chainId !== 4663 || artifact.registry !== '0xc2a1bd47fbc0fe33e53c85f130be53591c898e83'
    || artifact.registryCodeHash !== '0x6a061b9d291e4402e32f93e7815cb2fe2242e725fe4052740f2be0a78049d3c3'
    || !Array.isArray(artifact.skills) || !artifact.skills.length || artifact.skills.length > 32) throw Error('SKILL_ADMIN_NOT_RELEASED');
  return artifact;
}
export async function forgeSkillAdminRuntime(environment = process.env) {
  const release = await currentSkillAdminRelease(), raw = environment.FORGE_SKILL_ADMIN_DATABASE_URL;
  if (typeof raw !== 'string' || !raw) throw Error('SKILL_ADMIN_DATABASE_UNAVAILABLE');
  const url = new URL(raw);
  if (!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname || !url.password || url.search
    || decodeURIComponent(url.username).split('.')[0] !== 'gogh_forge_skill_admin_request'
    || ['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw Error('SKILL_ADMIN_DATABASE_UNAVAILABLE');
  if (!pool) {
    let ssl = { rejectUnauthorized:true };
    if (url.hostname.endsWith('.pooler.supabase.com')) {
      const ca = await readFile(resolve(process.cwd(),'deployments/certificates/supabase-prod-ca-2021.crt'),'utf8');
      if (new X509Certificate(ca).fingerprint256 !== '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA') throw Error('SKILL_ADMIN_DATABASE_CA_CHANGED');
      ssl = { ...ssl,ca };
    }
    pool = new pg.Pool({ host:url.hostname,port:Number(url.port || 5432),database:decodeURIComponent(url.pathname.slice(1)),
      user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),ssl,max:2,connectionTimeoutMillis:5000,
      idleTimeoutMillis:10000,options:'-c search_path=public -c synchronous_commit=on -c statement_timeout=10000 -c lock_timeout=3000',
      application_name:'gogh-forge-skill-admin' });
    pool.on('error',()=>{});
  }
  await verifySkillAdminDatabaseRole(pool);
  const packages = await loadSkillAdminReleasePackages(release);
  const evidence = {};
  for (const pack of packages) {
    const item = release.skills.find(item=>item.slug===pack.slug && item.version===pack.manifest.version);
    if (pack.manifestHash !== item.manifestHash || pack.instructionHash !== item.instructionHash) throw Error('SKILL_ADMIN_RELEASE_HASH_MISMATCH');
    evidence[skillKey(pack.manifest.skillId,pack.manifest.version)] = {status:'APPROVED_FOR_REGISTRATION',
      manifestHash:item.manifestHash,instructionHash:item.instructionHash,evidenceHash:item.evidenceHash};
  }
  const clients = createForgeRpcClients(environment);
  const review = createReadOnlySkillReleaseReview({client:clients[1],deployment:release,packages,reviewEvidence:evidence});
  const store = createSkillAdminStore({pool,registry:release.registry});
  return {coordinator:createSkillAdminCoordinator({review,store,clients})};
}
