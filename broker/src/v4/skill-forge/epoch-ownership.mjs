import { getAddress, keccak256, parseAbi } from 'viem';

const HASH = /^0x[0-9a-f]{64}$/i;
const ZERO = `0x${'0'.repeat(40)}`;
const abi = parseAbi([
  'function COLLECTION() view returns (address)', 'function CHAIN_ID() view returns (uint256)',
  'function epochs() view returns (address)', 'function wrapper() view returns (address)',
  'function ownerOf(uint256) view returns (address)', 'function resolveOwner(uint256) view returns (address)',
  'function isWrapped(uint256) view returns (bool)', 'function epoch(uint256) view returns (uint256)',
  'function securityGeneration() view returns (uint256)', 'function executionPaused() view returns (bool)',
]);

// Server deployment configuration only. Never infer trusted wrappers from wallet/AI requests.
export function validateEpochPins(config) {
  if (!config || !HASH.test(config.wrapperCodeHash) || !HASH.test(config.epochsCodeHash)) {
    throw new Error('EPOCH_DEPLOYMENT_PINS_REQUIRED');
  }
  return Object.freeze({ ...config, wrapper: getAddress(config.wrapper), epochs: getAddress(config.epochs) });
}

export async function readEpochOwnership({ client, blockNumber, chainId, collection, progression, tokenId, config }) {
  config = validateEpochPins(config);
  const read = (address, functionName, args = []) => client.readContract({ address, abi, functionName, args, blockNumber });
  const [wrapperCode, epochsCode, original, boundEpochs, boundWrapper, progressionWrapper, wrapperChain] = await Promise.all([
    client.getCode({ address: config.wrapper, blockNumber }), client.getCode({ address: config.epochs, blockNumber }),
    read(config.wrapper, 'COLLECTION'), read(config.wrapper, 'epochs'), read(config.epochs, 'wrapper'),
    read(progression, 'wrapper'), read(config.wrapper, 'CHAIN_ID'),
  ]);
  if (keccak256(wrapperCode ?? '0x') !== config.wrapperCodeHash || keccak256(epochsCode ?? '0x') !== config.epochsCodeHash
    || getAddress(original) !== getAddress(collection) || getAddress(boundEpochs) !== config.epochs
    || getAddress(boundWrapper) !== config.wrapper || getAddress(progressionWrapper) !== config.wrapper
    || wrapperChain !== BigInt(chainId)) throw new Error('EPOCH_DEPLOYMENT_MISMATCH');
  const [owner, originalOwner, wrapped, epoch, generation, paused] = await Promise.all([
    read(config.wrapper, 'resolveOwner', [BigInt(tokenId)]), read(collection, 'ownerOf', [BigInt(tokenId)]),
    read(config.wrapper, 'isWrapped', [BigInt(tokenId)]), read(config.epochs, 'epoch', [BigInt(tokenId)]),
    read(config.epochs, 'securityGeneration'), read(config.epochs, 'executionPaused'),
  ]);
  if (getAddress(owner) === ZERO || typeof epoch !== 'bigint' || epoch < 0n || typeof generation !== 'bigint'
    || generation < 0n || typeof wrapped !== 'boolean' || typeof paused !== 'boolean') throw new Error('INVALID_EPOCH_STATE');
  if (wrapped) {
    const receiptOwner = await read(config.wrapper, 'ownerOf', [BigInt(tokenId)]);
    if (getAddress(originalOwner) !== config.wrapper || getAddress(receiptOwner) !== getAddress(owner) || epoch === 0n) {
      throw new Error('EPOCH_CUSTODY_MISMATCH');
    }
  } else if (getAddress(originalOwner) === config.wrapper || getAddress(originalOwner) !== getAddress(owner)) {
    throw new Error('EPOCH_CUSTODY_MISMATCH');
  }
  return Object.freeze({ owner: getAddress(owner), authorityModel: 'GOGH_WRAPPED_EPOCH_V1',
    authorityEpoch: `${config.wrapper}:${epoch}:${generation}`, wrapped, executionPaused: paused,
    epoch: String(epoch), securityGeneration: String(generation) });
}
