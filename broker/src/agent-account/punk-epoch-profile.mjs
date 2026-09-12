import { getAddress, keccak256, parseAbi, stringToHex } from 'viem';
import { normalizePunkAgentAccountDeployment, PUNK_AGENT_EPOCH_DEPLOYMENT_SCHEMA,
  punkAgentAccountReadiness } from './punk-agent-account-manifest.mjs';
import { readEpochOwnership } from '../v4/skill-forge/epoch-ownership.mjs';

const ZERO = `0x${'0'.repeat(40)}`, ZERO_HASH = `0x${'0'.repeat(64)}`;
const MODEL = keccak256(stringToHex('GOGH_WRAPPED_EPOCH_V1'));
const abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function account(uint256) view returns (address)', 'function implementation() view returns (address)',
  'function wrapper() view returns (address)', 'function progression() view returns (address)',
  'function epochs() view returns (address)', 'function COLLECTION() view returns (address)',
  'function CHAIN_ID() view returns (uint256)', 'function collection() view returns (address)',
  'function AUTHORITY_MODEL() view returns (bytes32)', 'function owner() view returns (address)',
  'function token() view returns (uint256,address,uint256)',
  'function isAutonomousSessionActive() view returns (bool)',
  'function trainingCredits(uint256) view returns (uint256)',
  'function unlockedSlots(uint256) view returns (uint8)', 'function slotCap() view returns (uint8)',
  'function learnedCount(uint256) view returns (uint256)', 'function learnedKeyAt(uint256,uint256) view returns (bytes32)',
  'function learnedLevel(uint256,bytes32) view returns (uint8)', 'function equipped(uint256,uint8) view returns (bytes32)',
]);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const token = value => { if (typeof value !== 'string' || !/^(0|[1-9]\d{0,3})$/.test(value)) fail('INVALID_TOKEN_ID'); return BigInt(value); };

// Trusted server configuration only. Query parameters never select a wrapper, chain, or account.
export function epochDeployment(value) {
  const manifest = normalizePunkAgentAccountDeployment(value);
  if (manifest.schema !== PUNK_AGENT_EPOCH_DEPLOYMENT_SCHEMA) fail('EPOCH_MANIFEST_REQUIRED');
  return manifest;
}

async function snapshot(client, value) {
  const manifest = epochDeployment(value);
  if (manifest.status !== 'DEPLOYED' || !manifest.configuration.sourceVerified) fail('EPOCH_NOT_DEPLOYED');
  if (await client.getChainId() !== 4663) fail('WRONG_CHAIN');
  const block = await client.getBlock({ blockTag: 'latest' });
  if (typeof block.number !== 'bigint' || !/^0x[0-9a-f]{64}$/i.test(block.hash)) fail('EPOCH_SNAPSHOT_UNAVAILABLE');
  const records = [...Object.values(manifest.contracts), ...Object.values(manifest.epochAuthority)];
  await Promise.all(records.map(async r => {
    if (BigInt(r.deploymentBlock) > block.number) fail('EPOCH_RUNTIME_MISMATCH');
    const code = await client.getCode({ address: r.address, blockNumber: block.number });
    if (!code || code === '0x' || keccak256(code) !== r.runtimeBytecodeHash) fail('EPOCH_RUNTIME_MISMATCH');
  }));
  const read = (address, functionName, args = []) => client.readContract({ address, abi, functionName, args, blockNumber: block.number });
  const { wrapper, epochs, progression } = manifest.epochAuthority;
  const factory = manifest.contracts.GoghPunkAgentAccountRegistry.address;
  const implementation = manifest.contracts.GoghPunkAgentAccount.address;
  const bindings = await Promise.all([read(factory, 'implementation'), read(factory, 'wrapper'),
    read(wrapper.address, 'COLLECTION'), read(wrapper.address, 'CHAIN_ID'), read(wrapper.address, 'epochs'),
    read(epochs.address, 'wrapper'), read(progression.address, 'wrapper'), read(progression.address, 'collection'),
    read(implementation, 'AUTHORITY_MODEL'), read(implementation, 'wrapper'), read(implementation, 'progression')]);
  if (!same(bindings[0], implementation) || !same(bindings[1], wrapper.address)
    || !same(bindings[2], manifest.canonicalCollection) || bindings[3] !== 4663n
    || !same(bindings[4], epochs.address) || !same(bindings[5], wrapper.address)
    || !same(bindings[6], wrapper.address) || !same(bindings[7], manifest.canonicalCollection)
    || bindings[8] !== MODEL || !same(bindings[9], wrapper.address) || !same(bindings[10], progression.address)) fail('EPOCH_BINDING_MISMATCH');
  const finish = async () => {
    const canonical = await client.getBlock({ blockNumber: block.number });
    // Ordinary chain advancement is not a reorg. These are block-stamped READ views,
    // never authorization artifacts; every action must recheck authority independently.
    if (!same(canonical.hash, block.hash)) fail('EPOCH_SNAPSHOT_CHANGED');
  };
  return { manifest, block, read, finish, factory, wrapper, epochs, progression };
}

export async function readEpochRoster({ client, deployment, owner }) {
  owner = getAddress(owner);
  if (same(owner, ZERO)) fail('INVALID_OWNER');
  const manifest = epochDeployment(deployment);
  if (manifest.status !== 'DEPLOYED') return { enabled: false, complete: true, owner, tokenIds: [], wrapper: null };
  const s = await snapshot(client, manifest);
  const count = await s.read(s.wrapper.address, 'balanceOf', [owner]);
  if (typeof count !== 'bigint' || count < 0n || count > 5016n) fail('EPOCH_ROSTER_BOUND');
  const ids = [];
  // Bounded batches; enumeration is on chain, never inferred from stale index ownership.
  for (let start = 0; start < Number(count); start += 40) {
    const rows = await Promise.all(Array.from({ length: Math.min(40, Number(count) - start) },
      (_, i) => s.read(s.wrapper.address, 'tokenOfOwnerByIndex', [owner, BigInt(start + i)])));
    for (const id of rows) ids.push(String(token(String(id))));
  }
  if (new Set(ids).size !== ids.length) fail('EPOCH_ROSTER_MISMATCH');
  for (let start = 0; start < ids.length; start += 40) await Promise.all(ids.slice(start, start + 40).map(async id => {
    const [holder, custody] = await Promise.all([s.read(s.wrapper.address, 'ownerOf', [BigInt(id)]),
      s.read(manifest.canonicalCollection, 'ownerOf', [BigInt(id)])]);
    if (!same(holder, owner) || !same(custody, s.wrapper.address)) fail('EPOCH_ROSTER_MISMATCH');
  }));
  await s.finish();
  return { enabled: true, complete: true, owner, tokenIds: ids.sort((a, b) => Number(a) - Number(b)),
    wrapper: s.wrapper.address, collection: manifest.canonicalCollection, chainId: 4663,
    blockNumber: String(s.block.number), blockHash: s.block.hash };
}

export async function readEpochPunkProfile({ client, deployment, tokenId, expectedOwner }) {
  const id = token(tokenId), s = await snapshot(client, deployment);
  const authority = await readEpochOwnership({ client, blockNumber: s.block.number, chainId: 4663,
    collection: s.manifest.canonicalCollection, progression: s.progression.address, tokenId,
    config: { wrapper: s.wrapper.address, epochs: s.epochs.address,
      wrapperCodeHash: s.wrapper.runtimeBytecodeHash, epochsCodeHash: s.epochs.runtimeBytecodeHash } });
  if (expectedOwner && !same(authority.owner, expectedOwner)) fail('NOT_CURRENT_OWNER');
  const account = getAddress(await s.read(s.factory, 'account', [id]));
  const code = await client.getCode({ address: account, blockNumber: s.block.number });
  const accountCreated = Boolean(code && code !== '0x');
  let sessionActive = false;
  if (accountCreated) {
    const [model, wrapper, progression, footer, owner, active] = await Promise.all([
      s.read(account, 'AUTHORITY_MODEL'), s.read(account, 'wrapper'), s.read(account, 'progression'),
      s.read(account, 'token'), s.read(account, 'owner'), s.read(account, 'isAutonomousSessionActive')]);
    if (model !== MODEL || !same(wrapper, s.wrapper.address) || !same(progression, s.progression.address)
      || footer[0] !== 4663n || !same(footer[1], s.manifest.canonicalCollection) || footer[2] !== id
      || !same(owner, authority.owner) || typeof active !== 'boolean') fail('EPOCH_ACCOUNT_MISMATCH');
    sessionActive = active;
  }
  const [credits, slots, cap, learnedCount] = await Promise.all([s.read(s.progression.address, 'trainingCredits', [id]),
    s.read(s.progression.address, 'unlockedSlots', [id]), s.read(s.progression.address, 'slotCap'), s.read(s.progression.address, 'learnedCount', [id])]);
  if (!Number.isInteger(slots) || !Number.isInteger(cap) || slots < 1 || slots > cap || cap > 7
    || typeof learnedCount !== 'bigint' || learnedCount > 256n || learnedCount < 0n
    || typeof credits !== 'bigint' || credits < 0n) fail('INVALID_PROGRESSION');
  const learned = [];
  for (let i = 0n; i < learnedCount; i++) {
    const key = await s.read(s.progression.address, 'learnedKeyAt', [id, i]);
    learned.push({ key, level: await s.read(s.progression.address, 'learnedLevel', [id, key]) });
  }
  const equipped = await Promise.all(Array.from({ length: slots }, (_, i) => s.read(s.progression.address, 'equipped', [id, i])));
  if (new Set(learned.map(x => x.key)).size !== learned.length
    || learned.some(x => !/^0x[0-9a-f]{64}$/i.test(x.key) || x.key === ZERO_HASH || !Number.isInteger(x.level) || x.level < 1)
    || new Set(equipped.filter(x => x !== ZERO_HASH)).size !== equipped.filter(x => x !== ZERO_HASH).length
    || equipped.some(key => key !== ZERO_HASH && !learned.some(x => x.key === key))) fail('INVALID_PROGRESSION');
  await s.finish();
  return { ...authority, tokenId, chainId: 4663, collection: s.manifest.canonicalCollection,
    canonicalOwner: authority.wrapped ? s.wrapper.address : authority.owner,
    wrapper: s.wrapper.address, agentAccount: account, accountCreated, sessionActive,
    legacyWalletOwnerAccess: !authority.wrapped, blockNumber: String(s.block.number), blockHash: s.block.hash,
    training: { credits: String(credits), slots, cap, learned, equipped },
    readiness: punkAgentAccountReadiness(s.manifest) };
}

// Read-only enrollment checklist. No checkbox, chat instruction, manifest flag or
// profile response can manufacture an inventory attestation or transaction authority.
export function describeEpochEnrollment(profile) {
  return { status: 'LOCKED', canSubmit: false, productionTransactionsEnabled: false,
    tokenId: profile.tokenId, authorityEpoch: profile.authorityEpoch,
    steps: ['Verify complete legacy wallet inventory and unresolved jobs',
      'Revoke old automation and reconcile pending transactions',
      'Review custody change and receipt marketplace behavior',
      'Approve only this token to the reviewed wrapper', 'Wrap and verify receipt ownership',
      'Create the separate epoch account', 'Learn/equip and approve a new bounded mission'],
    blockers: [...(profile.readiness.ownerSetupReady ? [] : ['DEPLOYMENT_READINESS_INCOMPLETE']),
      'LEGACY_INVENTORY_NOT_VERIFIED', 'LEGACY_ENROLLMENT_REVIEW_REQUIRED', 'PRODUCTION_ENROLLMENT_NOT_CONNECTED'],
    warnings: ['Wrapping escrows the original Punk. It does not migrate its wallet assets.',
      'Direct control of the old Punk Wallet requires unwrapping.',
      'Old accounts remain worker-protected; they do not acquire on-chain epoch protection.',
      'The session receipt is a separate NFT. Marketplace and royalty behavior require review.'] };
}
