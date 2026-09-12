// Public chain reads only. No environment secrets, signer or transaction methods.
import { readFile } from 'node:fs/promises';
import { createPublicClient, http, keccak256 } from 'viem';

if (process.argv.length !== 3 || process.argv[2] !== '--live-readonly') {
  throw Error('Requires --live-readonly');
}
const root = new URL('../', import.meta.url);
const files = ['robinhood.json', 'robinhood-automation-v2.json',
  'robinhood-automation-v3.json', 'robinhood-punk-agent-account.json'];
const providers = ['https://robinhood-rpc.publicnode.com', 'https://rpc.mainnet.chain.robinhood.com'];
const clients = providers.map(url => createPublicClient({
  transport: http(url, { timeout: 15000, retryCount: 1 }), cacheTime: 0,
}));
let phase = 'CHAIN_ID';
try {
  const chains = await Promise.all(clients.map(client => client.getChainId()));
  if (chains.some(id => id !== 4663)) throw Error('CHAIN_MISMATCH');
  phase = 'ANCHOR';
  const height = await clients[0].getBlockNumber();
  const head = await clients[0].getBlock({ blockNumber: height - 12n });
  const anchor = { number: String(head.number), hash: head.hash, timestamp: Number(head.timestamp) };
  const independent = await clients[1].getBlock({ blockNumber: head.number });
  if (independent.hash !== head.hash) throw Error('PROVIDER_ANCHOR_MISMATCH');
  const contracts = [];
  for (const file of files) {
    const manifest = JSON.parse(await readFile(new URL(`deployments/${file}`, root), 'utf8'));
    if (manifest.status !== 'DEPLOYED') throw Error('MANIFEST_NOT_DEPLOYED');
    for (const [name, contract] of Object.entries(manifest.contracts)) {
      phase = `${file}:${name}`;
      if (!/^0x[0-9a-f]{40}$/i.test(contract?.address ?? '')
        || !/^0x[0-9a-f]{64}$/i.test(contract?.runtimeBytecodeHash ?? '')) throw Error('INVALID_CONTRACT_RECORD');
      const codes = await Promise.all(clients.map(client => client.getCode({ address: contract.address, blockNumber: head.number })));
      const hashes = codes.map(code => code && code !== '0x' ? keccak256(code) : null);
      const verified = hashes.every(hash => hash === contract.runtimeBytecodeHash.toLowerCase());
      contracts.push({ manifest: file, name, address: contract.address, status: verified ? 'DEPLOYED_CODE_VERIFIED' : 'CODE_MISMATCH',
        expectedRuntimeHash: contract.runtimeBytecodeHash, observedRuntimeHashes: hashes,
        recordedDeploymentTransaction: contract.deploymentTransaction });
    }
  }
  const forge = JSON.parse(await readFile(new URL('deployments/robinhood-skill-forge.json', root), 'utf8'));
  phase = 'COLLECTION_AND_CANONICAL_RECHECK';
  const collectionCodes = await Promise.all(clients.map(client => client.getCode({ address: forge.collection, blockNumber: head.number })));
  const collectionVerified = collectionCodes.every(code => code && keccak256(code) === forge.collectionCodeHash);
  const closing = await Promise.all(clients.map(client => client.getBlock({ blockNumber: head.number })));
  if (closing.some(block => block.hash !== head.hash)) throw Error('ANCHOR_CHANGED');
  const passed = collectionVerified && contracts.every(contract => contract.status === 'DEPLOYED_CODE_VERIFIED');
  console.log(JSON.stringify({ schemaVersion: 'GOGH_V2_CONTRACT_AUDIT_V1', status: passed ? 'PASS' : 'FAILED',
    observedAt: new Date().toISOString(), chainId: 4663, providers, anchor,
    collection: { address: forge.collection, runtimeHash: forge.collectionCodeHash, verified: collectionVerified },
    contracts, forge: { status: forge.status, registry: forge.registry, progression: forge.progression,
      trainingSource: forge.trainingSource, productionTrainingAuthorized: forge.productionTrainingAuthorized,
      productionBurnAuthorized: forge.productionBurnAuthorized }, publicTransactions: 0,
    limitations: 'Current runtime hashes checked against recorded manifests on two RPC endpoints at one canonical block. Deployment receipts and explorer source verification were not repeated; this is not an independent security audit.' }, null, 2));
  if (!passed) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ status: 'BLOCKED', phase, code: /^[A-Z_]+$/.test(error.message) ? error.message : 'CONTRACT_READ_UNAVAILABLE', errorType: error.name, publicTransactions: 0 }));
  process.exitCode = 1;
}
