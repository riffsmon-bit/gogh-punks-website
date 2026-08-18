# Art Agent Security

## Separate principals

Production must use distinct principals for:

- deployer;
- protocol guardian multisig;
- collection owner/treasury;
- Art Agent signer;
- backend administrator;
- marketplace administrator, if any.

The deployment script assigns registry ownership directly to `PROTOCOL_GUARDIAN`; it does not grant the deployer Punk Account authority. Agent secret material must live in a managed signer/HSM or equivalent isolated signing service—not source control, Netlify environment variables, logs, or an AI prompt.

## Two-layer authorization

An agent is usable only when:

1. the protocol guardian has globally registered its address, version hash, metadata hash, activation time, and expiration;
2. the current Punk owner has authorized that agent for that specific account and a shorter expiration;
3. neither global registry pause nor global agent disable is active;
4. live Punk ownership still matches the authorizing owner;
5. authorization generation has not been revoked.

Account authorization is capped at 30 days. The owner can revoke one agent or increment the generation to revoke every agent.

## Bounded compromise

A compromised agent cannot call general account execution. Its maximum damage is bounded by the active policy, exact registered adapter, approved venue/collection/currency/selector, price limits, daily/weekly budgets, count limit, reserve, expiration, and NFT receipt postcondition.

A compromised global guardian can approve an agent or adapter and enable a feature globally, but still cannot create account-level owner authorization, change a Punk's policy, or withdraw assets. This is meaningful residual governance risk and is why guardian actions require a multisig, timelock for additive changes, monitoring, and an emergency fast-disable path.

## Agent rotation

1. Globally register the new version with a future `validAfter`.
2. Review its code/image digest, signer isolation, and metadata hash.
3. Ask owners to authorize the new agent for short periods.
4. Disable the old global record.
5. Verify old-agent acquisition attempts fail.
6. Rotate backend credentials without changing any Punk owner key.

## Transfer caveat

While a different owner holds the Punk, old authorization is invalid immediately. See `GOGH_PUNK_ACCOUNTS.md` for the immutable-collection same-owner round-trip limitation. Autonomous rollout is blocked until this edge case receives an audited final design.
