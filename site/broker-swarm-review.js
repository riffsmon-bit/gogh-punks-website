// Local settings review only. No authentication, wallet provider or network calls.
export function createSwarmReviewGate({ dialog, getContext, isOwned }) {
  const grid = dialog.querySelector('[data-swarm-review-grid]');
  let pending = null;
  const current = request => {
    const context = getContext();
    return context?.owner?.toLowerCase() === request.owner && context.chainId === 4663 && isOwned(request.tokenId);
  };
  function finish(accepted) {
    const request = pending;
    if (!request) return;
    pending = null;
    if (dialog.open) dialog.close();
    request.resolve(accepted && current(request));
  }
  dialog.addEventListener('close', () => finish(false));
  dialog.addEventListener('cancel', () => finish(false));
  dialog.querySelector('[data-swarm-review-cancel]').addEventListener('click', () => finish(false));
  dialog.querySelector('[data-swarm-review-continue]').addEventListener('click', () => finish(true));
  return {
    invalidate: () => finish(false),
    refresh: () => { if (pending && !current(pending)) finish(false); },
    review({ tokenId, options }) {
      if (pending || dialog.open) throw Error('Close the current Swarm review first.');
      const owner = getContext()?.owner?.toLowerCase();
      if (!owner || !current({ owner, tokenId })) throw Error('Reconnect the current owner on Robinhood Chain.');
      grid.replaceChildren();
      const rows = [
        ['Punk', `#${tokenId}`], ['Mint price', 'FREE ONLY'],
        ['Collection', options.mode === 'DIRECTED' ? options.target : 'Search supported collections'],
        ['Daily limit', `${options.daily} per Punk`], ['Total limit', `${options.total} per Punk`],
        ['Duration', options.duration === 'KEEP_HUNTING' ? 'Up to 100 mints / 30 days' : 'Stop at the mission total'],
        ['Funding', 'Separate review and wallet confirmation'], ['Status', 'Not authorized'],
      ];
      for (const [label, value] of rows) {
        const cell = dialog.ownerDocument.createElement('div');
        const title = dialog.ownerDocument.createElement('span'); title.textContent = label;
        const content = dialog.ownerDocument.createElement('b'); content.textContent = value;
        cell.append(title, content); grid.append(cell);
      }
      return new Promise(resolve => {
        pending = { owner, tokenId, resolve };
        try { dialog.showModal(); } catch (error) { pending = null; throw error; }
      });
    },
  };
}
