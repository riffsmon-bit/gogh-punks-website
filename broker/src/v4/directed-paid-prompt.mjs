import {parseEther} from 'viem';
import {acquisitionRequest} from './acquisition-request.mjs';
// Deterministic draft only. No prompt/AI output can authorize a transaction.
export function directedPaidPrompt(message,{release,owner,tokenId}){
 const text=String(message).trim();
 const publicMode=release?.publicOwnerMint?.enabled===true&&release.publicOwnerMint.status==='LIVE'&&release.publicOwnerMint.execution==='CURRENT_OWNER_ATOMIC_WALLET'&&/^0x[0-9a-f]{40}$/i.test(owner??'')&&/^[1-9][0-9]{0,3}$/.test(String(tokenId))&&Number(tokenId)<=5016&&!/\bexisting worker canary\b/i.test(text);
 if(!publicMode&&(release?.status!=='OWNER_CANARY'||release.productionPaidMintAuthorized!==true||release.owner!==owner?.toLowerCase()||String(tokenId)!=='93'))return null;
 if(/^(?:what|how|why|can|could|would|explain|tell me about|do not|don't|never|stop|cancel)\b/i.test(text)
  ||/\b(?:do not|don't|never)\s+(?:pay|mint|spend)\b/i.test(text))return null;
 const ambiguousBudget=/\bmints?\b/i.test(text)&&/\bbudget\b.*\b(?:ETH|ether)\b/i.test(text)&&!/\bfree\b/i.test(text);
 if(acquisitionRequest(text)?.kind!=='PAID_MINT'&&!ambiguousBudget)return null;
 const clarify=reply=>({responseKind:'CLARIFICATION_REQUIRED',draft:null,reply,provider:{provider:'DIRECTED_PAID_REVIEW'},providerAvailable:true});
 if(/\b(?:free|unlimited|no limit|all|sweep|bids?|offers?)\b/i.test(text))return clarify('Request one supported paid mint with a maximum mint price in ETH. Free mints keep their separate mission rules.');
 const quantities=[...text.matchAll(/\b(?:mint|collect)\s+(\d+|one|two|three|four|five|a|an)\b|\b(\d+|one|two|three|four|five)\s+(?:nfts?|tokens?|paid mints?|mints?)\b/gi)].map(m=>(m[1]??m[2]).toLowerCase());
 if(quantities.some(v=>!['1','one','a','an'].includes(v)))return clarify('This paid-mint action supports exactly one NFT per wallet confirmation.');
 const addresses=[...new Set([...text.matchAll(/\b0x[a-z0-9]+\b/gi)].map(m=>m[0].toLowerCase()))];
 if(!addresses.length&&/\bPeppies World\b/i.test(text))addresses.push(release.targetCollection);
 if(addresses.length!==1||!/^0x[0-9a-f]{40}$/.test(addresses[0])||!publicMode&&addresses[0]!==release.targetCollection)
  return clarify(`The supported paid-mint collection is Peppies World. Use its Robinhood Chain contract ${release.targetCollection} in the request.`);
 const amounts=[...text.matchAll(/(?:\d+(?:\.\d+)?|\.\d+)\s*(?:ETH|ether)\b/gi)];
 if(amounts.length>1||/\b(?:total|including gas|including fees|budget|gas|reserve)\b/i.test(text))
  return clarify(publicMode?'State one maximum mint price, for example: Mint one NFT from Peppies World for up to 0.0001 ETH. Your connected wallet pays the exact price plus network gas.':'State one maximum mint price, for example: Mint one NFT from Peppies World for up to 0.0001 ETH. The review will separately show the worker fee and wallet gas.');
 let maximumPriceWei=null;
 if(amounts.length){try{const decimal=amounts[0][0].replace(/\s*(?:ETH|ether)$/i,'').replace(/^\./,'0.');
   if((decimal.split('.')[1]?.length??0)>18)throw Error('PRECISION');maximumPriceWei=String(parseEther(decimal));}catch{return clarify('Use an ETH mint price with no more than 18 decimal places.');}
  if(BigInt(maximumPriceWei)<=0n||BigInt(maximumPriceWei)>BigInt(release.maximumPriceWei))return clarify('Choose a paid mint price above zero and at most 0.001 ETH for this supported mint.');}
 return {responseKind:publicMode?'PUBLIC_PAID_MINT_REVIEW':'PAID_MINT_REVIEW',draft:null,paidDraft:{collection:publicMode?addresses[0]:release.targetCollection,quantity:1,maximumPriceWei},
  reply:publicMode?`Check the collection contract below for one mint into Punk #${tokenId}’s Agent wallet below. Your connected wallet pays the exact price plus network gas, with no worker fee. Only compatible reviewed SeaDrop Studio contracts can proceed. Confirm a supported live mint once in your wallet; this does not activate autonomous spending.`:'I can mint one Peppies World NFT into #93’s Agent wallet. Review the live price, fixed worker fee and expiry below. One wallet budget confirmation lets the worker finish the mint and verify delivery.',
  provider:{provider:'DIRECTED_PAID_REVIEW'},providerAvailable:true};
}
