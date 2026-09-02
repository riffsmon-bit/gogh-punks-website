# Automation V3 hosted-agent lanes

The V3 signer pool has five regular lanes and one priority-only lane.

- Lanes 1–5 receive new regular Punk assignments by stable token-ID modulo over the enabled
  regular lanes.
- Lane 6 is excluded from normal assignment. It is reserved for reviewed priority sessions.
- Once an enrollment row records `agent_address` and `agent_lane`, that pair is immutable through
  normal enrollment updates. V3 authorization is signer-specific, so an unavailable assigned lane
  fails closed instead of falling back to Lane 1.
- Existing pre-pool enrollments remain on Lane 1. They are not silently redistributed.
- Owner setup, status, prepaid gas, manual runs, scheduled runs, and the transaction signer all use
  the same persisted assignment.
- `BROKER_AUTOMATION_V3_REGISTRATION_LANES` can temporarily close an enabled regular lane to new
  owner setup without stopping that lane's worker or changing any persisted assignment. The value
  is an ordered, unique comma-separated subset of lanes 1–5; malformed or disabled lanes fail
  closed.

## Production configuration

Apply the committed database migrations before enabling the pool:

- `20260831234500_add_automation_v3_agent_lanes.sql`
- `20260901001000_expand_automation_v3_worker_lane_leases.sql`

Configure these Netlify variables in **Production / Functions** scope. Never print private-key
values in logs or paste them into source control.

```text
BROKER_AUTOMATION_V3_AGENT_POOL_ENABLED=true
BROKER_AUTOMATION_V3_REGISTRATION_LANES=1,2,3,4,5
BROKER_AUTOMATION_V3_AGENT_LANE_2_ENABLED=true
BROKER_AUTOMATION_V3_AGENT_LANE_2_ADDRESS=
BROKER_AUTOMATION_V3_AGENT_LANE_2_PRIVATE_KEY=
BROKER_AUTOMATION_V3_AGENT_LANE_3_ENABLED=true
BROKER_AUTOMATION_V3_AGENT_LANE_3_ADDRESS=
BROKER_AUTOMATION_V3_AGENT_LANE_3_PRIVATE_KEY=
BROKER_AUTOMATION_V3_AGENT_LANE_4_ENABLED=true
BROKER_AUTOMATION_V3_AGENT_LANE_4_ADDRESS=
BROKER_AUTOMATION_V3_AGENT_LANE_4_PRIVATE_KEY=
BROKER_AUTOMATION_V3_AGENT_LANE_5_ENABLED=true
BROKER_AUTOMATION_V3_AGENT_LANE_5_ADDRESS=
BROKER_AUTOMATION_V3_AGENT_LANE_5_PRIVATE_KEY=
```

Keep Lane 6 separately configured for priority-only work. Do not add it to regular allocation.

To stop new registrations from increasing the legacy Lane 1 imbalance while preserving all
existing Lane 1 Punks, set:

```text
BROKER_AUTOMATION_V3_REGISTRATION_LANES=2,3,4,5
```

The public lane list then reports `registrationOpen: false` for lanes 1 and 6. Restore
`1,2,3,4,5` only after the effective regular workload is acceptably balanced. Reopening
registration never migrates or reauthorizes a Punk.

Verify before deployment:

1. Each enabled address is unique.
2. Each secret key derives its configured address using the local provisioning verifier.
3. Lane 1–5 worker schedules exist in the built Netlify function manifest.
4. The two lane database migrations are present in the production database.
5. `BROKER_AUTOMATION_V3_WORKER_RELEASE` is the exact commit being deployed.

## Live verification after an authorized deployment

The public status endpoint contains no keys and exposes both the enabled public lane list and the
selected Punk assignment:

```sh
curl -fsS 'https://goghpunks.xyz/api/broker/autonomy-v3-status?tokenId=TOKEN_ID' \
  | jq '{lanes: .automation.publicAgentLanes, assigned: .automation.assignedAgentLane}'
```

The prepaid-gas endpoint must report the same `agent` and `agentLane` for the current holder:

```sh
curl -fsS 'https://goghpunks.xyz/api/broker/punk-agent-gas?tokenId=TOKEN_ID&owner=OWNER' \
  | jq '.prepaidAgentGas | {agent, agentLane, publicAgentLanes}'
```

Inspect public nonces without disclosing keys:

```sh
cast nonce LANE_ADDRESS --rpc-url https://rpc.mainnet.chain.robinhood.com
```

For one newly configured test Punk per regular lane, verify this sequence before broad rollout:

1. owner-setup artifact `infrastructure.agent` equals the selected public lane address;
2. enrollment row retains the same `agent_address` and `agent_lane`;
3. status and prepaid gas report that same lane;
4. manual run logs the same lane ID;
5. the corresponding scheduled worker picks up the Punk;
6. the transaction sender and the lane's public nonce confirm the same signer.

Enable lanes gradually (2, then 3, then 4, then 5) and keep rollback reversible: disabling a lane
stops that lane from signing, but intentionally does **not** move its assigned Punks. Re-enable the
same address/key pair to resume them. Changing an assigned signer requires a separate, explicit
owner reauthorization and migration; it is never an automatic fallback.
