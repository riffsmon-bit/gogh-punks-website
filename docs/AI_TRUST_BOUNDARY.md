# AI Trust Boundary

## Required flow

```text
LLM / visual model / heuristic analyzer
                │ untrusted JSON
                ▼
        schema and range validation
                ▼
       typed acquisition intent
                ▼
 deterministic venue adapter
                ▼
 on-chain policy and live owner checks
                ▼
          Punk Account CALL
                ▼
       NFT receipt postcondition
```

The AI never receives:

- an owner private key or seed phrase;
- a general Punk Account signer;
- unrestricted `execute()` access;
- a protocol guardian key;
- a treasury key;
- an unlimited token approval;
- permission to select arbitrary calldata or a target address.

## Model output

Model-produced fields are treated like hostile user input. Addresses, integer amounts, enum values, scores, hashes, expirations, and identifiers are validated. The model can recommend `BUY COLLECTION X TOKEN Y FOR <= Z`; it cannot say `CALL 0x... WITH 0x...`.

## Reasoning and provenance

The system stores the opportunity, separate scores, recommendation, explanation, time, agent version, Punk identity, and policy version. A reasoning-document hash can be included in the on-chain intent and acquisition event. Private chain-of-thought is neither required nor stored; the human-readable explanation records the actionable rationale and evidence caveats.

## Prompt injection and poisoned metadata

NFT names, descriptions, images, websites, and social posts are untrusted content. They must never become system instructions, secrets, shell commands, URLs fetched with internal credentials, or transaction parameters without schema validation. The staged worker decodes only bounded `data:application/json` token metadata, retains a small sanitized field set, hashes the payload, and never treats its text as instructions. `http://` is blocked and all IPFS/HTTPS metadata remains unfetched until a separate allowlisted gateway service has size, MIME, redirect, network, and timeout limits.

Metadata-derived art dimensions are labeled `HEURISTIC`, capped at low
confidence, and displayed with a tilde. No media model has judged the work at
this stage. A collection can keyword-stuff its own metadata, so these signals
must never change permissions or execution eligibility.

## Fail closed

If the AI, database, RPC, marketplace API, adapter, policy read, ownership read, or price quote is missing or inconsistent, transaction construction stops. Scout can retain an `UNKNOWN` candidate; acquisition cannot silently downgrade a missing check.

Contract-analysis output is also untrusted read-model data. Confirmed-block RPC
evidence and verified ABI surface may affect a Scout explanation, but neither can
register an adapter, produce arbitrary calldata, change policy, or make an
opportunity executable.
