# V3 worker-enrollment backfill

New V3 activations enroll themselves and request their first scan as part of the current site
flow. This tool repairs older, already-authorized V3 Punk Accounts that predate that behavior.
Enrollment is only a worker-roster entry: it grants no on-chain authority and sends no
transaction.

Run the read-only report first from an environment containing the production primary and
independent secondary Robinhood RPC URLs:

```sh
npm run broker:autonomy:v3-backfill:dry-run
```

The command discovers exact `GoghPunkAccountActivated` events from the reviewed V3 facade, then
uses the existing dual-provider live-state validator for every Punk. It reports `WOULD_ENROLL`
only when the account is created, its zero-price policy is active, and its agent authorization is
currently effective. Provider disagreement or missing evidence is skipped closed.

After reviewing a successful report, the reversible database-only apply path is:

```sh
BROKER_AUTOMATION_V3_BACKFILL_CONFIRM=ENROLL_ALREADY_AUTHORIZED_V3_PUNKS \
  npm run broker:autonomy:v3-backfill:apply
```

The apply command is intentionally confirmation-gated. It neither signs nor broadcasts, never
changes policy, and never reactivates an expired or revoked Punk. The scheduled worker repeats all
live policy and authorization checks before any mint can be considered.
