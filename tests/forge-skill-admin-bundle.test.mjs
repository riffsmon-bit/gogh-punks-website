import test from 'node:test';import assert from 'node:assert/strict';
import{mkdtemp,rm}from'node:fs/promises';import{resolve,join}from'node:path';import{pathToFileURL}from'node:url';
import{build}from'esbuild';import{loadResearchSkillCatalog}from'../broker/src/v4/skill-forge/research-runtime.mjs';
test('bundled admin runtime reads and verifies exact raw packages from deployed working root',async()=>{
  const selection=[{slug:'contract-detective',version:1},{slug:'rarity-eye',version:1}];
  const packs=await loadResearchSkillCatalog({selection});
  const release={skills:packs.map(p=>({slug:p.slug,version:p.manifest.version,manifestHash:p.manifestHash,instructionHash:p.instructionHash}))};
  const directory=await mkdtemp(resolve('.skill-admin-bundle-test-'));
  try{const outfile=join(directory,'bundle.mjs');await build({entryPoints:[resolve('netlify/functions/_shared/forge-skill-admin-runtime.mjs')],outfile,
    bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
    const{loadSkillAdminReleasePackages}=await import(pathToFileURL(outfile).href);
    const verified=await loadSkillAdminReleasePackages(release);assert.equal(verified.length,2);assert.equal(verified[0].manifestHash,packs[0].manifestHash);
    release.skills[0].manifestHash=`0x${'1'.repeat(64)}`;await assert.rejects(loadSkillAdminReleasePackages(release),/HASH_MISMATCH/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
