export const FEATURE_HELP = Object.freeze({
  talk: {
    title: 'How to use Actions', anchor: 'actions',
    steps: ['Choose a free-mint mission, art preference and limits, then select Review my rules.',
      'Read the complete draft before confirming. Recommend only does not mint; automation needs a separate permission check.',
      'For an exact paid collection, choose Direct a paid mint and enter its contract address. For research, choose Check a link.',
      'Open Swarm to plan for multiple owned Punks. The separate Swarm Wallet instructions explain your optional shared funding budget.'],
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
      'Public burning is unavailable. Paid credits cost 0.0005 ETH plus gas and are limited to the approved owner test. Refresh an unsent review if it expires. Wallet inspection is information, not burn authorization.'],
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

export const SWARM_WALLET_HELP = Object.freeze({
  title: 'How to use your Swarm Wallet',
  availability: 'The Swarm Wallet is an optional funding route. Its controls appear when the reviewed release is available to your wallet.',
  steps: [
    'Connect your holder wallet on Robinhood Chain. Open Swarm Wallet above the selected Punk controls and choose Check Swarm Wallet, then review and confirm wallet creation if you do not have one yet.',
    'Add the ETH budget you want to keep in this wallet. Review the destination and amount, then confirm the deposit in your connected wallet.',
    'Complete account activation for each Punk you want to fund. Only your currently owned Punks with activated Agent Accounts can receive a batch.',
    'Select 1–10 Punks and enter a total ETH amount. The review lists Punks in number order and splits the total equally; any smallest-unit remainder goes to lower Punk numbers. The limit is 1 ETH per Punk and 10 ETH per batch.',
    'Choose Review gas batch. Check each Punk, destination, amount, total and network fee. Confirm in wallet to approve this batch only. All transfers in the batch succeed together, or none do.',
    'For missions, open Swarm · multiple Punks in Actions, then review and authorize each Punk separately. Creating or funding a wallet does not start a mission or grant minting permission.',
    'To take back unused ETH, choose Review withdrawal and confirm in wallet. This returns only ETH still in your Swarm Wallet, only to its owner wallet.',
  ],
  costs: 'Your connected wallet pays the network fee for creation, deposits, batches and withdrawals. Keep ETH there for gas; the Swarm Wallet balance is your funding budget. There are no automatic refills.',
  ownership: 'Once allocated, ETH stays in the selected Punk’s Agent Account and follows that Punk’s ownership if it is transferred. A Swarm Wallet withdrawal does not pull those funds back. Unallocated ETH stays under the Swarm Wallet owner’s control.',
  alternative: 'You can still use the individual funding planner. That route reviews and confirms each Punk’s deposit separately; it does not use your Swarm Wallet balance.',
  recovery: 'If a transaction is pending or its result is unknown, use Check transaction with the original, speed-up or cancellation hash from wallet activity. Do not submit the same action again.',
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
  const swarm = document.querySelector('[data-swarm-wallet-details]');
  if (swarm && !swarm.querySelector('[data-swarm-wallet-help]')) {
    const make = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
    const details = make('details', ''); details.className = 'feature-help'; details.dataset.swarmWalletHelp = '';
    details.append(make('summary', SWARM_WALLET_HELP.title), make('p', SWARM_WALLET_HELP.availability));
    const list = make('ol', '');
    for (const step of SWARM_WALLET_HELP.steps) list.append(make('li', step));
    details.append(list, ...['costs', 'ownership', 'alternative', 'recovery'].map(key => make('p', SWARM_WALLET_HELP[key])));
    swarm.append(details);
  }
}
