# Discord holder roles

Gogh Punks live on Robinhood Chain `4663`, which Vulcan does not list among its native NFT
verification networks. Configure Vulcan's **Custom Webhook** verifier rather than entering the
collection as an Ethereum contract.

The server endpoint is:

```text
https://goghpunks.xyz/api/vulcan/holder-verification?token=SERVER_SECRET
```

`SERVER_SECRET` is stored only as the Netlify production secret
`VULCAN_HOLDER_WEBHOOK_TOKEN`. Do not paste it into Discord, source control, screenshots, or
public support messages. The endpoint accepts only Vulcan's documented `wallet` or `wallets`
POST body, checks Robinhood chain ID `4663`, and calls `balanceOf` on the canonical collection
`0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6`. It never signs or submits a transaction.

Vulcan dashboard setup:

1. Visit `https://www.vulcan.xyz/select/` and choose the Gogh Punks server.
2. Create or select one Discord role named `Holder`. Ensure Vulcan Authentication's managed role
   is above `Holder`; do not give the holder role administrator or role-management permissions.
3. Under **Verify Roles → Custom Webhook**, create one rule with minimum qualifying balance `1`,
   the `Holder` role, and the secret endpoint above.
4. Select a dedicated public verification channel and save so Vulcan posts its verification panel.
5. Verify with one known holder and one non-holder. Confirm the holder role is added and that
   Vulcan's scheduled recheck removes it after ownership no longer qualifies.

Vulcan's documentation says Custom Webhook roles are rechecked daily. The on-chain collection is
the authority; the role is only a Discord access convenience.
