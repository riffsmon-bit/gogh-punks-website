import { keccak256, parseAbi, parseAbiItem, stringToHex } from 'viem';

const ZERO = `0x${'0'.repeat(64)}`;
const DOMAIN = keccak256(stringToHex('GOGH_ORIGINAL_PUNK_TRAINING_REVIEW_V1'));
export const TRAINING_STATE_ABI = parseAbi([
  'function ownerOf(uint256) view returns(address)', 'function collection() view returns(address)',
  'function registry() view returns(address)', 'function trainingSource() view returns(address)',
  'function REVIEW_DOMAIN() view returns(bytes32)', 'function MAX_REVIEW_LIFETIME() view returns(uint64)',
  'function allocationRoot() view returns(bytes32)', 'function snapshotHash() view returns(bytes32)',
  'function allocationChainId() view returns(uint256)', 'function baseSlots() view returns(uint8)',
  'function slotCap() view returns(uint8)', 'function trainingCredits(uint256) view returns(uint256)',
  'function trainingReviewNonce(uint256) view returns(uint256)', 'function trainingReviewStateHash(uint256) view returns(bytes32)',
  'function claimedStartingSlots(uint256) view returns(uint8)', 'function unlockedSlots(uint256) view returns(uint8)',
  'function learnedLevel(uint256,bytes32) view returns(uint8)', 'function equipped(uint256,uint8) view returns(bytes32)',
  'function available(bytes32) view returns(bool)',
  'function definition(bytes32) view returns((bytes32 manifestHash,bytes32 instructionHash,bytes32 prerequisite,uint256 capabilities,uint32 skillId,uint16 version,uint8 riskTier,uint8 status,bool disabled,bool deprecated,bytes32 replacement,bytes32 reviewEvidenceHash))',
]);
const valid = value => { if (!value) throw Error('FORGE_TRAINING_STATE_UNVERIFIED'); };
const equal = (one, two) => typeof one === 'string' && typeof two === 'string' && one.toLowerCase() === two.toLowerCase();
const uint = value => typeof value === 'bigint' && value >= 0n && value < 2n ** 256n;
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && value !== ZERO;
export function checkedTrainingBlock(block, now = Date.now()) {
  const time = Math.floor(now / 1000);
  valid(block && uint(block.number) && block.number < 2n ** 64n && hash(block.hash) && uint(block.timestamp)
    && Number.isSafeInteger(time) && block.timestamp <= BigInt(time + 5) && block.timestamp >= BigInt(time - 30));
  return { number: String(block.number), hash: block.hash, timestamp: String(block.timestamp) };
}

export async function assertTrainingOwnerContinuity({ client, release, owner, tokenId, anchor, now = Date.now }) {
  valid(await client.getChainId() === release.chainId);
  const after = checkedTrainingBlock(await client.getBlock({ blockTag: 'latest' }), now());
  const fromBlock = BigInt(anchor.number), toBlock = BigInt(after.number);
  valid(toBlock >= fromBlock && toBlock - fromBlock <= 1000n);
  const [prior, currentOwner, logs] = await Promise.all([
    client.getBlock({ blockNumber: fromBlock }),
    client.readContract({ address: release.collection, abi: TRAINING_STATE_ABI, functionName: 'ownerOf', args: [BigInt(tokenId)], blockNumber: toBlock }),
    client.getLogs({ address: release.collection,
      event: parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)'),
      args: { tokenId: BigInt(tokenId) }, fromBlock, toBlock, strict: true }),
  ]);
  valid(prior.number === fromBlock && prior.hash === anchor.hash && String(prior.timestamp) === anchor.timestamp
    && equal(currentOwner, owner) && Array.isArray(logs) && logs.length === 0);
  const canonical = await client.getBlock({ blockNumber: toBlock });
  valid(canonical.number === toBlock && canonical.hash === after.hash && await client.getChainId() === release.chainId);
  return after;
}

// Fixed pins and anchored reads. No client-supplied proof, credit amount, runtime,
// target, registry status or transaction fee enters the verified state.
export async function readReviewedTrainingState({ client, release, owner, tokenId, now = Date.now }) {
  valid(typeof tokenId === 'string' && /^[1-9][0-9]{0,3}$/.test(tokenId)
    && /^0x[0-9a-f]{40}$/.test(owner) && release.allowedOwners.includes(owner)
    && await client.getChainId() === release.chainId);
  const anchor = checkedTrainingBlock(await client.getBlock({ blockTag: 'latest' }), now());
  const blockNumber = BigInt(anchor.number), args = [BigInt(tokenId)];
  const read = (address, functionName, values = []) => client.readContract({ address, abi: TRAINING_STATE_ABI, functionName, args: values, blockNumber });
  const progress = (functionName, values = []) => read(release.progression, functionName, values);
  const names = ['collection','registry','trainingSource','REVIEW_DOMAIN','MAX_REVIEW_LIFETIME','allocationRoot',
    'snapshotHash','allocationChainId','baseSlots','slotCap'];
  const [codes, constants, currentOwner, credits, nonce, stateHash, slots, claimed, ownerCode] = await Promise.all([
    Promise.all(['collection','registry','progression','trainingSource'].map(name => client.getCode({ address: release[name], blockNumber }))),
    Promise.all(names.map(name => progress(name))), read(release.collection, 'ownerOf', args),
    progress('trainingCredits', args), progress('trainingReviewNonce', args), progress('trainingReviewStateHash', args),
    progress('unlockedSlots', args), progress('claimedStartingSlots', args), client.getCode({ address: owner, blockNumber }),
  ]);
  valid(codes.every((code, index) => typeof code === 'string' && code !== '0x'
    && keccak256(code) === release[`${['collection','registry','progression','trainingSource'][index]}CodeHash`])
    && equal(constants[0],release.collection) && equal(constants[1],release.registry) && equal(constants[2],release.trainingSource)
    && constants[3] === DOMAIN && constants[4] === 60n && constants[5] === release.allocationRoot
    && constants[6] === release.snapshotHash && constants[7] === BigInt(release.chainId) && constants[8] === 1 && constants[9] === 7
    && equal(currentOwner,owner) && (ownerCode === undefined || ownerCode === '0x')
    && uint(credits) && uint(nonce) && hash(stateHash)
    && Number.isInteger(slots) && slots >= 1 && slots <= 7 && Number.isInteger(claimed) && claimed >= 0 && claimed <= 3 && slots >= (claimed || 1));
  const equipped = await Promise.all(Array.from({ length: slots }, (_, slot) => progress('equipped', [...args,slot])));
  valid(equipped.every(key => /^0x[0-9a-f]{64}$/.test(key))
    && new Set(equipped.filter(key => key !== ZERO)).size === equipped.filter(key => key !== ZERO).length);
  const skills = await Promise.all(release.skills.map(async skill => {
    const [definition, available, level] = await Promise.all([
      read(release.registry,'definition',[skill.key]), read(release.registry,'available',[skill.key]), progress('learnedLevel',[...args,skill.key]),
    ]);
    valid(definition && typeof available === 'boolean' && Number.isInteger(level) && level >= 0 && level <= 1);
    return { ...skill, level, available: available && definition.status === 4 && definition.disabled === false && definition.deprecated === false
      && definition.manifestHash === skill.manifestHash && definition.instructionHash === skill.instructionHash };
  }));
  await assertTrainingOwnerContinuity({ client, release, owner, tokenId, anchor, now });
  return { owner, tokenId, anchor, credits: String(credits), nonce: String(nonce), stateHash, slots, claimed, equipped, skills };
}
