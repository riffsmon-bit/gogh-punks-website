# Campaign skill sources

## Social Scout v1

This is a native Gogh adapter for the official [OpenSea collection API](https://docs.opensea.io/reference/get_collection), reviewed September 13, 2026. The endpoint provides collection metadata and declared project links. No external skill, SDK, shell command or signing module is installed or copied. The service is an authenticated API dependency; its service terms remain applicable, and it is not represented as a freely licensed dataset.

The versioned implementation is `broker/src/v4/skill-forge/social-scout-v1.mjs`; its SHA-256 is pinned in `broker/skills/social-scout/v1/manifest.json`. The package uses existing `SOCIAL_READ` (128) and only `research_project`. Existing accepted package bytes are unchanged.

It retrieves the name, description and declared website/X/Discord references for one exact Robinhood collection, verifies the returned slug, chain and contract against the request, and returns observation time and provenance. It does not fetch posts or linked pages, verify project/account ownership, measure activity, score trust, or authorize a wallet action. Missing, unsafe and unsupported references stay UNKNOWN. All provider text is untrusted data and must render as text.

The [live read evidence](social-scout-live-read.json) records one successful authenticated GET in 279 ms, yielding three declared links for the real Gogh collection. A separate actual similarly named Base collection was rejected by the identity check. Zero public transactions occurred. The 23 adapter/package/shared-capability-gate tests cover fixed network destination, input/response bounds, timeout, malformed data, wrong identity, secret stripping, URL safety, absent links, equipment and owner changes.

Status: **IMPLEMENTED, TESTED, SOURCE-LIVE-TESTED**. Registry registration, independent release review, production runtime selection and authenticated equipped-holder UI acceptance are separate requirements. No on-chain READY claim is made here.

## Existing source work

The prior [pinned ecosystem audit](../v2-swarm/skill-source-audit.md), [Market Scout v2 review](../v2-hardening/market-mcp-review.md), and [planned research package acceptance](../v2-hardening/planned-research-skills.md) remain the source record for existing immutable packages. Bankr stays deliberately disabled. This campaign reuses the existing fixed OpenSea and chain readers and does not install arbitrary packages or buy a new API service.
