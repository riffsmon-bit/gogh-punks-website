import { keccak256Hex } from './keccak256.js';

const valid = value => { if (!value) throw Error('DEPLOYMENT_WALLET_REVIEW_CHANGED'); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const hex = value => `0x${BigInt(value).toString(16)}`;
const word = value => BigInt(value).toString(16).padStart(64, '0');
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}` : JSON.stringify(value);
const digest = async value => `0x${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value)))), b => b.toString(16).padStart(2, '0')).join('')}`;
function createAddress(from, nonce) {
  let encoded = BigInt(nonce) === 0n ? '' : BigInt(nonce).toString(16);
  if (encoded.length % 2) encoded = `0${encoded}`;
  if (encoded.length !== 2 || BigInt(`0x${encoded || '0'}`) >= 128n) encoded = `${(128 + encoded.length / 2).toString(16)}${encoded}`;
  const payload = `94${from.slice(2).toLowerCase()}${encoded}`;
  return `0x${keccak256Hex(`0x${(192 + payload.length / 2).toString(16)}${payload}`).slice(-40)}`;
}

export async function validateDeploymentWalletReview({ state, config, index, now = Date.now() }) {
  const plan = state.packet?.plan;
  valid(plan && [0, 1].includes(index) && plan.chainId === config.chainId && plan.localFixture === config.localFixture
    && same(plan.administrator, config.administrator) && plan.buildHash === config.buildHash && plan.transactions.length === 2
    && ['collection', 'collectionCodeHash', 'allocationRoot', 'snapshotHash'].every(key => same(plan.pins[key], config.pins[key]))
    && plan.productionTrainingAuthorized === false && plan.productionBurnAuthorized === false);
  const { planHash, ...body } = plan; valid(await digest(body) === planHash);
  valid(same(createAddress(plan.administrator, plan.transactions[0].nonce), plan.addresses.deployment));
  for (const [role, nonce] of [['registry', 1], ['trainingSource', 2], ['progression', 3]])
    valid(same(createAddress(plan.addresses.deployment, nonce), plan.addresses[role]));
  const constructor = [plan.chainId, plan.pins.collection, plan.pins.collectionCodeHash, plan.administrator, plan.pins.allocationRoot, plan.pins.snapshotHash].map(word).join('');
  const data = plan.transactions[0].data;
  valid(data.endsWith(constructor) && keccak256Hex(data.slice(0, -constructor.length)) === config.creationCodeHash
    && plan.transactions[0].to === null && plan.transactions[0].label === 'DEPLOY_PAUSED_FORGE');
  let tx = plan.transactions[index], gas = plan.gasLimits[index], fee = plan.maxFeePerGas, expires = plan.expiresAt, anchor = plan.anchor;
  const review = state.steps[1].review;
  if (index === 1) {
    valid(review && state.steps[0].status === 'INCLUDED');
    const { reviewHash, ...reviewBody } = review;
    valid(await digest(reviewBody) === reviewHash && review.planHash === plan.planHash);
    tx = review.transaction; gas = review.gasLimit; fee = review.maxFeePerGas; expires = review.expiresAt; anchor = review.anchor;
    valid(tx.data === '0x79ba5097' && same(tx.to, plan.addresses.registry) && tx.label === 'ACCEPT_REGISTRY_OWNERSHIP'
      && BigInt(tx.nonce) > BigInt(plan.transactions[0].nonce));
  }
  valid(same(tx.from, config.administrator) && tx.chainId === config.chainId && tx.value === '0'
    && BigInt(gas) > 0n && BigInt(gas) <= (index === 0 ? 8000000n : 100000n)
    && BigInt(fee) > 0n && BigInt(fee) <= 10000000000n && expires * 1000 > now + 15000
    && anchor.timestamp * 1000 <= now + 5000 && expires === anchor.timestamp + 600);
  return { from: tx.from, ...(tx.to ? { to: tx.to } : {}), data: tx.data, value: '0x0', chainId: hex(config.chainId),
    type: '0x2', nonce: hex(tx.nonce), gas: hex(gas), maxFeePerGas: hex(fee), maxPriorityFeePerGas: '0x0' };
}

export function createDeploymentWallet({ provider, claim, markAttempted, isAttempted, isCurrent }) {
  let busy = false;
  return { async submit({ state, config, index }) {
    valid(!busy && isCurrent()); busy = true;
    try {
      const fixed = structuredClone(state), step = fixed.steps[index];
      const reviewHash = index === 0 ? fixed.packet.plan.planHash : fixed.steps[1].review.reviewHash;
      valid(step.status === 'READY' && !isAttempted(reviewHash));
      const transaction = await validateDeploymentWalletReview({ state: fixed, config, index });
      const context = async () => {
        const [chain, accounts, pending, latest] = await Promise.all([
          provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' }),
          provider.request({ method: 'eth_getTransactionCount', params: [transaction.from, 'pending'] }),
          provider.request({ method: 'eth_getTransactionCount', params: [transaction.from, 'latest'] }),
        ]);
        valid(BigInt(chain) === BigInt(config.chainId) && same(accounts?.[0], config.administrator)
          && BigInt(pending) === BigInt(transaction.nonce) && BigInt(latest) === BigInt(transaction.nonce) && isCurrent());
      };
      await context();
      const code = await provider.request({ method: 'eth_getCode', params: [fixed.packet.plan.pins.collection, 'latest'] });
      valid(keccak256Hex(code) === fixed.packet.plan.pins.collectionCodeHash);
      const estimate = await provider.request({ method: 'eth_estimateGas', params: [transaction] });
      valid(BigInt(estimate) > 0n && BigInt(estimate) <= BigInt(transaction.gas));
      await provider.request({ method: 'eth_call', params: [transaction, 'latest'] });
      // Browser persistence precedes the committed server claim. A lost response
      // or wallet result recovers the original review; there is no automatic resend.
      await markAttempted(reviewHash);
      const claimed = await claim({ index, revision: fixed.revision, reviewHash });
      valid(claimed.revision === fixed.revision + 1 && claimed.steps[index].status === 'WALLET_REQUESTED'
        && stable(claimed.transaction) === stable(transaction));
      valid(stable(await validateDeploymentWalletReview({ state: claimed, config, index })) === stable(transaction));
      await context();
      const transactionHash = await provider.request({ method: 'eth_sendTransaction', params: [transaction] });
      valid(/^0x[0-9a-f]{64}$/i.test(transactionHash));
      return { transactionHash, state: claimed };
    } finally { busy = false; }
  } };
}
