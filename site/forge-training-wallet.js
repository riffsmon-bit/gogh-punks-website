import { validateTrainingReview } from './forge-training-transaction.js';
const binding = state => JSON.stringify([state.tokenId, state.owner?.toLowerCase(), state.collection?.toLowerCase(),
  state.registry?.toLowerCase(), state.progression?.toLowerCase(), state.credits, state.slots, state.cap, state.learned, state.equipped, state.ownershipEpoch ?? null],
  (_key, value) => typeof value === 'bigint' ? value.toString() : value);

// EIP-1193 boundary for a future explicit wallet button. Currently exercised only with
// the disposable Anvil provider. Never connects, switches chain, requests accounts or signs on load.
export function createTrainingWalletAdapter({ provider, readSnapshot }) {
  const attempted = new Set(); let busy = false;
  return Object.freeze({
    async submit({ review, snapshot, action }) {
      if (busy) throw Error('TRAINING_WALLET_BUSY');
      if (attempted.has(review?.intentId)) throw Error('TRAINING_WALLET_ALREADY_REQUESTED');
      busy = true;
      try {
        validateTrainingReview(review, snapshot, action);
        const before = binding(snapshot);
        const checkWallet = async () => {
          const [chain, accounts] = await Promise.all([
            provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' }),
          ]);
          if (chain !== '0x7a69' || !Array.isArray(accounts) || accounts[0]?.toLowerCase() !== snapshot.owner.toLowerCase()) throw Error('TRAINING_WALLET_CONTEXT_CHANGED');
        };
        await checkWallet();
        const fresh = await readSnapshot(snapshot.tokenId);
        if (fresh.localOnly !== true || fresh.chainId !== 31337 || fresh.canBurn !== false || binding(fresh) !== before) throw Error('TRAINING_WALLET_STATE_CHANGED');
        validateTrainingReview(review, fresh, action);
        await checkWallet();
        validateTrainingReview(review, fresh, action);
        // Deliberately one-shot even for rejection/transport failure; a new owner-reviewed
        // intent is required. This does not mean an error proved nothing was broadcast.
        attempted.add(review.intentId);
        const transactionHash = await provider.request({ method: 'eth_sendTransaction', params: [{ ...review.transaction }] });
        if (!/^0x[0-9a-f]{64}$/i.test(transactionHash)) throw Error('TRAINING_WALLET_HASH_UNKNOWN');
        return { status: 'SUBMITTED', transactionHash };
      } finally { busy = false; }
    },
  });
}
