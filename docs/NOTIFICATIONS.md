# Notification Architecture

Notifications are an optional off-chain convenience and never participate in transaction authorization.

At delivery time the dispatcher resolves `ownerOf(tokenId)` for the canonical chain-qualified Punk. It then loads encrypted settings keyed by that live owner's wallet—not by the transferable Punk—and invokes only configured channel adapters.

Supported event vocabulary includes recommendations, approval requests, purchase results, budget thresholds, pauses, suspicious activity, ownership changes, and policy violations. Discord, email, push, and Telegram can be added independently; no channel is required for protocol operation.

Notification adapters receive a destination, public event payload, and Punk key. They receive no wallet key, agent signer, raw owner settings, acquisition execution authority, or arbitrary calldata. Delivery receipts must not contain the private destination.

Ownership changes do not copy notification settings. A former owner's destination remains associated only with that former owner's encrypted owner record.
