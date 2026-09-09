// Display assets only: this allowlist grants no skill or execution capability.
export const SKILL_ICON_SLUGS = Object.freeze(["contract-detective","rarity-eye","market-scout","sniper","mint-hunter","scheduled-hunter","art-curator","social-scout","paid-mint-license","collection-researcher","listing-watcher","portfolio-curator","whitelist-scout"]);
export function skillIconUrl(name) {
  const slug = String(name ?? '').toLowerCase().replaceAll(' ', '-');
  return SKILL_ICON_SLUGS.includes(slug) ? `/assets/skill-forge/v1/${slug}.png` : null;
}
