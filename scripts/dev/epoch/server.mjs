import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { startEpochWorld } from './local-world.mjs';
import { epochFixtureDeployment } from './fixture-deployment.mjs';
import { readEpochRoster, readEpochPunkProfile, describeEpochEnrollment } from '../../../broker/src/agent-account/punk-epoch-profile.mjs';

const actions = new Set(['wrap', 'create', 'learn', 'equip', 'unequip', 'authorize', 'save', 'mint', 'replay', 'transfer', 'unwrap', 'pause', 'resume', 'inspect']);
export async function startEpochRehearsal() {
  const world = await startEpochWorld();
  const deployment = await epochFixtureDeployment(world);
  let url;
  let busy = false;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      if (req.headers.host !== new URL(url).host) return json(403, { error: 'LOCAL_HOST_REQUIRED' });
      if (req.method === 'GET' && req.url === '/state') return json(200, await world.state());
      // Fixed disposable identities only; never production authentication or transactions.
      if (req.method === 'GET' && req.url === '/epoch/roster') {
        const { owner } = await world.state();
        return json(200, { ok: true, ...await readEpochRoster({ client: world.client, deployment, owner }) });
      }
      if (req.method === 'GET' && req.url === '/epoch/punks/93') {
        const { owner } = await world.state();
        const profile = await readEpochPunkProfile({ client: world.client, deployment, tokenId: '93', expectedOwner: owner });
        return json(200, { ok: true, profile, enrollment: describeEpochEnrollment(profile) });
      }
      if (req.method === 'POST' && req.url === '/action') {
        if (req.headers.origin !== url || req.headers['content-type'] !== 'application/json') return json(403, { error: 'LOCAL_ORIGIN_REQUIRED' });
        if (busy) return json(409, { error: 'LOCAL_ACTION_PENDING' });
        busy = true;
        try {
          let body = '';
          for await (const part of req) { body += part; if (body.length > 1024) return json(413, { error: 'BODY_TOO_LARGE' }); }
          const args = JSON.parse(body);
          if (!actions.has(args.action) || Object.keys(args).length !== 1) return json(400, { error: 'UNKNOWN_LOCAL_ACTION' });
          return json(200, await world.action(args.action));
        } finally { busy = false; }
      }
      const files = { '/': ['index.html', 'text/html'], '/app.mjs': ['app.mjs', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
        '/broker-v2-epoch.js': ['../../../site/broker-v2-epoch.js', 'text/javascript'],
        '/broker-v2-epoch.css': ['../../../site/broker-v2-epoch.css', 'text/css'] };
      if (req.method === 'GET' && Object.hasOwn(files, req.url)) {
        const [file, type] = files[req.url];
        res.writeHead(200, { 'Content-Type': type }); res.end(await readFile(new URL(file, import.meta.url))); return;
      }
      json(404, { error: 'NOT_FOUND' });
    } catch (error) {
      json(409, { error: error.shortMessage ?? error.message, blocked: true });
    }
  });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
  catch (error) { await world.close(); throw error; }
  url = `http://127.0.0.1:${server.address().port}`;
  return { url, world, close: async () => { await new Promise(resolve => server.close(resolve)); await world.close(); } };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== '--local-only') throw Error('Requires --local-only');
  const rehearsal = await startEpochRehearsal();
  console.log(`Epoch + Forge rehearsal: ${rehearsal.url}\nDISPOSABLE Anvil. Mock Punk #93; no MetaMask and no production transactions.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await rehearsal.close(); process.exit(0); });
}
