// Isolated, read-only UI harness. Never connects to Robinhood or a browser wallet.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer as netServer } from 'node:net';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createPublicClient, createWalletClient, http, decodeEventLog } from 'viem';
import { manifestHash, instructionHash } from '../../../broker/src/v4/skill-forge/capability-resolver.mjs';

export const catalog = [
  { id: 3, name: 'Contract Detective', mark: '01', status: 'TESTING', capability: 'CONTRACT_READ', bit: 1n, tools: ['inspect_contract'], description: 'Inspect code, interface support and proxy slots. Findings are evidence, not a security guarantee.', boundary: 'Read-only. No signing or spending authority.' },
  { id: 4, name: 'Rarity Eye', mark: '02', status: 'TESTING', capability: 'RARITY_READ', bit: 8n, tools: ['get_metadata', 'rank_trait_sample'], description: 'Compare trait frequencies in an explicit metadata sample. Not a whole-collection rarity rank.', boundary: 'Read-only. Sample coverage must remain visible.' },
  { id: 8, name: 'Market Scout', mark: '03', status: 'BLOCKED', capability: 'MARKET_READ', bit: 4n, tools: ['get_market_listings'], description: 'Approved listing research wrapper. Successful authenticated live data retrieval is still required.', boundary: 'No purchases, offers, approvals or marketplace signing.' },
  { id: 2, name: 'Link Sniper', mark: '04', status: 'ADAPTING', capability: 'LINK_REVIEW', bit: 16n, tools: ['inspect_mint_link'], description: 'Resolve a mint link into a chain, contract and mechanism. Full screening and simulation acceptance remains unfinished.', boundary: 'Link recognition never grants mint execution.' },
  { id: 1, name: 'Mint Hunter', mark: '05', status: 'ADAPTING', capability: 'FREE_MINT', bit: 2n, tools: ['inspect_mint', 'simulate_mint', 'prepare_mint'], description: 'Prepare screened free mints. The equipped-skill execution path still needs end-to-end acceptance.', boundary: 'Owner policy, session, gas, reserve, expiry and simulation always apply. No live execution in this preview.' },
];
const zero = `0x${'0'.repeat(64)}`;
const artifact = async (file, name) => JSON.parse(await readFile(new URL(`../../../contracts/out/${file}/${name}.json`, import.meta.url), 'utf8'));
const json = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);

export async function startPreview() {
  const reservation = netServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const rpcPort = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn('anvil', ['--silent', '--host', '127.0.0.1', '--port', String(rpcPort), '--chain-id', '31337'], { stdio: 'ignore' });
  let startupError, server;
  child.on('error', error => { startupError = error; });
  const close = async () => {
    if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  };
  try {
    const transport = http(`http://127.0.0.1:${rpcPort}`, { timeout: 1000, retryCount: 0 });
    const client = createPublicClient({ transport });
    let ready;
    for (let i = 0; i < 80; i++) {
      if (startupError) throw startupError;
      if (child.exitCode !== null) throw new Error('Local chain exited');
      try { ready = await client.getChainId() === 31337; } catch { }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('Local Anvil unavailable');
    const [owner] = await client.request({ method: 'eth_accounts' });
    const wallet = createWalletClient({ transport, account: owner });
    const receipt = async hash => {
      const result = await client.waitForTransactionReceipt({ hash });
      if (result.status !== 'success') throw new Error('Fixture transaction reverted');
      return result;
    };
    const deploy = async (a, args) => (await receipt(await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args, chain: null }))).contractAddress;
    const write = async (a, address, functionName, args) => receipt(await wallet.writeContract({ abi: a.abi, address, functionName, args, chain: null }));
    const nft = await artifact('GoghSkillForge.t.sol', 'SkillForgeMockPunks');
    const training = await artifact('GoghSkillForge.t.sol', 'LocalSkillTrainingSource');
    const reg = await artifact('GoghSkillRegistry.sol', 'GoghSkillRegistry');
    const prog = await artifact('GoghSkillProgression.sol', 'GoghSkillProgression');
    const collection = await deploy(nft, []), registry = await deploy(reg, [owner]);
    const source = await deploy(training, [collection]);
    const progression = await deploy(prog, [collection, registry, source, 1, 4]);
    await write(training, source, 'bind', [progression]);
    for (const id of [1, 44, 7, 1001, 1002, 1003, 1004]) await write(nft, collection, 'mint', [owner, BigInt(id)]);
    const skills = [];
    for (const entry of catalog) {
      const manifest = { skillId: entry.id, version: 1, chainId: 31337, capabilities: [entry.capability], description: 'LOCAL FIXTURE ONLY — NOT PRODUCTION READY' };
      const hash = manifestHash(manifest), instructions = instructionHash(entry.description);
      await write(reg, registry, 'register', [entry.id, 1, hash, instructions, zero, entry.bit, entry.id === 1 ? 1 : 0]);
      const key = await client.readContract({ address: registry, abi: reg.abi, functionName: 'skillKey', args: [entry.id, 1] });
      // Only test definitions on this disposable chain receive fixture readiness.
      if ([3, 4].includes(entry.id)) {
        await write(reg, registry, 'setStatus', [key, 3, zero]);
        await write(reg, registry, 'setStatus', [key, 4, manifestHash({ localFixture: true, skillId: entry.id })]);
      }
      skills.push({ ...entry, key, version: 1, manifestHash: hash, instructionHash: instructions });
    }
    for (const id of [1001, 1002, 1003, 1004]) {
      await write(nft, collection, 'approve', [source, BigInt(id)]);
      await write(training, source, 'sacrifice', [BigInt(id), 1n]);
    }
    await write(prog, progression, 'learnSkill', [1n, skills[0].key]);
    await write(prog, progression, 'learnSkill', [1n, skills[1].key]);
    await write(prog, progression, 'unlockSlot', [1n]);
    await write(prog, progression, 'equipSkill', [1n, 0, skills[0].key]);
    const snapshot = async tokenId => {
      if (![1, 44, 7].includes(tokenId)) throw new Error('Unknown fixture Punk');
      const block = await client.getBlock();
      const read = (functionName, args = [BigInt(tokenId)]) => client.readContract({ address: progression, abi: prog.abi, functionName, args, blockNumber: block.number });
      const [credits, slots, count, cap, currentOwner] = await Promise.all([
        read('trainingCredits'), read('unlockedSlots'), read('learnedCount'), read('slotCap', []),
        client.readContract({ address: collection, abi: nft.abi, functionName: 'ownerOf', args: [BigInt(tokenId)], blockNumber: block.number }),
      ]);
      const learned = [];
      for (let i = 0n; i < count; i++) {
        const key = await read('learnedKeyAt', [BigInt(tokenId), i]);
        learned.push({ key, level: await read('learnedLevel', [BigInt(tokenId), key]) });
      }
      const equipped = [];
      for (let i = 0; i < slots; i++) equipped.push(await read('equipped', [BigInt(tokenId), i]));
      const logs = await client.getLogs({ address: progression, fromBlock: 0n, toBlock: block.number });
      const history = logs.flatMap(log => {
        const event = decodeEventLog({ abi: prog.abi, data: log.data, topics: log.topics });
        return event.args.tokenId === BigInt(tokenId) ? [{ name: event.eventName, args: event.args, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex }] : [];
      }).reverse();
      return { localOnly: true, chainId: 31337, tokenId, owner: currentOwner, collection, registry, progression, blockNumber: block.number, blockHash: block.hash, credits, slots, cap, learned, equipped, history, skills, productionReadyCount: 0, canBurn: false };
    };
    const files = new Map([
      ['/', ['index.html', 'text/html']], ['/app.mjs', ['app.mjs', 'text/javascript']], ['/style.css', ['style.css', 'text/css']],
      ...[1, 44, 7].map(id => [`/art/${id}.png`, [`../../../site/assets/collection/${id}.png`, 'image/png']]),
    ]);
    server = createServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== expectedHost || (req.headers.origin && req.headers.origin !== `http://${expectedHost}`)) { res.writeHead(403); return res.end('Local preview only'); }
      if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); return res.end('Read-only preview'); }
      try {
        const url = new URL(req.url, `http://${expectedHost}`);
        if (url.pathname === '/api/forge') {
          const id = url.searchParams.get('tokenId');
          if (!['1', '44', '7'].includes(id)) { res.writeHead(400); return res.end('Unknown fixture Punk'); }
          const body = json(await snapshot(Number(id)));
          res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(body);
        }
        const file = files.get(url.pathname);
        if (!file) { res.writeHead(404); return res.end('Not found'); }
        const body = await readFile(new URL(file[0], import.meta.url));
        res.writeHead(200, { 'Content-Type': file[1] }); res.end(body);
      } catch { if (!res.headersSent) res.writeHead(503); res.end('Local snapshot unavailable. No action was taken.'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${server.address().port}`, close };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--local-only') throw new Error('Requires --local-only');
  const preview = await startPreview();
  console.log(`Skill Forge local preview: ${preview.url}\nDisposable chain 31337. Read-only browser. No production wallet connection.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await preview.close(); process.exit(0); });
}
