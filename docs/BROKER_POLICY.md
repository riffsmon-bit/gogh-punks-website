# Broker Policy

`BrokerPolicyModule` is the final economic authorization check for broker acquisitions.

## Validation order

1. Caller must be the intent's Punk Account.
2. Account binding must be chain 4663 and the canonical Gogh Punks collection.
3. Global and account pause states must be clear.
4. Live owner must match the owner who configured policy.
5. Intent policy version must match current storage.
6. Operating mode and global feature flag must authorize the path.
7. Chain, expected owner, time window, asset type, and slippage fields must be valid.
8. Adapter must be globally active, code-hash-pinned, and owner-approved.
9. Marketplace or mint venue must be owner-approved.
10. Collection denylist is checked before allowlist logic.
11. Currency and venue/currency maximum must be configured.
12. Denied selector wins over an allowed selector.
13. Execution returned by the adapter must match venue, currency, value, and exact allowance.
14. Transaction, mint/secondary, daily, weekly, frequency, slippage, and reserve limits must pass.
15. Usage is consumed before the external call; a downstream revert rolls it back atomically.

## Currency accounting

Budgets are tracked separately per currency. Native ETH uses the primary policy limits. ERC-20 currencies use an explicit per-currency policy so incomparable units are never added together. The daily acquisition-count limit is account-wide across every currency, preventing a multi-currency split bypass. Minimum native reserve is checked for every acquisition, including ERC-20 purchases.

## Ownership changes

Policy execution requires the live owner to equal `configuredBy`. After a transfer, the new owner must explicitly configure a policy before changing permissions. That first configuration advances a permission generation, invalidating every inherited adapter, venue, collection, mint, currency, selector, and venue-limit permission. A new owner therefore cannot reactivate the previous owner's execution surface by changing only one field or unpausing it.

The immutable Gogh Punks collection does not expose a transfer epoch. A transfer away and later back to the exact same address cannot be distinguished purely from current `ownerOf`; this is documented as a production autonomy blocker requiring a conservative operational mitigation or separately audited ownership-epoch mechanism.

## Time buckets

Daily and weekly limits use UTC Unix timestamp buckets. Transaction splitting cannot reset usage within a bucket. The indexer may display local time, but on-chain enforcement uses the block timestamp.

## Price protection

An intent includes expected price, maximum price, slippage basis points, creation time, and expiration. The adapter's actual payment must not exceed:

- intent maximum;
- expected price plus slippage;
- transaction maximum;
- mint or secondary maximum;
- venue/currency maximum;
- remaining daily and weekly budgets.

## Emergency controls

The current owner can pause policy, lower budgets, increase reserve, remove permissions, deny selectors, change policy version, cancel pending account nonces, or revoke agents. The protocol guardian can globally pause policy but cannot configure a Punk or move its assets.

## Production feature defaults

| Feature | Default |
| --- | --- |
| Scout | ON |
| Approval purchases | OFF |
| Autonomous purchases | OFF |
| Autonomous mints | OFF |
| Unknown collection execution | OFF |
| Owner selling | OFF in this implementation |
| Autonomous selling | OFF |

Only the guardian can enable a global feature, and the current Punk owner must still opt in through policy and permissions.
