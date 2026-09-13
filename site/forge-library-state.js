// Display only. A label never enables a tool or a training transaction.
export function forgeLibraryState(skill, profile, release, selected) {
  const learned = profile?.verified && profile.learnedSkills?.find(item => item.slug === skill.id && item.packageVerified);
  if (learned) {
    const equipped = profile.equippedSkills.some(item => item.key === learned.key);
    const paused = !learned.available || learned.disabled || learned.deprecated;
    return `${equipped ? 'EQUIPPED' : 'LEARNED'}${paused ? ' · PAUSED' : ''}`;
  }
  const released = release?.status === 'OWNER_CANARY' && selected?.chainId === 4663 && !selected.preview
    && release.allowedOwners.includes(selected.owner?.toLowerCase())
    && release.skills.some(item => item.name === skill.name);
  return released ? 'TRAINING RELEASED' : skill.status.replaceAll('_', ' ');
}
