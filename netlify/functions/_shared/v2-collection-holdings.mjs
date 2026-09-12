// Inventory hints and acquisition history are discovery inputs, not custody proof.
export async function verifyCollectionHoldings({ candidates, accounts, readOwner, readBalance, readDisplay }) {
  const allowed = new Set(accounts.filter(Boolean).map(value => value.toLowerCase()));
  const unique = new Map();
  for (const item of candidates) {
    if (!/^0x[0-9a-f]{40}$/i.test(item.collection ?? '') || !/^\d+$/.test(String(item.tokenId))
      || !allowed.has(String(item.custodyAccount).toLowerCase())) continue;
    const key = `${item.custodyAccount.toLowerCase()}:${item.collection.toLowerCase()}:${BigInt(item.tokenId)}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  let unavailable = 0;
  const holdings = [];
  const bounded = [...unique.values()].slice(0, 128);
  for (let offset = 0; offset < bounded.length; offset += 4) {
    const results = await Promise.all(bounded.slice(offset, offset + 4).map(async item => {
      let amount = '1';
      try {
        if (item.standard === 'ERC1155') {
          amount = String(await readBalance(item));
          if (BigInt(amount) <= 0n) return null;
        } else if ((await readOwner(item)).toLowerCase() !== item.custodyAccount.toLowerCase()) return null;
      } catch { unavailable++; return null; }
      let artwork = item.artwork;
      if (!artwork?.name || !artwork?.imageUrl) {
        try {
          const display = await readDisplay(item);
          artwork = { ...display, ...artwork, name: artwork?.name ?? display?.name,
            imageUrl: artwork?.imageUrl ?? display?.imageUrl };
        } catch { /* A missing image must not hide a verified NFT. */ }
      }
      return { ...item, amount, artwork: artwork ?? null, ownershipStatus: 'LIVE_VERIFIED' };
    }));
    holdings.push(...results.filter(Boolean));
  }
  return { holdings, ownershipChecksUnavailable: unavailable,
    inventoryComplete: false, inventoryNote: 'Live-verified holdings from bounded discovery sources. Not a complete asset inventory or burn-safety proof.' };
}
