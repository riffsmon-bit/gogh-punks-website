import { createRobinhoodLinkInspector } from '../discovery/robinhood-link-resolver.mjs';

// Only the reviewed fixed-source inspector is selectable. Neither the model nor
// the holder can supply a resolver, RPC endpoint, transaction or wallet request.
export function createLinkSniperV1({ fetchImpl = fetch, environment = process.env,
  now = () => new Date() } = {}) {
  const inspect = createRobinhoodLinkInspector({ fetchImpl, environment, now });
  return Object.freeze({
    async inspectMintLink({ url }) {
      const result = await inspect(url);
      return Object.freeze({ schema: 'GOGH_LINK_SNIPER_OBSERVATION_V1', ...result,
        walletAuthority: 'NONE', executionAuthorized: false, transactionPrepared: false,
        transactionSubmitted: false });
    },
  });
}
