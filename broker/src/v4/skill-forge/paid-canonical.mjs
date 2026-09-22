import artifact from '../../../../deployments/robinhood-paid-training.json' with {type:'json'};
import trainingArtifact from '../../../../deployments/robinhood-forge-training.json' with {type:'json'};
import { keccak256, stringToHex } from 'viem';
import { validatePaidRelease, assertPaidSkillCoverage, readPaidState } from './paid-training.mjs';
import { readReviewedTrainingState } from './training-state.mjs';
import { createProgressionReader } from './capability-resolver.mjs';

export const currentPaidCanonicalRelease=()=>assertPaidSkillCoverage(validatePaidRelease(artifact),trainingArtifact);
// Once a deployment exists it must remain configured while paused: disabling new
// purchases must never resurrect the legacy loadout or hide purchased skills.
export async function paidCanonicalState({client,release,owner,tokenId,now=Date.now,anchor,paidRelease=currentPaidCanonicalRelease()}) {
  if(paidRelease.status==='UNDEPLOYED')return null;
  if(paidRelease.collection!==release.collection || paidRelease.registry!==release.registry
    || paidRelease.legacyProgression!==(release.progression??release.legacyProgression))throw Error('PAID_CANONICAL_BINDING');
  // Access cannot fall back when a reader lacks permission or when RPC fails.
  return readPaidState({client,release:paidRelease,owner:owner.toLowerCase(),tokenId,now,anchor});
}
export async function readCanonicalTrainingState(options) {
  const legacy=await (options.legacyStateReader??readReviewedTrainingState)(options),paid=await paidCanonicalState({...options,anchor:legacy.anchor});
  if(!paid)return legacy;
  return {...legacy,slots:paid.unlockedSlots,equipped:paid.equipped,
    skills:legacy.skills.map(skill=>{
      const next=paid.skills.find(item=>item.key===skill.key);
      return next?{...skill,level:Math.max(skill.level,next.level),available:skill.available&&next.available}:skill;
    }),purchasedCredits:paid.purchasedCredits,paidActivated:paid.activated,
    // Research only: mutation coordinators retain the legacy on-chain hash.
    stateHash:keccak256(stringToHex(`${legacy.stateHash}:${paid.reviewStateHash}`))};
}
export function createCanonicalProgressionReader(options) {
  const readerFactory=options.readerFactory??createProgressionReader;
  const legacyReader=readerFactory(options);
  return async tokenId=>{
    const legacy=await legacyReader(tokenId);
    const paid=await paidCanonicalState({client:options.client,release:options,owner:legacy.owner,tokenId,
      paidRelease:options.paidRelease??currentPaidCanonicalRelease(),now:options.now??Date.now,
      anchor:{number:legacy.blockNumber,hash:legacy.blockHash,timestamp:String(legacy.blockTime/1000)}});
    if(!paid?.activated)return legacy;
    const config=options.paidRelease??currentPaidCanonicalRelease();
    return readerFactory({...options,progression:config.extension,progressionCodeHash:config.extensionCodeHash})(tokenId);
  };
}

// The immutable legacy contract cannot recognize purchased learning. The supported
// burn-credit API explicitly prevents duplicates and obsolete equipment actions.
export function guardLegacyPaidAction(action,paid) {
  if(!paid)return;
  if(paid.activated && ['equip','unequip'].includes(action.operation))throw Error('FORGE_USE_ACTIVE_LOADOUT');
  if(action.operation==='learn' && paid.skills.some(s=>s.key===action.skillKey && s.level>0))throw Error('FORGE_ALREADY_LEARNED');
  if(action.operation==='unlock' && paid.unlockedSlots>=7)throw Error('FORGE_TRAINING_SLOT_UNAVAILABLE');
}

export async function assertNoPaidBurnCredits(options) {
  const paid=await paidCanonicalState(options);
  if(paid && BigInt(paid.purchasedCredits)!==0n)throw Error('BURN_SOURCE_PURCHASED_CREDITS_REMAIN');
  return paid?{purchasedCredits:paid.purchasedCredits,paidReviewNonce:paid.reviewNonce}:null;
}
