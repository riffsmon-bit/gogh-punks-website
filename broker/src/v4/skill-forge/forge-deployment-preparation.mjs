import { keccak256 } from 'viem';
import { buildForgeDeploymentPlan, assertForgeRuntime } from './forge-deployment.mjs';

export async function prepareForgeDeployment({ clients, build, administrator, endpoints = [], localFixture = false, pins = null }) {
  if (clients.length !== (localFixture ? 1 : 2)) throw Error('FORGE_DEPLOYMENT_RPC_PAIR_REQUIRED');
  let phase = 'PUBLIC_CHAIN';
  try {
  const chains = await Promise.all(clients.map(client => client.getChainId()));
  if (chains.some(chain => chain !== (localFixture ? 31337 : 4663))) throw Error('FORGE_DEPLOYMENT_WRONG_CHAIN');
  const heads = await Promise.all(clients.map(client => client.getBlock({ blockTag: 'latest' })));
  const head = heads.reduce((a, b) => a.number < b.number ? a : b);
  const anchor = { number: String(head.number), hash: head.hash, timestamp: Number(head.timestamp) };
  if (Math.abs(Date.now() / 1000 - anchor.timestamp) > 60) throw Error('STALE_FORGE_DEPLOYMENT_HEAD');
  const nonces = await Promise.all(clients.flatMap(client => ['pending', 'latest'].map(blockTag => client.getTransactionCount({ address: administrator, blockTag }))));
  if (!nonces.every(nonce => Number.isSafeInteger(nonce) && nonce >= 0 && nonce === nonces[0])) throw Error('FORGE_DEPLOYMENT_NONCE_UNRESOLVED');
  let plan = buildForgeDeploymentPlan({ build, administrator, localFixture, chainId: localFixture ? 31337 : 4663, ...(pins ? { pins } : {}), nonce: String(nonces[0]), anchor });
  const observations = [];
  phase = 'COLLECTION_ADMINISTRATOR_AND_SIMULATION';
  for (const [index, client] of clients.entries()) {
    phase = `ANCHOR_${index}`;
    const canonical = await client.getBlock({ blockNumber: head.number });
    if (canonical.hash !== head.hash) throw Error('FORGE_DEPLOYMENT_PROVIDERS_DISAGREE');
    phase = `COLLECTION_${index}`;
    const collection = await client.getCode({ address: plan.pins.collection, blockNumber: head.number });
    if (!collection || keccak256(collection) !== plan.pins.collectionCodeHash) throw Error('FORGE_COLLECTION_CHANGED');
    phase = `ADMINISTRATOR_${index}`;
    const adminCode = await client.getCode({ address: administrator, blockNumber: head.number }) ?? '0x';
    if (adminCode !== '0x' && !/^0xef0100[0-9a-f]{40}$/i.test(adminCode)) throw Error('FORGE_ADMINISTRATOR_CANNOT_ORIGINATE');
    const delegation = adminCode === '0x' ? null : `0x${adminCode.slice(8)}`;
    const delegateCode = delegation ? await client.getCode({ address: delegation, blockNumber: head.number }) : null;
    if (delegation && (!delegateCode || delegateCode === '0x' || /^0xef0100/i.test(delegateCode))) throw Error('FORGE_ADMINISTRATOR_DELEGATE_UNAVAILABLE');
    phase = `PREDICTED_ADDRESSES_${index}`;
    for (const address of Object.values(plan.addresses)) {
      const existing = await client.getCode({ address, blockNumber: head.number });
      if (existing && existing !== '0x') throw Error('FORGE_PREDICTED_ADDRESS_OCCUPIED');
    }
    const call = { account: administrator, data: plan.transactions[0].data, value: 0n };
    phase = `SIMULATION_${index}`;
    const result = await client.call({ ...call, blockNumber: head.number });
    assertForgeRuntime(build.artifacts.deployment, result.data, [plan.addresses.registry, plan.addresses.progression, plan.addresses.trainingSource]);
    phase = `ESTIMATE_AND_BALANCE_${index}`;
    observations.push({ administratorCodeHash: keccak256(adminCode), delegation, delegationCodeHash: delegateCode ? keccak256(delegateCode) : null,
      deploymentGasEstimate: String(await client.estimateGas(call)), observedGasPriceWei: String(await client.getGasPrice()),
      administratorBalanceWei: String(await client.getBalance({ address: administrator, blockNumber: head.number })) });
  }
  if (observations.some(o => ['administratorCodeHash', 'delegation', 'delegationCodeHash'].some(key => o[key] !== observations[0][key]))) throw Error('FORGE_ADMINISTRATOR_PROVIDERS_DISAGREE');
  const gas = observations.reduce((max, o) => BigInt(o.deploymentGasEstimate) > max ? BigInt(o.deploymentGasEstimate) : max, 0n);
  const price = observations.reduce((max, o) => BigInt(o.observedGasPriceWei) > max ? BigInt(o.observedGasPriceWei) : max, 0n);
  plan = buildForgeDeploymentPlan({ build, administrator, localFixture, chainId: localFixture ? 31337 : 4663, ...(pins ? { pins } : {}), nonce: String(nonces[0]), anchor,
    gasLimits: [String((gas * 3n + 1n) / 2n), '100000'], maxFeePerGas: String(price * 2n) });
  if (observations.some(o => BigInt(o.administratorBalanceWei) < BigInt(plan.maximumTotalFeeWei))) throw Error('FORGE_DEPLOYMENT_GAS_UNFUNDED');
  phase = 'CLOSING_RECHECK';
  for (const client of clients) {
    if ((await client.getBlock({ blockNumber: head.number })).hash !== head.hash
      || await client.getTransactionCount({ address: administrator, blockTag: 'pending' }) !== nonces[0]
      || await client.getTransactionCount({ address: administrator, blockTag: 'latest' }) !== nonces[0]) throw Error('FORGE_DEPLOYMENT_CONTEXT_CHANGED');
  }
  if (Date.now() / 1000 > plan.expiresAt) throw Error('FORGE_DEPLOYMENT_PLAN_EXPIRED');
  return { status: 'PREPARED_PAUSED_FORGE_DEPLOYMENT', observedAt: new Date().toISOString(), endpoints, plan,
    buildPins: build.pins, observations, ownerSignatureRequired: true, publicTransactions: 0,
    acceptanceGasLimitIsReservedNotPubliclySimulated: true,
    note: 'Recheck nonce, code, simulation and fees before each wallet request. The second transaction can only be simulated after deployment. This packet expires; it does not enable training or burns.' };
  } catch (error) { error.forgePhase = phase; throw error; }
}
