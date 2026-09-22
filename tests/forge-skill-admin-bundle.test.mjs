import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, copyFile, glob, stat, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const exec = promisify(execFile);

test('bundled admin verifies every released package from only Netlify included_files', async () => {
  const config = await readFile('netlify.toml', 'utf8');
  const section = config.split('[functions."broker-v2-forge-skill-admin"]')[1]?.split('\n[')[0];
  assert.ok(section, 'administrator function packaging must be configured');
  const patterns = JSON.parse(section.match(/included_files\s*=\s*(\[[^\]]+\])/s)[1]);
  // Under the repository solely for external npm module resolution. The child
  // uses this directory as cwd; raw packages cannot fall back to source cwd.
  const directory = await mkdtemp(resolve('.skill-admin-bundle-test-'));
  try {
    for (const pattern of patterns) {
      for await (const file of glob(pattern)) {
        if (!(await stat(file)).isFile()) continue;
        const destination = join(directory, file);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(file, destination);
      }
    }
    await build({ entryPoints: [resolve('netlify/functions/_shared/forge-skill-admin-runtime.mjs')],
      outfile: join(directory, 'bundle.mjs'), bundle: true, platform: 'node', format: 'esm',
      packages: 'external', logLevel: 'silent' });
    const probe = async () => {
      const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', `
        import { currentSkillAdminRelease, loadSkillAdminReleasePackages } from './bundle.mjs';
        try {
          const release = await currentSkillAdminRelease();
          const packages = await loadSkillAdminReleasePackages(release);
          console.log(JSON.stringify({skills:packages.map(p=>({slug:p.slug,version:p.manifest.version,
            manifestHash:p.manifestHash,instructionHash:p.instructionHash}))}));
        } catch (error) { console.log(JSON.stringify({error:error.code??error.message})); }
      `], { cwd: directory, timeout: 15000, maxBuffer: 65536 });
      return JSON.parse(stdout);
    };
    const releasePath = join(directory, 'deployments/robinhood-forge-skill-admin.json');
    const release = JSON.parse(await readFile(releasePath, 'utf8'));
    assert.equal(release.skills.length, 7);
    assert.deepEqual((await probe()).skills, release.skills.map(({ slug, version, manifestHash, instructionHash }) =>
      ({ slug, version, manifestHash, instructionHash })));

    const altered = structuredClone(release);
    altered.skills[0].manifestHash = `0x${'1'.repeat(64)}`;
    await writeFile(releasePath, JSON.stringify(altered));
    assert.equal((await probe()).error, 'SKILL_ADMIN_RELEASE_HASH_MISMATCH');
    await writeFile(releasePath, JSON.stringify(release));

    // Check a transitive implementation pin, not just manifest presence.
    const dependency = join(directory, 'broker/src/v4/skill-forge/collection-evidence-v1.mjs');
    await writeFile(dependency, '// changed implementation bytes\n');
    assert.equal((await probe()).error, 'DEPENDENCY_HASH_MISMATCH');
    await rm(dependency);
    assert.equal((await probe()).error, 'ENOENT');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
