import {createPublicClient,http} from 'viem';
import {resolveRobinhoodRpcPair} from '../../../broker/src/infrastructure/robinhood-rpc-endpoints.mjs';

export function directedPaidHistoryClients(environment=process.env) {
 try {
  // Archive credentials are independent of the free worker's public relay
  // override. Existing private RPC settings remain valid defaults.
  const pair=resolveRobinhoodRpcPair({
   ROBINHOOD_RPC_URL:environment.ROBINHOOD_ARCHIVE_RPC_URL??environment.ROBINHOOD_RPC_URL??environment.RPC_URL??'https://rpc.mainnet.chain.robinhood.com',
   ROBINHOOD_SECONDARY_RPC_URL:environment.ROBINHOOD_ARCHIVE_SECONDARY_RPC_URL??environment.ROBINHOOD_SECONDARY_RPC_URL??'https://robinhood-rpc.publicnode.com',
  });
  return Object.values(pair).map(url=>createPublicClient({cacheTime:0,
   transport:http(url,{timeout:6000,retryCount:0,batch:{batchSize:20,wait:5}})}));
 }catch {throw Object.assign(Error('PAID_HISTORY_UNAVAILABLE'),{code:'PAID_HISTORY_UNAVAILABLE'});}
}
