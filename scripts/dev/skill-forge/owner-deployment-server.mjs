import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createOriginalForgeProfileReader } from '../../../broker/src/v4/skill-forge/original-punk-profile.mjs';
import release from '../../../deployments/robinhood-skill-forge.json' with { type: 'json' };
import { readLiveBurnPair, validateBurnTestSelection } from '../../../broker/src/v4/skill-forge/live-burn-pair.mjs';

export async function startOwnerDeploymentServer({ session, build, administrator, port = 64345, client, clients = null,
  burnTestSelection = null, localFixture = false, pins = release }) {
  const burnSelection = burnTestSelection ? validateBurnTestSelection(burnTestSelection) : null;
  const csrf = randomBytes(32).toString('hex');
  const paths = { '/': ['owner-deployment.html', 'text/html'], '/owner-deployment.js': ['owner-deployment.js', 'text/javascript'],
    '/owner-deployment.css': ['owner-deployment.css', 'text/css'], '/deployment-wallet.js': ['../../../site/forge-deployment-wallet.js', 'text/javascript'],
    '/keccak256.js': ['../../../site/keccak256.js', 'text/javascript'] };
  let origin;
  const server = createServer(async (request, response) => {
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'" };
    const json = (status, body) => { response.writeHead(status, { ...headers, 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (request.headers.host !== new URL(origin).host || request.url.startsWith('/api/') && request.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'LOCAL_OWNER_CONSOLE_ONLY' });
    try {
      const url = new URL(request.url, origin);
      if (request.method === 'GET' && paths[url.pathname]) {
        const [path, type] = paths[url.pathname];
        response.writeHead(200, { ...headers, 'content-type': type }); response.end(await readFile(new URL(path, import.meta.url))); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/state') return json(200, { state: session.snapshot(), csrf,
        config: { administrator, chainId: localFixture ? 31337 : 4663, localFixture,
          buildHash: build.buildHash, creationCodeHash: build.pins.deployment.creationCodeHash,
          pins: Object.fromEntries(['collection', 'collectionCodeHash', 'allocationRoot', 'snapshotHash'].map(key => [key, pins[key]])),
          burnTestSelection: burnSelection } });
      if (request.method === 'GET' && url.pathname === '/api/burn-pair') {
        if (localFixture || !burnSelection || !clients) return json(409, { error: 'LIVE_BURN_PAIR_UNAVAILABLE' });
        const state = session.snapshot();
        return json(200, await readLiveBurnPair({ clients, selection: burnSelection, build,
          plan: state.steps[0].status === 'INCLUDED' ? state.packet.plan : null }));
      }
      if (request.method === 'GET' && url.pathname === '/api/profile') {
        const tokenId = url.searchParams.get('tokenId'), state = session.snapshot();
        if (!state.candidates || !/^(0|[1-9][0-9]{0,3})$/.test(tokenId)) return json(409, { error: 'VERIFIED_LIVE_DEPLOYMENT_REQUIRED' });
        const profile = await createOriginalForgeProfileReader({ client, deployment: state.candidates.read })({ tokenId, owner: administrator });
        return json(200, { tokenId, owner: administrator, profile });
      }
      if (request.method === 'GET' && url.pathname === '/api/evidence') return json(200, session.snapshot());
      if (request.method !== 'POST' || url.pathname !== '/api/action') return json(404, { error: 'NOT_FOUND' });
      if (request.headers.origin !== origin || request.headers['x-forge-nonce'] !== csrf
        || request.headers['content-type'] !== 'application/json') return json(403, { error: 'OWNER_CONSOLE_ORIGIN_REQUIRED' });
      let text = '';
      for await (const part of request) { text += part; if (text.length > 4096) return json(413, { error: 'BODY_TOO_LARGE' }); }
      const body = JSON.parse(text), fields = {
        prepare: ['operation', 'revision'], recheck: ['operation', 'revision'],
        'prepare-acceptance': ['operation', 'revision', 'index'], 'resolve-nonce': ['operation', 'revision', 'index'],
        claim: ['operation', 'revision', 'index', 'reviewHash'], recover: ['operation', 'revision', 'index', 'transactionHash'],
      };
      if (!body || !fields[body.operation] || Object.keys(body).sort().join() !== fields[body.operation].sort().join()) return json(400, { error: 'INVALID_OWNER_CONSOLE_ACTION' });
      const { operation, ...input } = body;
      return json(200, { state: await session.run(operation, input) });
    } catch (error) { return json(409, { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'LIVE_READ_UNAVAILABLE', phase: error.forgePhase ?? null }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: origin, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
