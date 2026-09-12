import { createPublicClient, getAddress, http, keccak256, parseAbi, zeroAddress } from 'viem';
import core from '../../../../deployments/robinhood.json' with { type: 'json' };
import v2 from '../../../../deployments/robinhood-automation-v2.json' with { type: 'json' };
import v3 from '../../../../deployments/robinhood-automation-v3.json' with { type: 'json' };
import agent from '../../../../deployments/robinhood-punk-agent-account.json' with { type: 'json' };
import release from '../../../../deployments/robinhood-skill-forge.json' with { type: 'json' };
import { forgeManifestCandidates, inspectForgeStack, validateForgeDeploymentPlan } from './forge-deployment.mjs';

const valid = (value, code) => { if (!value) throw Error(code); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const hash = value => /^0x[0-9a-f]{64}$/i.test(value ?? '');
const nonzeroAddress = value => /^0x[0-9a-f]{40}$/i.test(value ?? '') && !same(value, zeroAddress);
const token = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,3})$/.test(value);
const serial = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
const ABI = parseAbi([
  'function ownerOf(uint256) view returns(address)', 'function getApproved(uint256) view returns(address)',
  'function totalSupply() view returns(uint256)', 'function account(uint256) view returns(address)',
  'function balanceOf(address) view returns(uint256)', 'function owner() view returns(address)',
  'function isAutonomousSessionActive() view returns(bool)', 'function pendingOwner() view returns(address)',
  'function trainingCredits(uint256) view returns(uint256)', 'function learnedCount(uint256) view returns(uint256)',
]);
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const WALLETS = [
  ['V1', core.contracts.GoghPunkAccountRegistry, core.contracts.GoghPunkAccountV1],
  ['V2', v2.contracts.GoghPunkAccountRegistryV2, v2.contracts.GoghPunkAccountV2],
  ['V3', v3.contracts.GoghPunkAccountRegistryV3, v3.contracts.GoghPunkAccountV3],
  ['AGENT', agent.contracts.GoghPunkAgentAccountRegistry, agent.contracts.GoghPunkAgentAccount],
];

// Dedicated read-only transports. Batching preserves each JSON-RPC request's
// exact block, result and error; it does not combine evidence between providers.
// Deployment/wallet transaction preflights keep their existing transports.
export function createLiveBurnPairClients({ fetchFn = fetch } = {}) {
  return ['https://robinhood-rpc.publicnode.com', 'https://rpc.mainnet.chain.robinhood.com'].map(url =>
    createPublicClient({ cacheTime: 0, transport: http(url, {
      fetchFn, batch: { batchSize: 20, wait: 5 }, timeout: 8000, retryCount: 1, retryDelay: 150,
    }) }));
}

// Share only work currently in progress. A completed result is never cached for
// the next click, including after an error, a transfer or a deployment change.
export function createLiveBurnPairReader(read) {
  let pending;
  return () => {
    if (!pending) pending = Promise.resolve().then(read).finally(() => { pending = null; });
    return pending;
  };
}

export function validateBurnTestSelection(value) {
  valid(value && Object.keys(value).sort().join() === 'chainId,collection,owner,schema,sourceTokenId,targetTokenId'
    && value.schema === 'GOGH_BURN_TEST_SELECTION_V1' && value.chainId === 4663
    && same(value.collection, release.collection) && nonzeroAddress(value.owner)
    && token(value.sourceTokenId) && token(value.targetTokenId) && value.sourceTokenId !== value.targetTokenId,
  'INVALID_BURN_TEST_SELECTION');
  return Object.freeze({ ...value, collection: getAddress(value.collection), owner: getAddress(value.owner) });
}

// Setup diagnostics only: no calldata, signer, token approval, credit expenditure
// or burn authority. Unknown inventories and off-chain obligations stay unknown.
export async function readLiveBurnPair({ clients, selection: input, plan = null, build = null, deploymentEvidence = null, now = Date.now }) {
  const selection = validateBurnTestSelection(input);
  valid(Array.isArray(clients) && clients.length === 2 && clients[0] !== clients[1], 'BURN_PAIR_RPC_PAIR_REQUIRED');
  if (plan) {
    validateForgeDeploymentPlan(plan, build);
    valid(same(plan.administrator, selection.owner) && same(plan.pins.collection, selection.collection), 'BURN_PAIR_DEPLOYMENT_CHANGED');
  }
  if (deploymentEvidence) {
    valid(plan, 'BURN_PAIR_DEPLOYMENT_CHANGED');
    forgeManifestCandidates({ plan, build, evidence: deploymentEvidence });
  }
  const heads = await Promise.all(clients.map(async client => {
    const [chainId, block] = await Promise.all([client.getChainId(), client.getBlock({ blockTag: 'latest' })]);
    valid(chainId === 4663, 'BURN_PAIR_CHAIN_CHANGED');
    return block;
  }));
  const head = heads.reduce((a, b) => a.number < b.number ? a : b);
  valid(typeof head.number === 'bigint' && hash(head.hash)
    && heads.every(b => typeof b.number === 'bigint' && b.number - head.number <= 120n)
    && Math.abs(now() / 1000 - Number(head.timestamp)) <= 30, 'BURN_PAIR_STALE_HEAD');
  const observations = await Promise.all(clients.map(async client => {
    const [canonical, collectionCode] = await Promise.all([
      client.getBlock({ blockNumber: head.number }), client.getCode({ address: selection.collection, blockNumber: head.number }),
    ]);
    valid(same(canonical.hash, head.hash) && canonical.timestamp === head.timestamp, 'BURN_PAIR_PROVIDERS_DISAGREE');
    if (deploymentEvidence) {
      valid(BigInt(deploymentEvidence.blockNumber) <= head.number, 'BURN_PAIR_DEPLOYMENT_CHANGED');
      const finalized = await client.getBlock({ blockNumber: BigInt(deploymentEvidence.blockNumber) });
      valid(same(finalized.hash, deploymentEvidence.blockHash), 'BURN_PAIR_DEPLOYMENT_CHANGED');
    }
    const read = (address, functionName, args = []) => client.readContract({ address, abi: ABI, functionName, args, blockNumber: head.number });
    valid(keccak256(collectionCode ?? '0x') === release.collectionCodeHash,
      'BURN_PAIR_COLLECTION_CHANGED');
    const [sourceOwner, targetOwner, supply, approved] = await Promise.all([
      read(selection.collection, 'ownerOf', [BigInt(selection.sourceTokenId)]),
      read(selection.collection, 'ownerOf', [BigInt(selection.targetTokenId)]),
      read(selection.collection, 'totalSupply'), read(selection.collection, 'getApproved', [BigInt(selection.sourceTokenId)]),
    ]);
    valid(same(sourceOwner, selection.owner) && same(targetOwner, selection.owner), 'BURN_PAIR_OWNER_CHANGED');
    const [walletPairs, forge] = await Promise.all([Promise.all(WALLETS.map(async ([role, registry, implementation]) => {
      await Promise.all([registry, implementation].map(async record => {
        valid(keccak256(await client.getCode({ address: record.address, blockNumber: head.number }) ?? '0x') === record.runtimeBytecodeHash,
          'BURN_PAIR_WALLET_INFRASTRUCTURE_CHANGED');
      }));
      return Promise.all([selection.sourceTokenId, selection.targetTokenId].map(async tokenId => {
        const address = await read(registry.address, 'account', [BigInt(tokenId)]);
        valid(nonzeroAddress(address), 'BURN_PAIR_WALLET_UNAVAILABLE');
        const [code, nativeWei, wethWei, entryPointDepositWei] = await Promise.all([
          client.getCode({ address, blockNumber: head.number }), client.getBalance({ address, blockNumber: head.number }),
          read(WETH, 'balanceOf', [address]), read(agent.entryPoint, 'balanceOf', [address]),
        ]);
        const deployed = Boolean(code && code !== '0x');
        const [walletOwner, sessionActive] = await Promise.all([
          deployed ? read(address, 'owner') : null,
          role === 'AGENT' ? deployed && read(address, 'isAutonomousSessionActive') : null,
        ]);
        valid(!deployed || same(walletOwner, selection.owner), 'BURN_PAIR_WALLET_OWNER_CHANGED');
        return { role, address: getAddress(address), deployed, nativeWei: String(nativeWei), wethWei: String(wethWei),
          entryPointDepositWei: String(entryPointDepositWei), agentSessionActive: sessionActive,
          nftInventory: 'UNKNOWN', otherTokenInventory: 'UNKNOWN' };
      }));
    })), (async () => {
      if (!plan) return null;
      const [pendingOwner, credits, learnedCount] = await Promise.all([
        read(plan.addresses.registry, 'pendingOwner'),
        read(plan.addresses.progression, 'trainingCredits', [BigInt(selection.targetTokenId)]),
        read(plan.addresses.progression, 'learnedCount', [BigInt(selection.targetTokenId)]),
      ]);
      const pendingGuardian = same(pendingOwner, selection.owner);
      const codeHashes = await inspectForgeStack({ client, plan, build, blockNumber: head.number, pendingGuardian });
      return { addresses: plan.addresses, codeHashes, registryAcceptancePending: pendingGuardian, paused: true,
        targetCredits: String(credits), targetLearnedCount: String(learnedCount), finalizedDeploymentVerified: Boolean(deploymentEvidence),
        ...(deploymentEvidence ? { deploymentVerificationBlockNumber: deploymentEvidence.blockNumber,
          deploymentVerificationBlockHash: deploymentEvidence.blockHash } : {}) };
    })()]);
    const sourceWallets = walletPairs.map(pair => pair[0]), targetWallets = walletPairs.map(pair => pair[1]);
    valid(same((await client.getBlock({ blockNumber: head.number })).hash, head.hash), 'BURN_PAIR_REORG');
    return { sourceOwner: getAddress(sourceOwner), targetOwner: getAddress(targetOwner), supply: String(supply),
      sourceApproval: getAddress(approved), sourceWallets, targetWallets, forge };
  }));
  valid(serial(observations[0]) === serial(observations[1]), 'BURN_PAIR_PROVIDERS_DISAGREE');
  valid(Math.abs(now() / 1000 - Number(head.timestamp)) <= 30, 'BURN_PAIR_STALE_HEAD');
  const observation = observations[0];
  const blockers = ['SOURCE_NFT_AND_OTHER_TOKEN_INVENTORY_UNKNOWN', 'SOURCE_OPERATIONAL_OBLIGATIONS_UNKNOWN',
    'PRODUCTION_BURN_NOT_ENABLED'];
  if (BigInt(observation.supply) <= 1111n) blockers.push('SUPPLY_FLOOR_REACHED');
  if (observation.sourceWallets.some(w => [w.nativeWei, w.wethWei, w.entryPointDepositWei].some(v => BigInt(v) > 0n))) blockers.push('SOURCE_ASSETS_REQUIRE_WITHDRAWAL');
  if (observation.sourceWallets.some(w => w.agentSessionActive)) blockers.push('SOURCE_AGENT_SESSION_ACTIVE');
  if (observation.forge?.registryAcceptancePending) blockers.push('REGISTRY_ACCEPTANCE_PENDING');
  if (observation.forge?.paused) blockers.push('FORGE_PAUSED');
  if (!observation.forge) blockers.push('FORGE_DEPLOYMENT_UNAVAILABLE');
  return { schema: 'GOGH_LIVE_BURN_PAIR_PREFLIGHT_V1', selection, checkedAt: new Date(now()).toISOString(),
    anchor: { number: String(head.number), hash: head.hash, timestamp: String(head.timestamp), finalized: false },
    ...observation, status: 'BLOCKED', canBurn: false, blockers, confirmationText: `BURN ${selection.sourceTokenId}`,
    warning: `Burning Punk #${selection.sourceTokenId} permanently destroys that NFT and can remove access to its wallets. Assets are not transferred to Punk #${selection.targetTokenId}.`,
    expectedCreditGain: '1', publicTransactions: 0 };
}
