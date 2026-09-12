import { trainingDigest } from './durable-training-review.mjs';

const ADDRESS = /^0x[0-9a-f]{40}$/, HASH = /^0x[0-9a-f]{64}$/;
const nonzero = value => typeof value === 'string' && !/^0x0+$/.test(value);
const address = value => ADDRESS.test(value) && nonzero(value);
const hash = value => HASH.test(value) && nonzero(value);
const KEYS = ['schema','status','chainId','collection','collectionCodeHash','registry','registryCodeHash',
  'progression','progressionCodeHash','trainingSource','trainingSourceCodeHash','allocationRoot','snapshotHash',
  'allowedOwners','skills','feeCeilingWei','productionTrainingAuthorized','productionBurnAuthorized'];
const valid = value => { if (!value) throw Error('FORGE_TRAINING_RELEASE_INVALID'); };

// Immutable release artifact supplied by the server, never an HTTP parameter or
// environment authority switch. A local fixture requires an explicit test option.
export function validateTrainingRelease(input, { localFixture = false } = {}) {
  valid(input && Object.getPrototypeOf(input) === Object.prototype
    && Reflect.ownKeys(input).length === KEYS.length
    && KEYS.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(input, key) ?? {}, 'value')));
  const value = JSON.parse(JSON.stringify(input));
  valid(value.schema === 'GOGH_FORGE_TRAINING_RELEASE_V1'
    && value.chainId === (localFixture ? 31337 : 4663) && address(value.collection)
    && (localFixture || value.collection === '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6')
    && ['UNDEPLOYED','OWNER_CANARY','PAUSED'].includes(value.status)
    && hash(value.collectionCodeHash) && hash(value.allocationRoot) && hash(value.snapshotHash)
    && value.productionBurnAuthorized === false
    && value.productionTrainingAuthorized === (value.status === 'OWNER_CANARY' && !localFixture)
    && typeof value.feeCeilingWei === 'string' && /^[1-9][0-9]{0,17}$/.test(value.feeCeilingWei)
    && BigInt(value.feeCeilingWei) <= 10n ** 17n
    && Array.isArray(value.allowedOwners) && value.allowedOwners.length <= 20
    && value.allowedOwners.every(address) && new Set(value.allowedOwners).size === value.allowedOwners.length
    && Array.isArray(value.skills) && value.skills.length <= 128);
  if (!localFixture) valid(value.allocationRoot === '0xf291febce8dc49ed133d39028f9b20061ea60c51d2e318096f122707dc558b97'
    && value.snapshotHash === '0x8a492f7dbb1ea8fe2ca51a134ffb6a9d4003bd6e9aa7cb87b121de43a40430de');
  for (const name of ['registry','progression','trainingSource']) {
    valid(value.status === 'UNDEPLOYED' ? value[name] === null && value[`${name}CodeHash`] === null
      : address(value[name]) && hash(value[`${name}CodeHash`]));
  }
  if (value.status === 'UNDEPLOYED') valid(value.allowedOwners.length === 0 && value.skills.length === 0);
  else valid((value.status==='PAUSED' || value.allowedOwners.length > 0)
    && new Set([value.collection,value.registry,value.progression,value.trainingSource]).size === 4);
  for (const skill of value.skills) valid(skill && Object.keys(skill).sort().join(',') === 'instructionHash,key,manifestHash,name'
    && hash(skill.key) && hash(skill.manifestHash) && hash(skill.instructionHash)
    && typeof skill.name === 'string' && skill.name.length >= 1 && skill.name.length <= 150);
  valid(new Set(value.skills.map(skill => skill.key)).size === value.skills.length);
  value.allowedOwners = Object.freeze(value.allowedOwners);
  value.skills = Object.freeze(value.skills.map(Object.freeze));
  return Object.freeze(value);
}

export function trainingDeploymentBinding(release) {
  if (!['OWNER_CANARY','PAUSED'].includes(release.status)) throw Error('FORGE_TRAINING_NOT_RELEASED');
  // Bind immutable deployment identity. Pausing, tightening a fee ceiling or
  // changing the canary owner list must not strand historic reconciliation jobs.
  // Registry definitions are immutable per skill key; each claim rechecks READY,
  // package pins and the CURRENT release allowlist before any wallet request.
  const canonical = Object.fromEntries(['schema','chainId','collection','collectionCodeHash','registry','registryCodeHash',
    'progression','progressionCodeHash','trainingSource','trainingSourceCodeHash','allocationRoot','snapshotHash'].map(key=>[key,release[key]]));
  return Object.freeze({ chainId: release.chainId, collection: release.collection, progression: release.progression,
    deploymentHash: `0x${trainingDigest(JSON.stringify(canonical))}` });
}
