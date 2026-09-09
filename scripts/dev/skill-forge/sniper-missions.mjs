// Presentation only. Never use this local preview model as execution authorization.
export function sniperMissionPreview({ learned = false, equipped = false } = {}) {
  return {
    canDispatch: false,
    canChoose: learned === true,
    equipmentNote: equipped === true ? 'Equipped locally. Economic authorization is still separate.' : 'Equip Sniper before dispatching any future mission.',
    options: [
      { id: 'mint-link', name: 'MINT LINK', description: 'Watch a specific mint and try within your confirmed price and time window.',
        requires: 'Reviewed mint executor, screening, simulation and current-owner authorization. Paid mints require paid-mint permission.',
        prompt: 'Watch this mint: [link]. On [chain], mint up to [quantity] at no more than [price + currency] each. Total spend including gas: [budget]. Gas cap: [gas cap]. Keep [reserve]. Start [time + timezone], stop [deadline + timezone]. Ask me to confirm the completed rules before dispatch.' },
      { id: 'floor-snipe', name: 'FLOOR SNIPE', description: 'Watch an approved collection’s listings and buy eligible NFTs at or below your target price.',
        requires: 'Reviewed marketplace purchase capability, valid current listing, screening, simulation and current-owner authorization. Link review alone grants no purchase authority.',
        prompt: 'Watch [collection contract] on [chain] and [marketplace]. Buy up to [quantity] eligible NFTs at or below [price + currency] each. Total spend including fees and gas: [budget]. Gas cap: [gas cap]. Keep [reserve]. Stop at [deadline + timezone]. Ask me to confirm the completed rules before dispatch.' },
    ],
  };
}
