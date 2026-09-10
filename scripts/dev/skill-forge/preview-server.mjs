// Isolated UI harness. Training writes reach only its own disposable Anvil, never a real wallet.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, mkdtemp, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { SKILL_ICON_SLUGS } from './skill-icons.mjs';
import { createServer as netServer } from 'node:net';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createPublicClient, createWalletClient, http, decodeEventLog, keccak256, parseAbiItem } from 'viem';
import { manifestHash, instructionHash, createProgressionReader } from '../../../broker/src/v4/skill-forge/capability-resolver.mjs';
import { createResearchSkillRuntime } from '../../../broker/src/v4/skill-forge/research-runtime.mjs';
import { createLocalTrainingIntents } from '../../../broker/src/v4/skill-forge/training-intents.mjs';
import { openTrainingJournal } from '../../../broker/src/v4/skill-forge/training-journal.mjs';
import { createTrainingWalletAdapter } from '../../../site/forge-training-wallet.js';
import { previewLibrary } from './library-roadmap.mjs';
import { FORGE_MINIMUM_SUPPLY } from '../../../broker/src/v4/skill-forge/supply-floor.mjs';
import { SLOT_POLICY } from '../../../broker/src/v4/skill-forge/slot-policy.mjs';

export const catalog = [
  { id: 3, name: 'Contract Detective', mark: '01', status: 'TESTING', capability: 'CONTRACT_READ', bit: 1n, tools: ['inspect_contract'], description: 'Inspect code, interface support and proxy slots. Findings are evidence, not a security guarantee.', boundary: 'Read-only. No signing or spending authority.' },
  { id: 4, name: 'Rarity Eye', mark: '02', status: 'TESTING', capability: 'RARITY_READ', bit: 8n, tools: ['get_metadata', 'rank_trait_sample'], description: 'Compare trait frequencies in an explicit metadata sample. Not a whole-collection rarity rank.', boundary: 'Read-only. Sample coverage must remain visible.' },
  { id: 8, name: 'Market Scout', mark: '03', status: 'TESTING', capability: 'MARKET_READ', bit: 4n, tools: ['get_market_listings'], description: 'Restricted listing reader has retrieved live Gogh listings on Robinhood. Full gated acceptance is still required.', boundary: 'No purchases, offers, approvals or marketplace signing.' },
  { id: 2, name: 'Sniper', mark: '04', status: 'ADAPTING', capability: 'LINK_REVIEW', bit: 16n, tools: ['inspect_mint_link'], description: 'One skill, two planned missions: Mint Link or Floor Snipe. Choose your target and price in chat.', boundary: 'This fixture grants only link review. Neither minting nor marketplace buying is authorized by the mission picker. Floor Snipe needs a separately reviewed purchase capability.' },
  { id: 1, name: 'Mint Hunter', mark: '05', status: 'ADAPTING', capability: 'FREE_MINT', bit: 2n, tools: ['inspect_mint', 'simulate_mint', 'prepare_mint'], description: 'Prepare screened free mints. The equipped-skill execution path still needs end-to-end acceptance.', boundary: 'Owner policy, session, gas, reserve, expiry and simulation always apply. No live execution in this preview.' },
];
const zero = `0x${'0'.repeat(64)}`;
const artifact = async (file, name) => JSON.parse(await readFile(new URL(`../../../contracts/out/${file}/${name}.json`, import.meta.url), 'utf8'));
const json = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);

export async function startPreview({ port = 0, researchClient, controlCenterTraining = false, resume = null } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local preview port');
  // Process-local recovery only. Never accepted from HTTP, a wallet or a URL flag.
  if (resume && (controlCenterTraining !== true || !Number.isInteger(resume.rpcPort) || resume.rpcPort < 1 || resume.rpcPort > 65535
    || !['owner', 'collection', 'registry', 'progression'].every(k => /^0x[0-9a-f]{40}$/i.test(resume[k]))
    || typeof resume.journalPath !== 'string' || !isAbsolute(resume.journalPath))) throw Error('INVALID_LOCAL_RESUME');
  if (resume) { const file = await lstat(resume.journalPath); if (!file.isFile() || file.isSymbolicLink()) throw Error('INVALID_LOCAL_JOURNAL'); }
  let rpcPort = resume?.rpcPort, child = null;
  if (!resume) {
    const reservation = netServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    rpcPort = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    child = spawn('anvil', ['--silent', '--host', '127.0.0.1', '--port', String(rpcPort), '--chain-id', '31337'], { stdio: 'ignore' });
  }
  let startupError, server, journal;
  child?.on('error', error => { startupError = error; });
  const suspend = async () => {
    if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    if (journal) { journal.close(); journal = null; }
  };
  const close = async () => {
    await suspend();
    if (child && child.exitCode === null && !child.killed) child.kill('SIGTERM');
  };
  try {
    const transport = http(`http://127.0.0.1:${rpcPort}`, { timeout: 1000, retryCount: 0 });
    const client = createPublicClient({ transport });
    let ready;
    for (let i = 0; i < 80; i++) {
      if (startupError) throw startupError;
      if (child && child.exitCode !== null) throw new Error('Local chain exited');
      try { ready = await client.getChainId() === 31337; } catch { }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('Local Anvil unavailable');
    if (resume && !/anvil/i.test(await client.request({ method: 'web3_clientVersion' }))) throw Error('LOCAL_ANVIL_REQUIRED');
    const [owner] = await client.request({ method: 'eth_accounts' });
    if (resume && owner?.toLowerCase() !== resume.owner.toLowerCase()) throw Error('LOCAL_RESUME_OWNER_CHANGED');
    const localTrainingNonce = randomBytes(32).toString('hex');
    let mutationInFlight = false;
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
    const collection = resume?.collection ?? await deploy(nft, []), registry = resume?.registry ?? await deploy(reg, [owner]);
    const source = resume ? null : await deploy(training, [collection]);
    const progression = resume?.progression ?? await deploy(prog, [collection, registry, source, SLOT_POLICY.baseSlots, SLOT_POLICY.maxEquippedSkills]);
    if (!resume) {
      await write(training, source, 'bind', [progression]);
      for (const id of [1, 44, 7, 1001, 1002, 1003, 1004, 1005]) await write(nft, collection, 'mint', [owner, BigInt(id)]);
    }
    const skills = [], packages = [];
    for (const entry of catalog) {
      const manifest = { skillId: entry.id, version: 1, chainId: 31337, capabilities: [entry.capability], description: 'LOCAL FIXTURE ONLY — NOT PRODUCTION READY' };
      const hash = manifestHash(manifest), instructions = instructionHash(entry.description);
      if (!resume) await write(reg, registry, 'register', [entry.id, 1, hash, instructions, zero, entry.bit, entry.id === 1 ? 1 : 0]);
      const key = await client.readContract({ address: registry, abi: reg.abi, functionName: 'skillKey', args: [entry.id, 1] });
      // Only test definitions on this disposable chain receive fixture readiness.
      if (!resume && [2, 3, 4].includes(entry.id)) {
        await write(reg, registry, 'setStatus', [key, 3, zero]);
        await write(reg, registry, 'setStatus', [key, 4, manifestHash({ localFixture: true, skillId: entry.id })]);
      }
      skills.push({ ...entry, key, version: 1, manifestHash: hash, instructionHash: instructions });
      packages.push({ manifest, instructions: entry.description, approved: [2, 3, 4].includes(entry.id), status: [2, 3, 4].includes(entry.id) ? 'READY' : 'TESTING' });
    }
    if (!resume) {
      for (const id of [1001, 1002, 1003, 1004]) {
        await write(nft, collection, 'approve', [source, BigInt(id)]);
        await write(training, source, 'sacrifice', [BigInt(id), 1n]);
      }
      await write(prog, progression, 'learnSkill', [1n, skills[0].key]);
      await write(prog, progression, 'learnSkill', [1n, skills[1].key]);
      await write(prog, progression, 'unlockSlot', [1n]);
      await write(prog, progression, 'equipSkill', [1n, 0, skills[0].key]);
      await write(nft, collection, 'approve', [source, 1005n]);
      await write(training, source, 'sacrifice', [1005n, 7n]);
      await write(prog, progression, 'learnSkill', [7n, skills.find(skill => skill.id === 2).key]);
      if (controlCenterTraining === true) {
        // Disposable provenance for a fresh learn → equip → real research test, not an admin credit grant.
        await write(nft, collection, 'mint', [owner, 2001n]);
        await write(nft, collection, 'approve', [source, 2001n]);
        await write(training, source, 'sacrifice', [2001n, 44n]);
      }
    }
    const pinnedRead = createProgressionReader({ client, chainId: 31337, collection, registry, progression,
      registryCodeHash: keccak256(await client.getCode({ address: registry })),
      progressionCodeHash: keccak256(await client.getCode({ address: progression })) });
    // An idle automining Anvil has no fresh blocks. Advance ONLY this owned disposable
    // chain before reads; never relax the production resolver's freshness requirement.
    const advanceLocalClock = async () => {
      if (await client.getChainId() !== 31337) throw new Error('LOCAL_CHAIN_CHANGED');
      const block = await client.getBlock();
      if (Date.now() - Number(block.timestamp) * 1000 > 10_000) await client.request({ method: 'evm_mine' });
    };
    const readState = async tokenId => { await advanceLocalClock(); return pinnedRead(tokenId); };
    const runtime = createResearchSkillRuntime({ readState, packages,
      client: researchClient ?? createPublicClient({ transport: http('https://robinhood-rpc.publicnode.com', { timeout: 8000, retryCount: 0 }) }) });
    const snapshot = async (tokenId, readAttempt = 0) => {
      if (![1, 44, 7].includes(tokenId)) throw new Error('Unknown fixture Punk');
      await advanceLocalClock();
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
      // Fixed fixture inventory only, with fresh owner/existence checks at the snapshot block.
      // This is not a production ownership indexer or a complete wallet-asset inventory.
      const candidates = [];
      for (const id of [1, 44, 7, 1001, 1002, 1003, 1004, 1005]) {
        if (id === tokenId) continue;
        let candidateOwner;
        try { candidateOwner = await client.readContract({ address: collection, abi: nft.abi, functionName: 'ownerOf', args: [BigInt(id)], blockNumber: block.number }); } catch { continue; }
        if (candidateOwner.toLowerCase() !== currentOwner.toLowerCase()) continue;
        candidates.push({ tokenId: id, owner: candidateOwner, learnedCount: await read('learnedCount', [BigInt(id)]),
          credits: await read('trainingCredits', [BigInt(id)]), unlockedSlots: await read('unlockedSlots', [BigInt(id)]),
          canBurn: false, eligibility: 'BLOCKED', inventory: 'UNKNOWN',
          reason: 'Punk Wallet assets and unresolved activity have not been verified. Production sacrifice is locked.' });
      }
      const capabilityContext = await runtime.resolve({ tokenId, owner: currentOwner });
      if (capabilityContext.blockHash !== block.hash) {
        if (readAttempt === 0) return snapshot(tokenId, 1);
        throw Error('LOCAL_SNAPSHOT_CHANGED_DURING_READ');
      }
      // Full history is bounded here because this is our disposable test chain, not a
      // production RPC scan. Round-trip transfers must invalidate an earlier review.
      const transfers = await client.getLogs({ address: collection, event: parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)'),
        args: { tokenId: BigInt(tokenId) }, fromBlock: 0n, toBlock: block.number });
      const latestTransfer = transfers.at(-1);
      if (!latestTransfer || (await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw Error('OWNERSHIP_EPOCH_UNAVAILABLE');
      const ownershipEpoch = `${latestTransfer.blockHash}:${latestTransfer.transactionHash}:${latestTransfer.logIndex}`;
      return { localOnly: true, localTrainingNonce, chainId: 31337, tokenId, owner: currentOwner, collection, registry, progression, ownershipEpoch, blockNumber: block.number, blockHash: block.hash, credits, slots, cap, learned, equipped, history, skills: previewLibrary(skills), candidates, capabilityContext, forgeMinimumSupply: String(FORGE_MINIMUM_SUPPLY), productionReadyCount: 0, canBurn: false };
    };
    const trainingWallet = createTrainingWalletAdapter({ provider: { request: args => client.request(args) }, readSnapshot: snapshot });
    const journalPath = resume?.journalPath ?? join(await mkdtemp(join(tmpdir(), 'gogh-training-journal-')), 'intents.sqlite');
    const journalOptions = { path: journalPath, deploymentIdentity: manifestHash({ trainingReviewVersion: 2, chainId: 31337,
      genesis: (await client.getBlock({ blockNumber: 0n })).hash, collection, registry, progression, owner,
      registryCode: keccak256(await client.getCode({ address: registry })), progressionCode: keccak256(await client.getCode({ address: progression })) }).slice(2) };
    journal = openTrainingJournal(journalOptions);
    let receiptsVisible = true, loseSubmissionHash = false;
    const trainingClient = { ...client, getTransactionReceipt: args => {
      if (!receiptsVisible) throw Error('TEST_RECEIPT_VISIBILITY_DELAY');
      return client.getTransactionReceipt(args);
    } };
    const makeCoordinator = () => createLocalTrainingIntents({ client: trainingClient, owner, progression, readSnapshot: snapshot, journal,
      approvedKeys: skills.filter(s => [2, 3, 4].includes(s.id)).map(s => s.key),
      sendTransaction: async (_transaction, context) => {
        const { transactionHash } = await trainingWallet.submit(context);
        if (loseSubmissionHash) { loseSubmissionHash = false; throw Error('TEST_HASH_RESPONSE_LOST'); }
        return transactionHash;
      } });
    let trainingIntents = makeCoordinator();
    // Validate persisted intents and receipts before exposing the resumed service.
    if (resume) for (const id of [1, 44, 7]) await trainingIntents.recover(id);
    const files = new Map([
      ['/control-center', ['control-center.html', 'text/html']],
      ['/control-center.mjs', ['control-center.mjs', 'text/javascript']],
      ...['broker-v2-forge.js', 'forge-training.js', 'forge-training-transaction.js', 'forge-catalog.js'].map(name => [`/${name}`, [`../../../site/${name}`, 'text/javascript']]),
      ['/broker-v2-forge.css', ['../../../site/broker-v2-forge.css', 'text/css']],
      ['/forge-training.css', ['../../../site/forge-training.css', 'text/css']],
      ['/', ['index.html', 'text/html']], ['/app.mjs', ['app.mjs', 'text/javascript']], ['/style.css', ['style.css', 'text/css']],
      ['/picker.css', ['picker.css', 'text/css']],
      ['/sniper-missions.mjs', ['sniper-missions.mjs', 'text/javascript']],
      ['/skill-icons.mjs', ['skill-icons.mjs', 'text/javascript']],
      ...SKILL_ICON_SLUGS.map(slug => [`/assets/skill-forge/v1/${slug}.png`, [`../../../site/assets/skill-forge/v1/${slug}.png`, 'image/png']]),
      ...[1, 44, 7].map(id => [`/art/${id}.png`, [`../../../site/assets/collection/${id}.png`, 'image/png']]),
    ]);
    server = createServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== expectedHost || (req.headers.origin && req.headers.origin !== `http://${expectedHost}`)) { res.writeHead(403); return res.end('Local preview only'); }
      if (req.method === 'POST' && ['/api/local-training/prepare', '/api/local-training/confirm', '/api/local-training/status', '/api/local-training/recover', '/api/local-training/recover-hash'].includes(req.url)) {
        if (req.headers.origin !== `http://${expectedHost}` || req.headers['x-forge-nonce'] !== localTrainingNonce
          || req.headers['content-type'] !== 'application/json') { res.writeHead(403); return res.end('Local confirmation required'); }
        try {
          let body = '';
          for await (const chunk of req) { body += chunk.toString('utf8'); if (Buffer.byteLength(body) > 2048) throw Error('REQUEST_TOO_LARGE'); }
          const input = JSON.parse(body);
          let result;
          if (req.url.endsWith('/prepare')) result = await trainingIntents.prepare(input);
          else if (req.url.endsWith('/recover')) {
            if (!input || Array.isArray(input) || Object.keys(input).length !== 1 || ![1, 44, 7].includes(input.tokenId)) throw Error('INVALID_RECOVERY');
            result = { localOnly: true, chainId: 31337, productionAuthority: false, tokenId: input.tokenId,
              owner, progression, records: await trainingIntents.recover(input.tokenId) };
          }
          else if (req.url.endsWith('/recover-hash')) {
            if (!input || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'intentId,transactionHash'
              || !/^[0-9a-f]{64}$/.test(input.intentId)) throw Error('INVALID_RECOVERY');
            result = await trainingIntents.recoverHash(input.intentId, input.transactionHash);
          }
          else {
            if (!input || Array.isArray(input) || Object.keys(input).length !== 1 || !/^[0-9a-f]{64}$/.test(input.intentId)) throw Error('INVALID_REVIEW');
            result = await trainingIntents[req.url.endsWith('/status') ? 'status' : 'confirm'](input.intentId);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(json(result));
        } catch (error) {
          const safe = ['STALE_REVIEW_STATE', 'TRAINING_STATE_CHANGED', 'TRAINING_REVIEW_EXPIRED', 'TRAINING_REVIEW_CONSUMED', 'TRAINING_TRANSACTION_UNRESOLVED', 'TRAINING_JOURNAL_UNAVAILABLE'];
          res.writeHead(409); return res.end(`${safe.includes(error.message) ? error.message : 'TRAINING_REVIEW_UNAVAILABLE'}. Inspect local transaction history before creating another review. No production action exists.`);
        }
      }
      if (req.method === 'POST' && req.url === '/api/local-tool') {
        if (req.headers.origin !== `http://${expectedHost}` || req.headers['x-forge-nonce'] !== localTrainingNonce
          || req.headers['content-type'] !== 'application/json') { res.writeHead(403); return res.end('Local confirmation required'); }
        try {
          let body = '';
          for await (const chunk of req) { body += chunk.toString('utf8'); if (Buffer.byteLength(body) > 1024) throw new Error('TOO_LARGE'); }
          const input = JSON.parse(body);
          if (!input || Array.isArray(input) || Object.keys(input).some(k => !['tokenId', 'name'].includes(k))
            || ![1, 44, 7].includes(input.tokenId) || !['inspect_contract', 'rank_trait_sample'].includes(input.name)) throw new Error('INVALID_TOOL');
          const result = await runtime.call({ tokenId: input.tokenId, owner, name: input.name,
            arguments: { contract: '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6',
              ...(input.name === 'rank_trait_sample' ? { tokenIds: ['93', '94', '95'], numericMode: 'categorical' } : {}) } });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(json({ localOnly: true, chainId: 31337, researchChainId: 4663, productionAuthority: false,
            tokenId: input.tokenId, walletAuthority: 'NONE', result, snapshot: await snapshot(input.tokenId) }));
        } catch { res.writeHead(409); return res.end('Tool denied or research unavailable. Refresh current owner and equipment. No production authority.'); }
      }
      if (req.method === 'POST' && req.url === '/api/local-training') {
        if (req.headers.origin !== `http://${expectedHost}` || req.headers['x-forge-nonce'] !== localTrainingNonce || req.headers['content-type'] !== 'application/json') { res.writeHead(403); return res.end('Local confirmation required'); }
        if (mutationInFlight) { res.writeHead(409); return res.end('Local operation in progress'); }
        mutationInFlight = true;
        try {
          let body = '';
          for await (const chunk of req) { body += chunk.toString('utf8'); if (Buffer.byteLength(body) > 4096) throw new Error('REQUEST_TOO_LARGE'); }
          const input = JSON.parse(body);
          if (!input || Array.isArray(input) || Object.keys(input).some(key => !['tokenId', 'operation', 'key', 'slot', 'expectedBlock'].includes(key))
            || ![1, 44, 7].includes(input.tokenId) || !['learn', 'unlock', 'equip', 'unequip'].includes(input.operation)
            || !/^[0-9]+$/.test(input.expectedBlock)) throw new Error('INVALID_ACTION');
          if (await client.getChainId() !== 31337 || String((await client.getBlock()).number) !== input.expectedBlock) throw new Error('STALE_LOCAL_STATE');
          const currentOwner = await client.readContract({ address: collection, abi: nft.abi, functionName: 'ownerOf', args: [BigInt(input.tokenId)] });
          if (currentOwner.toLowerCase() !== owner.toLowerCase()) throw new Error('OWNER_CHANGED');
          let functionName, args;
          if (input.operation === 'learn' || input.operation === 'equip') {
            if (!skills.some(skill => [2, 3, 4].includes(skill.id) && skill.key === input.key)) throw new Error('FIXTURE_SKILL_UNAVAILABLE');
          }
          if (input.operation === 'equip' || input.operation === 'unequip') {
            if (!Number.isInteger(input.slot) || input.slot < 0 || input.slot >= SLOT_POLICY.maxEquippedSkills) throw new Error('INVALID_SLOT');
          }
          if (input.operation === 'learn') { functionName = 'learnSkill'; args = [BigInt(input.tokenId), input.key]; }
          if (input.operation === 'unlock') { functionName = 'unlockSlot'; args = [BigInt(input.tokenId)]; }
          if (input.operation === 'equip') { functionName = 'equipSkill'; args = [BigInt(input.tokenId), input.slot, input.key]; }
          if (input.operation === 'unequip') { functionName = 'unequipSkill'; args = [BigInt(input.tokenId), input.slot]; }
          await client.simulateContract({ address: progression, abi: prog.abi, functionName, args, account: owner });
          // The older standalone preview also uses the same pending/retry safety boundary.
          const reviewed = await trainingIntents.prepare(input);
          const confirmation = await trainingIntents.confirm(reviewed.intentId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(json(confirmation));
        } catch {
          res.writeHead(409); return res.end('Local action not confirmed. Refresh state before retrying. No production action exists.');
        } finally { mutationInFlight = false; }
      }
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
    server.requestTimeout = 10000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    return { url: `http://127.0.0.1:${server.address().port}`, close, suspend,
      resumeConfig: { rpcPort, owner, collection, registry, progression, journalPath },
      // Test-only process-local hook: no HTTP route and no production deployment.
      reopenCoordinator: () => { journal.close(); journal = openTrainingJournal(journalOptions); trainingIntents = makeCoordinator(); },
      journalPath: journalOptions.path,
      setReceiptVisibility: visible => { receiptsVisible = visible === true; },
      loseNextSubmissionHash: () => { loseSubmissionHash = true; },
      mineFixtureBlock: () => client.request({ method: 'evm_mine' }),
      roundTripFixture: async tokenId => {
        if (![1, 44, 7].includes(tokenId)) throw Error('INVALID_FIXTURE');
        const [, secondOwner] = await client.request({ method: 'eth_accounts' });
        await write(nft, collection, 'transferFrom', [owner, secondOwner, BigInt(tokenId)]);
        const other = createWalletClient({ transport, account: secondOwner });
        await receipt(await other.writeContract({ address: collection, abi: nft.abi, functionName: 'transferFrom', args: [secondOwner, owner, BigInt(tokenId)], chain: null }));
      } };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== '--local-only' || process.argv.length > 4 || (process.argv[3] && !/^--port=\d{1,5}$/.test(process.argv[3]))) throw new Error('Requires --local-only, optionally --port=NUMBER');
  const preview = await startPreview({ port: process.argv[3] ? Number(process.argv[3].split('=')[1]) : 0 });
  console.log(`Skill Forge local preview: ${preview.url}\nDisposable chain 31337. Local training only. No production wallet connection.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await preview.close(); process.exit(0); });
}
