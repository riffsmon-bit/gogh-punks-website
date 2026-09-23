export const FEATURE_HELP = Object.freeze({
  talk: {
    title: 'How to use Actions', anchor: 'actions',
    steps: ['Choose a free-mint mission, art preference and limits, then select Review my rules.',
      'Read the complete draft before confirming. Recommend only does not mint; automation needs a separate permission check.',
      'For an exact paid collection, choose Direct a paid mint and enter its contract address. For research, choose Check a link.'],
    cost: 'Choosing rules and checking links do not request payment. A mint costs its displayed price plus network fees. AI is disabled.',
  },
  strategy: {
    title: 'How to manage your strategy', anchor: 'strategy',
    steps: ['Read the saved art preferences, price limit, network-fee limit, collection limits and reserve.',
      'To change them, return to Actions, choose your options and review the full draft.',
      'An autonomous mission starts only after its account, permissions and limits pass the readiness check. Pause or recall stops new eligible work; submitted transactions still need confirmation.'],
    cost: 'Reviewing rules is free. Account activation, permission changes and transactions may require network fees shown by your wallet.',
  },
  fund: {
    title: 'How to fund or withdraw ETH', anchor: 'wallets',
    steps: ['Choose the Punk Wallet or Agent Account. They are different addresses; check the destination.',
      'Enter an amount, review the resulting balance and network fee, then confirm in your wallet.',
      'Use the displayed withdrawal control to return supported funds to your owner wallet. Wrapping ETH creates WETH; it does not place a bid.'],
    cost: 'Funding moves your chosen amount and uses network gas. Funding alone does not activate a mission.',
  },
  collection: {
    title: 'How to view and withdraw assets', anchor: 'collection',
    steps: ['Refresh the collection. If an NFT is missing, use its exact OpenSea item link to verify current ownership.',
      'Choose an NFT to review its withdrawal. For tokens, choose V3 Punk Wallet or Agent Account and enter the exact token contract.',
      'Inspect the balance, select an amount and review the fixed owner destination before wallet confirmation. If a result is lost, recover the original transaction.'],
    cost: 'Inspection does not transfer anything. Withdrawals use network gas. Unusual tokens may be unsupported; incomplete inventory does not mean an empty wallet.',
  },
  activity: {
    title: 'How to read mission activity', anchor: 'activity',
    steps: ['Check the current mission status, completed mints and last check.',
      'Read why an opportunity passed or was skipped. An active mission or funded budget is not proof of a delivered NFT.',
      'Open a confirmed transaction or your collection to check delivery. Recheck a pending result rather than submitting a duplicate.'],
    cost: 'Viewing activity does not spend funds. A submitted transaction may use gas even if it reverts.',
  },
  forge: {
    title: 'How skills and training work', anchor: 'forge',
    steps: ['Select Check Forge & loadout to verify your existing credits, learned skills and equipped slots.',
      'A learned skill stays with your Punk. Equip it in an unlocked slot to use its released capability; spending rules still apply.',
      'Public burning and purchasing credits are unavailable. Wallet inspection is optional information, not burn eligibility or authorization. Existing eligible training controls appear separately.'],
    cost: 'Viewing skills and wallet checks does not burn or charge ETH. Learning or equipping, where released, requires the displayed credit cost and network fee.',
  },
  settings: {
    title: 'How to manage access', anchor: 'settings',
    steps: ['Use Actions to review collecting rules; settings shows the available operating modes.',
      'Sign in with the current owner wallet. Changing wallets or transferring the Punk requires fresh authority checks.',
      'If you used the earlier owner burn release, its original receipt recovery is available here. It cannot start a new burn.'],
    cost: 'Viewing settings and recovering a receipt do not send funds. A new wallet transaction always shows its fee before confirmation.',
  },
});

export function mountFeatureHelp(document) {
  for (const [tab, help] of Object.entries(FEATURE_HELP)) {
    const panel = document.querySelector(`[data-v2-panel="${tab}"]`);
    if (!panel || panel.querySelector('[data-feature-help]')) continue;
    const make = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
    const details = make('details', ''); details.className = 'feature-help'; details.dataset.featureHelp = tab;
    details.append(make('summary', help.title));
    const list = make('ol', ''); for (const step of help.steps) list.append(make('li', step));
    const link = make('a', 'Full holder guide'); link.href = `/guide/#${help.anchor}`;
    details.append(list, make('p', help.cost), link);
    panel.querySelector('.panel-header')?.after(details);
  }
}
