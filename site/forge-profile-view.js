const HASH = /^0x[0-9a-f]{64}$/i, ADDRESS = /^0x[0-9a-f]{40}$/i;
const STATES = ['DISCOVERED', 'UNDER_REVIEW', 'ADAPTING', 'TESTING', 'READY', 'BLOCKED', 'REJECTED'];
const invalid = () => { throw Error('Permanent Forge state could not be verified.'); };

// Display validation is additional defense, never economic authority or contract verification.
export function validateForgeProfile(profile, selected, now = Date.now()) {
  if (!profile || profile.ownership !== 'ORIGINAL_NFT' || profile.slotCap !== 7
    || profile.walletAuthority !== 'NONE' || profile.canLearn !== false || profile.canEquip !== false
    || profile.canBurn !== false || !Array.isArray(profile.effectiveMcpTools) || profile.effectiveMcpTools.length) invalid();
  if (profile.status === 'NOT_DEPLOYED') {
    if (profile.verified !== false || ['trainingCredits', 'learnedSkills', 'equippedSkills', 'unlockedSlots', 'claimedStartingSlots']
      .some(field => profile[field] !== null)) invalid();
    return profile;
  }
  if (profile.status !== 'VERIFIED_READ_ONLY' || profile.verified !== true
    || profile.tokenId !== selected.tokenId || !ADDRESS.test(profile.owner)
    || profile.owner.toLowerCase() !== selected.owner?.toLowerCase()
    || profile.collection?.toLowerCase() !== '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6'
    || !ADDRESS.test(profile.registry) || !ADDRESS.test(profile.progression)
    || !HASH.test(profile.blockHash) || !/^\d+$/.test(profile.blockNumber)
    || !Number.isSafeInteger(profile.blockTime) || profile.blockTime > now || now - profile.blockTime > 30_000
    || !/^(0|[1-9]\d{0,77})$/.test(profile.trainingCredits)
    || !Number.isInteger(profile.unlockedSlots) || profile.unlockedSlots < 1 || profile.unlockedSlots > 7
    || !Number.isInteger(profile.claimedStartingSlots) || profile.claimedStartingSlots < 0 || profile.claimedStartingSlots > 3
    || profile.unlockedSlots < (profile.claimedStartingSlots || 1)
    || !Array.isArray(profile.learnedSkills) || profile.learnedSkills.length > 128 || !Array.isArray(profile.equippedSkills)) invalid();
  const learned = new Map(), slots = new Set(), equipped = new Set();
  for (const skill of profile.learnedSkills) {
    if (!HASH.test(skill.key) || /^0x0{64}$/i.test(skill.key) || learned.has(skill.key)
      || !Number.isInteger(skill.level) || skill.level < 1 || skill.level > 255
      || !Number.isInteger(skill.skillId) || skill.skillId < 1 || !Number.isInteger(skill.version) || skill.version < 1
      || typeof skill.name !== 'string' || !skill.name.length || skill.name.length > 150
      || !STATES.includes(skill.status) || typeof skill.available !== 'boolean'
      || typeof skill.disabled !== 'boolean' || typeof skill.deprecated !== 'boolean'
      || typeof skill.packageVerified !== 'boolean' || !HASH.test(skill.manifestHash) || !HASH.test(skill.instructionHash)) invalid();
    learned.set(skill.key, skill);
  }
  for (const item of profile.equippedSkills) {
    if (!Number.isInteger(item.slot) || item.slot < 0 || item.slot >= profile.unlockedSlots || slots.has(item.slot)
      || equipped.has(item.key) || !learned.has(item.key) || learned.get(item.key).level !== item.level) invalid();
    slots.add(item.slot); equipped.add(item.key);
  }
  return profile;
}

export function forgeSlotView(profile) {
  return Array.from({ length: 7 }, (_, slot) => {
    if (!profile?.verified) return { slot, state: 'UNKNOWN', title: '—', detail: 'NOT VERIFIED', skill: null };
    if (slot >= profile.unlockedSlots) return { slot, state: 'LOCKED', title: 'LOCKED', detail: 'Slot not unlocked', skill: null };
    const item = profile.equippedSkills.find(s => s.slot === slot);
    if (!item) return { slot, state: 'EMPTY', title: '+', detail: 'Empty slot', skill: null };
    const skill = profile.learnedSkills.find(s => s.key === item.key);
    return { slot, state: 'EQUIPPED', title: skill.name, skill,
      detail: `Level ${skill.level} · ${!skill.available || skill.disabled || skill.deprecated ? 'DISABLED' : skill.packageVerified ? 'EQUIPPED' : 'UNREVIEWED PACKAGE'}` };
  });
}
