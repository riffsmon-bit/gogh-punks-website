# Collection display: independent browser UX review

Reviewed September 13, 2026, against the lead-owned display changes following integration commit `4f9e450`. The reviewer owns only this report and `scripts/test-v2-collection-display-ui.mjs`; no frontend, backend, contract, deployment or operational file was edited here.

The final controlled browser run passed all fourteen scenarios at 1440, 375 and 320px. Real #1599 metadata exposed an additional identification problem: its name is `pre-reveal`, so the original card title did not identify the token. The lead added an independent token-ID label, and the final regression confirms that correction. No finding below remains open within this bounded Collection/roster review.

## Findings and disposition

| Finding | User-visible condition | Correction / evidence |
|---|---|---|
| CD-01 · medium | Owned #235/#241 lack indexed artwork, causing the same unrelated Punk picture to repeat across the roster. | Missing indexed images remain unknown; the real `hydrateRosterArtwork()` path fills them asynchronously. The browser fixture initially omits every indexed image, then supplies captured canonical #235/#241 SVGs. Their exact image data reaches the correct roster cards; the files differ and were visually inspected. Missing #4999 artwork remains a neutral placeholder. |
| CD-02 · medium | Loading and error rows look like NFT cards, obscuring whether a piece is actually held. | Loading, error and verified-empty states render text panels with zero `.gallery-item` cards. Counts use `—` while unavailable and `0` for a verified empty result. The explicit Refresh collection button disables during loading and works with Enter from keyboard focus. |
| CD-03 · medium | A profile error or slow profile request prevents otherwise available holdings from appearing; parallel reads can cause redundant sign-in work. | Actual profile and Collection paths run independently. A mocked profile HTTP 503 does not prevent the verified #1599 card. Parallel profile/Collection reads prepare one mock session and invoke one in-memory `personal_sign` fixture. No real wallet participates. |
| CD-04 · medium | Old success/error responses can replace the currently selected Punk's or owner's gallery. | Browser scenarios delay HTTP responses across Punk changes and owner changes, then release stale successes/errors. The final regression also returns to #93 before its old #93 response arrives, checking request generation as well as identity. |
| CD-05 · medium | Real #1599 metadata is named `pre-reveal`. A title derived only from metadata can omit the NFT number, making the newly collected piece hard to identify. | Lead added `TOKEN #1599` independently of metadata title. Final fixture uses the real generic name and asserts the exact token ID remains visible. |
| CD-06 · low | The neutral placeholder visibly says “ARTWORK LOADING” when metadata is simply unavailable. | Lead changed its visible caption to “ARTWORK UNAVAILABLE”; the browser screenshots show the neutral frame instead of another Punk's art. |
| CD-07 · low | Desktop Collection recovery links touch without spacing. | Communicated with screenshot evidence; lead added spacing. This did not block the functional scenarios. |

## Actual UI versus mocked authority

The harness serves the actual **non-preview** `/broker/v2/` HTML, CSS and JavaScript. It does not replace `renderRoster`, `renderGallery`, `fetchOwnedPunks`, `hydrateRosterArtwork`, `loadProductionCollection`, `hydrateSelected`, `ensureV2Session`, or their event handlers. It drives the existing wallet-state event and native roster/tab/Refresh controls, so the production presentation and asynchronous request paths execute.

The served wallet bootstrap is omitted. The ownership-reader import is replaced with a fixture, and HTTP responses for indexed candidates, artwork, sessions, profiles, Agent status and Collection are controlled in memory. One explicit mock sign-in scenario returns an inert dummy signature; every transaction or other provider method is rejected. The actual recovery panel/controller remains mounted, but no recovery review or confirmation is clicked.

The indexed roster fixture deliberately has **no image** for #235/#241. Artwork is held pending while an owner edits a real mounted Agent recovery amount input. Releasing the artwork response updates only the appropriate images: the same recovery input DOM node and exact 18-decimal draft remain. Collection refreshes retain the draft, and returning to the original owner/Punk restores it after selection changes.

Delayed Collection responses deliberately ignore `AbortSignal`, representing a transport that still completes after cancellation. The UI must discard their results itself. These tests establish presentation, request ordering and draft preservation; they do not establish live NFT ownership, production authentication, signature validity, blockchain receipt correctness or recovery transaction safety.

## Canonical artwork captures

Original Punk images were fetched read-only through `createOriginalPunkArtworkEnricher` using the public Blockmachine Robinhood RPC after verifying chain 4663. No key, wallet provider or transaction was used. The captured `imageUrl` hashes match the earlier independent live report:

| Original token | Keccak-256 of original image data URL | Local SVG |
|---|---|---|
| #235 | `0x6aff81f433873c3f022e9631476e7c49acc8f93b7a32dd135d520ff811a94b17` | `/private/tmp/gogh-collection-art-235.svg` |
| #241 | `0x58bb38fcf9274464afd49ec2bef2e21eb9e7d61f09e4c5989a6650fcb9a4fbee` | `/private/tmp/gogh-collection-art-241.svg` |

Each original SVG data URL is 17,354 characters. The metadata and image are display evidence, not owner authority. The browser receives the same captured image data through a mocked local artwork response and makes no public RPC request.

Peppies #1599 was also inspected read-only at collection `0xb73f1d1aee57410d537d87b656e98b9d3df5b213`. Its current token URI is `ipfs://bafkreibmj6unqk4drub2hprtmuc35iy3y7ogo5236it2uxbary646uvnre`; metadata reports name `pre-reveal` and image CID `bafkreigjjcif5gohjlmluu5qll6juzeny5iwnkg7sta7mralourk67w3mq`. The primary image gateway timed out; the fixed alternate IPFS gateway returned an 89,222-byte WebP, saved at `/private/tmp/gogh-collection-art-1599.webp`. It is an animated pre-reveal WebP with dark frames (the file contains an `ANIM` chunk). Its appearance varies between screenshot frames; this is not a missing-image indication. That image was opened with `view_image` and is used in final screenshots.

The local manifest is `/private/tmp/gogh-collection-artwork-fixtures.json`. Captures remain local artifacts, not Git assets. Without that optional manifest, the reusable harness falls back to explicitly described repository display fixtures and does **not** claim canonical artwork identity.

## Browser results and evidence

Final retest: **PASS**. Fourteen scenarios cover missing-index artwork enrichment; neutral unknown art; loading/error/empty text; keyboard Refresh; verified #1599 display; independent profile failure; deduplicated mock sign-in; retained recovery draft; and stale Punk/owner success/error responses. The final script asserts a live status region, `aria-busy`, the #93 → #235 → #93 stale-response case, and visible #1599 identification despite the generic `pre-reveal` title. Stale-error assertions check the retained card count and current status as well as absence of old text, so a sanitized old error cannot silently clear the gallery.

All thirteen controlled Collection requests settled. Results recorded one in-memory mock `personal_sign`, zero other provider calls, zero real wallet calls, zero public transactions, zero external browser requests and zero uncaught runtime exceptions. Exact viewport/document widths matched 1440, 375 and 320px; visible inputs had accessible labels. All ten final screenshots were opened with `view_image`. Chrome, its owned profile and the loopback server were cleaned after completion. `node --check` and the staged diff whitespace check passed.

The actual served source snapshot is recorded in the JSON report:

| Source | SHA-256 |
|---|---|
| `broker/v2/index.html` | `a030fa4aa6ad0fa943e4bb2a37561603ed588a93e2d83c49e7c3e77ffc4b6313` |
| `broker-v2.js` | `f42ed0dbe455b7bb5ac8bb6a15470f2e72881e7ad2f3e7043a84d6fa7cf979ad` |
| `broker-v2.css` | `03b29011866b3116347f49d5128564fb36a32ea76bca8c02f290c6149ddb52c9` |
| `assets/nft-placeholder.svg` | `2a24f5e18af88747a8a86b064b5c571e20d87f22b5759fd33630c25e66591535` |

Final evidence directory: `/private/tmp/gogh-collection-display-ux-final/`. The earlier exploratory run remains at `/private/tmp/gogh-collection-display-ux/`.

- `report.json`: requests, source/artwork hashes, scenario list, viewport measurements and mocked-call counts.
- `roster-{1440,375,320}.png`: distinct #235/#241 artwork and neutral unknown artwork.
- `collection-{loading,error,empty}-1440.png`: text states and visible retry action.
- `collection-{1440,375,320}.png`, `collection-final-320.png`: card identity, ownership label, Agent custody, actions and retained latest state.

The first run used a labelled repository image fixture for #1599; final screenshots replace it with its captured current pre-reveal artwork. Fixture #93/#4999 artwork is intentionally absent to test the neutral state; those screenshots make no claim that the real tokens lack metadata. The wallet header can still say “Wallet disconnected” because the real wallet bootstrap is intentionally omitted. This is a controlled UI screenshot, not a logged-in production session.

## Reproduction and integration

From a complete integrated checkout:

```sh
node scripts/test-v2-collection-display-ui.mjs --mock-wallet-only
```

To reproduce the independent canonical-image review:

```sh
GOGH_UI_SITE_ROOT=/private/tmp/gogh-punk93-mint-stall/site \
GOGH_COLLECTION_ARTWORK_FIXTURES=/private/tmp/gogh-collection-artwork-fixtures.json \
GOGH_UI_OUTPUT_DIR=/private/tmp/gogh-collection-display-ux-final \
node scripts/test-v2-collection-display-ui.mjs --mock-wallet-only
```

`GOGH_UI_OUTPUT_DIR` selects a separate artifact directory; `GOGH_CHROME_PATH` overrides Chrome's executable. No dependency install is required. The script starts a random-port loopback server and a separate headless profile, denies external browser requests using interception/CSP/DNS restrictions, then removes the owned profile and closes the server. It does not inspect or change user Chrome, existing practice/live services, keys, contracts, migrations or deployments.

Integrate this script after the lead's display fixes. This is a bounded Collection/roster review, not acceptance of all product journeys, a performance benchmark, full assistive-technology certification or production deployment authorization. The broader hardening audit remains separate.
