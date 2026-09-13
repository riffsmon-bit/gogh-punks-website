import {directedPaidRuntime} from './directed-paid-runtime.mjs';
import {readDirectedPaidHistory} from '../../../broker/src/v4/directed-paid-history.mjs';
import release from '../../../deployments/robinhood-directed-paid-mint.json' with {type:'json'};
export async function selectedPaidHistory(tokenId,owner){
 if(release.status!=='OWNER_CANARY'||String(tokenId)!=='93'||owner.toLowerCase()!==release.owner)return {activity:[],candidates:[],available:true};
 try{const runtime=await directedPaidRuntime('request');return {...await readDirectedPaidHistory(runtime.store.pool,runtime.release),available:true};}
 catch{return {activity:[],candidates:[],available:false};}
}
