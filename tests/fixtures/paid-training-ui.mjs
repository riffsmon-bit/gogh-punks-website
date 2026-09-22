import { PAID_TRAINING_RELEASE } from '../../site/forge-paid-release.js';
import { PAID_ZERO_KEY, paidTrainingCalldata } from '../../site/forge-paid-wallet.js';
import { keccak256Hex } from '../../site/keccak256.js';
export const PAID_UI_OWNER = '0x1111111111111111111111111111111111111111';
export const PAID_UI_HASH = `0x${'a'.repeat(64)}`;
const word = value => BigInt(value).toString(16).padStart(64, '0');
const hex = value => `0x${BigInt(value).toString(16)}`;
const selector = value => keccak256Hex(`0x${Array.from(new TextEncoder().encode(value), b => b.toString(16).padStart(2, '0')).join('')}`).slice(0, 10);
export function paidUiFixture(clock = Date.now) {
  const code = '0x6001600055', release = structuredClone(PAID_TRAINING_RELEASE);
  Object.assign(release, { status: 'OWNER_CANARY', extension: '0x2222222222222222222222222222222222222222',
    allowedOwners: [PAID_UI_OWNER], canonicalReadersReviewed: true, productionPaymentsAuthorized: true });
  for (const domain of ['collection', 'registry', 'legacyProgression', 'extension']) release[`${domain}CodeHash`] = keccak256Hex(code);
  const state = { owner: PAID_UI_OWNER, tokenId: '93', chainId: 4663, purchasesPaused: false, burnApprovalActive: false, activated: false,
    purchasedCredits: '2', burnCredits: '7', legacyAllocationClaimed: 2, unlockedSlots: 2, reviewNonce: '3',
    reviewStateHash: `0x${'b'.repeat(64)}`, equipped: [PAID_ZERO_KEY, PAID_ZERO_KEY],
    anchor: { number: '100', hash: `0x${'c'.repeat(64)}`, timestamp: String(Math.floor(clock() / 1000)) },
    skills: release.skills.map(skill => ({ ...skill, level: 0, available: true })) };
  const f = { release, state, selected: { owner: PAID_UI_OWNER, tokenId: '93', chainId: 4663, preview: false },
    requests: [], methods: [], sends: 0, signIns: 0, marker: false, receiptStatus: 'PENDING', mode: '', now: clock,
    beforeSend: () => {}, beforeRpc: async () => {}, verifyHook: async () => {} };
  f.blocks = new Map([[state.anchor.number, structuredClone(state.anchor)]]);
  f.review = intended => {
    const review = { schema: 'GOGH_PAID_TRAINING_REVIEW_V1', chainId: 4663,
      ...Object.fromEntries(['collection', 'registry', 'legacyProgression', 'extension', 'extensionCodeHash', 'treasury', 'priceWei'].map(k => [k, release[k]])),
      owner: PAID_UI_OWNER, tokenId: '93', action: structuredClone(intended),
      guard: { nonce: state.reviewNonce, stateHash: state.reviewStateHash, deadline: String(Number(state.anchor.timestamp) + 45) },
      anchor: structuredClone(state.anchor), transaction: { from: PAID_UI_OWNER, to: release.extension, data: '', value: intended.operation === 'buy' ? hex(release.priceWei) : '0x0',
        chainId: '0x1237', nonce: '0x8', gas: '0x186a0', maxFeePerGas: '0x3b9aca00', maxPriorityFeePerGas: '0x0' } };
    review.transaction.data = paidTrainingCalldata(review.tokenId, intended, review.guard); return review;
  };
  f.request = async (path, options = {}) => {
    if (path === '/api/v2/punks/93/forge/skill') {
      const body = JSON.parse(options.body); f.requests.push('research');
      return { ok: true, mode: 'EQUIPPED_RESEARCH', owner: PAID_UI_OWNER, tokenId: '93', chainId: 4663,
        skillKey: body.skillKey, action: body.action, walletAuthority: 'NONE', canBurn: false, result: { sampleSize: 3, rankings: [] } };
    }
    if (path !== '/api/v2/punks/93/forge/paid-training') throw Error('FIXTURE_PATH_INVALID');
    const body = options.body ? JSON.parse(options.body) : null; f.requests.push(body?.operation ?? 'get');
    if (f.mode === 'long-error') throw Error('<img src=x onerror=alert(1)> ' + 'UNBROKEN_ERROR_'.repeat(50));
    if (!body) {
      state.anchor = { number: String(BigInt(state.anchor.number) + 1n), timestamp: String(Math.floor(clock() / 1000)),
        hash: `0x${(BigInt(state.anchor.number) + 1n).toString(16).padStart(64, '0')}` };
      f.blocks.set(state.anchor.number, structuredClone(state.anchor));
      return { ok: true, release: structuredClone(release), state: structuredClone(state) };
    }
    if (body.operation === 'prepare') return { ok: true, review: f.review(body.action), maximumNetworkFeeWei: '100000000000000' };
    if (body.operation === 'verify') { await f.verifyHook(); return { ok: true, review: structuredClone(body.review) }; }
    if (body.operation === 'recover') return { ok: true, status: f.receiptStatus, transactionHash: body.transactionHash, review: body.review };
    if (body.operation === 'abandon') {
      if (!f.expiredUnused) throw Error('Finalized proof that the review expired unused is unavailable.');
      return { ok: true, status: 'EXPIRED_UNUSED', review: body.review };
    }
    throw Error('FIXTURE_OPERATION_INVALID');
  };
  f.provider = { request: async ({ method, params = [] }) => {
    f.methods.push(method); await f.beforeRpc(method, params);
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_accounts') return [PAID_UI_OWNER];
    if (method === 'eth_getTransactionCount') return '0x8';
    if (method === 'eth_getCode') return code;
    if (method === 'eth_getBlockByNumber') {
      const block = params[0] === 'latest' ? state.anchor : f.blocks.get(String(BigInt(params[0])));
      if (!block) throw Error('FIXTURE_BLOCK_UNAVAILABLE');
      return { number: hex(block.number), hash: block.hash, timestamp: hex(block.timestamp), baseFeePerGas: '0x1' };
    }
    if (method === 'eth_getLogs') return [];
    if (method === 'eth_estimateGas') return '0x10000';
    if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
    if (method === 'eth_call') {
      const data = params[0].data.slice(0, 10);
      if (data === selector('ownerOf(uint256)')) return `0x${word(PAID_UI_OWNER)}`;
      if (data === selector('reviewNonce(uint256)')) return `0x${word(state.reviewNonce)}`;
      if (data === selector('reviewStateHash(uint256)')) return state.reviewStateHash;
      for (const name of ['collection', 'registry', 'legacyProgression', 'treasury', 'creditPriceWei']) if (data === selector(`${name}()`))
        return `0x${word(name === 'creditPriceWei' ? release.priceWei : release[name])}`;
    }
    if (method === 'eth_sendTransaction') { f.beforeSend(params[0]); f.sends++;
      if (f.mode === 'reject') throw Object.assign(Error('Wallet rejected'), { code: 4001 });
      if (f.mode === 'lost') throw Error('Wallet response lost. Recover the original hash.');
      return PAID_UI_HASH;
    }
    throw Error(`FIXTURE_RPC_INVALID:${method}`);
  } };
  return f;
}
