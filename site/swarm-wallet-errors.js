const messages = {
  PROVIDER_UNAVAILABLE: 'Reconnect your wallet on Robinhood Chain, then check your Swarm Wallet. No transaction was requested.',
  OWNER_CHANGED: 'The connected wallet or network changed. Select the owner wallet on Robinhood Chain and check again. No transaction was requested.',
  READ_CHAIN_CHANGED: 'The chain reader and your wallet disagree about the network. Select Robinhood Chain and check again. No transaction was requested.',
  STALE_CHAIN: 'The chain reader returned an old block, or your device clock differs from the chain. Check your device time and try again. No transaction was requested.',
  CHAIN_CHANGED: 'The chain changed during this check. Check again for a fresh review. No transaction was requested.',
  RPC_INVALID: 'The chain reader returned an incomplete response. Check your Swarm Wallet again. No transaction was requested.',
  READ_UNAVAILABLE: 'A chain check is temporarily unavailable. Try checking again. No new transaction was requested; any saved transaction is preserved.',
  READ_TIMEOUT: 'A chain check took too long. Try checking again. No new transaction was requested; any saved transaction is preserved.',
  RUNTIME_CHANGED: 'The deployed wallet contract could not be verified. Creation and funding are blocked. Contact Gogh support with this check code.',
  CONFIG_CHANGED: 'The wallet contract settings could not be verified. Creation and funding are blocked. Contact Gogh support with this check code.',
  NONCE_CHANGED: 'Your wallet has another transaction or its transaction count changed. Wait for pending transactions, then prepare a fresh review.',
  SELECTION_CHANGED: 'Your wallet or selected batch changed. Review the current selection again. Any saved wallet request is preserved below.',
  REVIEW_EXPIRED: 'This review expired. Prepare a fresh review, check its fee and confirm again. No new transaction was requested.',
  REVIEW_CHANGED: 'The wallet balance or settings changed. Prepare a fresh review before confirming. No new transaction was requested.',
  INSUFFICIENT_VAULT_FUNDS: 'Your Swarm Wallet does not have enough ETH. Add ETH or reduce the amount, then review again.',
  INSUFFICIENT_OWNER_FUNDS: 'Your connected wallet needs enough ETH for the amount and network fee. No transaction was requested.',
  PUNK_OWNER_CHANGED: 'You no longer own every selected Punk. Refresh your roster and review a new batch.',
  AGENT_CHANGED: 'A selected Punk’s Agent Account could not be verified. Check its wallet in Fund, then review the batch again.',
  FEE_CHANGED: 'Network fees changed. Prepare a fresh review and check the new fee. No transaction was requested.',
  FEE_LIMIT: 'The estimated network fee exceeds this feature’s limit. Try again when fees are lower.',
  DEPENDENCIES_UNAVAILABLE: 'Punk account verification is unavailable, so creation and funding are paused. Verified withdrawals remain available.',
  VAULT_STATE_CHANGED: 'Your Swarm Wallet creation status changed. Check the wallet again before choosing an action.',
  STORAGE_UNAVAILABLE: 'The browser could not save transaction recovery. Free device space or allow site storage, then check wallet activity before retrying.',
  JOURNAL_INVALID: 'Saved Swarm Wallet history is unreadable. Keep it intact and check wallet activity before another request.',
  LOCKS_UNAVAILABLE: 'This browser cannot protect transactions across tabs. Use a browser with Web Locks before opening a wallet request.',
  REQUEST_PENDING: 'A previous wallet request still needs recovery. Check the saved transaction below; it will not be resent.',
  WALLET_RESULT_UNKNOWN: 'The wallet result is unknown. Check MetaMask activity and recover the original transaction below. Do not send another.',
};

export function swarmWalletErrorMessage(error) {
  const code = typeof error?.code === 'string' && /^SWARM_WALLET_[A-Z_]+$/.test(error.code) ? error.code.slice(13) : '';
  const message = messages[code] ?? 'The Swarm Wallet check could not be completed. Check any saved transaction before retrying.';
  return message + (code ? ` Check code: ${code}.` : '');
}
