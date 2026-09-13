import {COLLECTION_BUDGETS,withinCollectionBudget} from './v2-collection-discovery.mjs';

// Inventory hints and acquisition history are discovery inputs, not custody proof.
export async function verifyCollectionHoldings({ candidates, accounts, readOwner, readBalance, readDisplay,
  ownershipMs=COLLECTION_BUDGETS.ownershipMs,ownerReadMs=COLLECTION_BUDGETS.ownerReadMs,
  metadataMs=COLLECTION_BUDGETS.metadataMs,displayReadMs=COLLECTION_BUDGETS.displayReadMs,deadline=Infinity }) {
  const allowed = new Set(accounts.filter(Boolean).map(value => value.toLowerCase()));
  const unique = new Map();
  for (const item of candidates.slice(0,1024)) {
    if (!item || !/^0x[0-9a-f]{40}$/i.test(item.collection ?? '') || !/^\d{1,78}$/.test(String(item.tokenId))
      || BigInt(item.tokenId)>=(1n<<256n)
      || !allowed.has(String(item.custodyAccount).toLowerCase())) continue;
    const key = `${item.custodyAccount.toLowerCase()}:${item.collection.toLowerCase()}:${BigInt(item.tokenId)}`;
    if (!unique.has(key)) unique.set(key, item);
    else {
      const first=unique.get(key);
      // Keep receipt/acquisition identity and priority; reuse later advisory
      // artwork for that same custody/asset instead of fetching it again.
      if(item.artwork)unique.set(key,{...first,artwork:{...item.artwork,...first.artwork,
        name:first.artwork?.name??item.artwork.name,imageUrl:first.artwork?.imageUrl??item.artwork.imageUrl}});
    }
  }
  let unavailable = 0;
  const verified = [];
  const bounded = [...unique.values()].slice(0, 128);
  let cursor=0;
  const ownershipDeadline=Math.min(deadline,Date.now()+ownershipMs);
  await Promise.all(Array.from({length:Math.min(4,bounded.length)},async()=>{
    while(cursor<bounded.length&&Date.now()<ownershipDeadline){
      const index=cursor++,item=bounded[index];
      let amount = '1';
      try {
        if (item.standard === 'ERC1155') {
          amount = String(await withinCollectionBudget(()=>readBalance(item),Math.min(ownerReadMs,ownershipDeadline-Date.now())));
          if (BigInt(amount) <= 0n) continue;
        } else if ((await withinCollectionBudget(()=>readOwner(item),Math.min(ownerReadMs,ownershipDeadline-Date.now()))).toLowerCase()
          !== item.custodyAccount.toLowerCase()) continue;
      } catch { unavailable++; continue; }
      verified[index]={...item,amount,artwork:item.artwork??null,ownershipStatus:'LIVE_VERIFIED'};
    }
  }));
  unavailable+=bounded.length-cursor;
  const holdings=verified.filter(Boolean);
  // Metadata has a separate, smaller budget. It cannot delay later custody
  // checks or remove an NFT whose owner/balance was successfully verified.
  const displayDeadline=Math.min(deadline,Date.now()+metadataMs);
  const missing=holdings.map((item,index)=>({item,index})).filter(({item})=>!item.artwork?.name||!item.artwork?.imageUrl).slice(0,16);
  cursor=0;
  await Promise.all(Array.from({length:Math.min(4,missing.length)},async()=>{
    while(cursor<missing.length&&Date.now()<displayDeadline){
      const {item,index}=missing[cursor++];let artwork=item.artwork;
      if (!artwork?.name || !artwork?.imageUrl) {
        try {
          const display = await withinCollectionBudget(()=>readDisplay(item),Math.min(displayReadMs,displayDeadline-Date.now()));
          artwork = { ...display, ...artwork, name: artwork?.name ?? display?.name,
            imageUrl: artwork?.imageUrl ?? display?.imageUrl };
        } catch { /* A missing image must not hide a verified NFT. */ }
      }
      holdings[index]={...item,artwork:artwork??null};
    }
  }));
  return { holdings, ownershipChecksUnavailable: unavailable,
    metadataUnavailable:holdings.filter(item=>!item.artwork?.name||!item.artwork?.imageUrl).length,
    inventoryComplete: false, inventoryNote: 'Live-verified holdings from bounded discovery sources. Not a complete asset inventory or burn-safety proof.' };
}
