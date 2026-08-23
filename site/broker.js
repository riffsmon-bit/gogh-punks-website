const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const OPENSEA_IMAGE_HOSTS = new Set(["i.seadn.io", "raw2.seadn.io"]);
const OPENSEA_ASSET_PREFIX = "/assets/robinhood/";

function trustedProviderUrl(value, { hostname, hostnames, pathnamePrefix = "/" }) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const allowedHostname = hostnames instanceof Set
      ? hostnames.has(url.hostname)
      : url.hostname === hostname;
    if (
      url.protocol !== "https:"
      || !allowedHostname
      || url.username
      || url.password
      || url.hash
      || !url.pathname.startsWith(pathnamePrefix)
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function displayMetadata(record) {
  const metadata = record?.nftMetadata;
  return metadata && typeof metadata === "object" ? metadata : {};
}

function renderCardArtwork(card, record, token) {
  const metadata = displayMetadata(record);
  const imageUrl = trustedProviderUrl(metadata.imageUrl, { hostnames: OPENSEA_IMAGE_HOSTS });
  const openSeaUrl = trustedProviderUrl(metadata.openSeaUrl, {
    hostname: "opensea.io",
    pathnamePrefix: OPENSEA_ASSET_PREFIX,
  });
  const art = card.querySelector("[data-card-art]");
  if (imageUrl && art) {
    const image = document.createElement("img");
    image.className = "nft-art";
    image.src = imageUrl;
    image.alt = metadata.name
      ? `${String(metadata.name)} artwork`
      : `NFT #${String(token)} artwork from OpenSea metadata`;
    image.loading = "lazy";
    image.decoding = "async";
    image.width = 600;
    image.height = 600;
    image.addEventListener("error", () => {
      image.remove();
      art.classList.remove("has-art");
    }, { once: true });
    art.prepend(image);
    art.classList.add("has-art");
  }
  const attribution = card.querySelector("[data-card-opensea]");
  if (openSeaUrl && attribution) {
    attribution.href = openSeaUrl;
    attribution.hidden = false;
  }
  const traitList = card.querySelector("[data-card-traits]");
  if (traitList && Array.isArray(metadata.traits)) {
    for (const trait of metadata.traits.slice(0, 3)) {
      const type = typeof trait?.traitType === "string" ? trait.traitType : null;
      const value = typeof trait?.value === "string" ? trait.value : null;
      if (!type || !value) continue;
      const item = document.createElement("li");
      item.textContent = `${type}: ${value}`;
      traitList.append(item);
    }
    traitList.hidden = traitList.childElementCount === 0;
  }
}

function renderPunkArtwork(artwork, tokenId) {
  const image = document.querySelector("[data-punk-portrait]");
  if (!image) return;
  const imageUrl = trustedProviderUrl(artwork?.imageUrl, { hostnames: OPENSEA_IMAGE_HOSTS });
  if (imageUrl) {
    image.src = imageUrl;
    image.alt = artwork?.name
      ? `${String(artwork.name)} artwork`
      : `Gogh Punk #${String(tokenId)} artwork`;
  }
  const openSeaUrl = trustedProviderUrl(artwork?.openSeaUrl, {
    hostname: "opensea.io",
    pathnamePrefix: OPENSEA_ASSET_PREFIX,
  });
  const attribution = document.querySelector("[data-punk-opensea]");
  if (openSeaUrl && attribution) {
    attribution.href = openSeaUrl;
    attribution.hidden = false;
  }
}

function publishOwnerSnapshot(punk, tokenId, source) {
  const address = punk?.owner_snapshot;
  if (typeof address !== "string") return;
  const detail = {
    address,
    tokenId: String(tokenId),
    blockNumber: punk?.owner_snapshot_block ?? null,
    source,
  };
  window.__GOGH_OWNER_SNAPSHOT__ = detail;
  window.dispatchEvent(new CustomEvent("gogh:owner-snapshot", {
    detail,
  }));
}

function formatNativeWei(value) {
  try {
    const wei = BigInt(value);
    if (wei < 0n) return null;
    const unit = 10n ** 18n;
    const whole = wei / unit;
    const fraction = (wei % unit).toString().padStart(18, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return null;
  }
}

function scoutSignal(opportunity) {
  const metadata = opportunity.metadata ?? {};
  if (metadata.mintSignal === true) {
    const status = metadata.mintPriceStatus ?? "UNKNOWN";
    return status === "KNOWN"
      ? `Mint activity observed · price ${String(opportunity.expected_price ?? opportunity.expectedPrice ?? "unknown")} base units · contract review required`
      : "Mint activity observed · price and callable phase unverified · research only";
  }
  if (metadata.historicalSaleSignal !== true) return "Research signal · no execution available";
  const price = metadata.historicalSalePrice;
  const currency = String(metadata.historicalSaleCurrency ?? "").toLowerCase();
  const nativePrice = currency === ZERO_ADDRESS ? formatNativeWei(price) : null;
  const displayPrice = nativePrice === null
    ? `${String(price ?? "unknown")} base units`
    : `${nativePrice} ETH`;
  return `Completed sale · ${displayPrice} · not a live listing`;
}

function transparentScore(scores, analysisStatus, scoreField, statusField) {
  const status = analysisStatus?.[statusField] ?? null;
  if (status === "PENDING" || status === "UNAVAILABLE") return "—";
  const value = scores[scoreField];
  if (value === undefined || value === null) return "—";
  return status === "HEURISTIC" || status === "OBSERVED_ACTIVITY"
    ? `~${String(value)}`
    : String(value);
}

function collectionEvidenceSummary(metadata) {
  const signals = metadata.collectionSignals;
  if (!signals) return "Collection intelligence pending confirmed evidence.";
  const parts = [];
  if (signals.metadata?.status === "ONCHAIN_JSON") parts.push("on-chain metadata sampled");
  if (signals.metadata?.status === "REMOTE_UNFETCHED") parts.push("remote metadata not fetched");
  if (signals.metadata?.status === "INSECURE_REMOTE_BLOCKED") {
    parts.push("insecure metadata URI blocked");
  }
  const sales30d = signals.market?.sales?.last30Days;
  if (Number.isSafeInteger(Number(sales30d))) {
    parts.push(`${Number(sales30d)} confirmed sale${Number(sales30d) === 1 ? "" : "s"} / 30d`);
  }
  const owners = signals.market?.ownerSample;
  if (Number(owners?.resolved) > 0) {
    parts.push(`${Number(owners.uniqueOwners)} unique owner${Number(owners.uniqueOwners) === 1 ? "" : "s"} in ${Number(owners.resolved)} sampled tokens`);
  }
  if (signals.observedBlock) parts.push(`evidence block ${signals.observedBlock}`);
  try {
    const seconds = BigInt(signals.observedBlockTimestamp);
    if (seconds >= 0n && seconds <= 8_640_000_000_000n) {
      const date = new Date(Number(seconds) * 1_000);
      if (!Number.isNaN(date.getTime())) parts.push(`as of ${date.toISOString()}`);
    }
  } catch {
    // Missing/invalid provenance stays undisplayed rather than being guessed.
  }
  return parts.length
    ? `${parts.join(" · ")}. Historical/sample evidence only.`
    : "Collection signals are unavailable; no score was inferred.";
}

async function loadStatus() {
  const statusTargets = document.querySelectorAll("[data-protocol-status]");
  if (!statusTargets.length) return;
  try {
    const response = await fetch("/api/broker/status", { headers: { accept: "application/json" } });
    const payload = await response.json();
    if (payload.scoutStatus?.punk && payload.scoutStatus?.tokenId !== undefined) {
      publishOwnerSnapshot(
        payload.scoutStatus.punk,
        payload.scoutStatus.tokenId,
        "scout",
      );
    }
    const scoutDataAvailable = payload.scoutStatus?.dataStatus === "READ_ONLY_DATA_AVAILABLE";
    statusTargets.forEach((target) => {
      target.textContent = payload.protocol?.deploymentStatus === "NOT_DEPLOYED"
        ? scoutDataAvailable
          ? "ONE-PUNK SCOUT DATA AVAILABLE · EXECUTION OFF"
          : "SCOUT STATUS NOT CONFIRMED · EXECUTION OFF"
        : String(payload.protocol?.deploymentStatus ?? "UNAVAILABLE");
      target.classList.remove("loading");
    });
    document.querySelectorAll("[data-autonomy-status]").forEach((target) => {
      target.textContent = payload.autonomyStatus === "ENABLED" ? "ON" : "OFF";
    });
    document.querySelectorAll("[data-owner-execution-status]").forEach((target) => {
      const deployed = payload.protocol?.deploymentStatus === "DEPLOYED";
      const autonomous = payload.autonomyStatus === "ENABLED";
      target.textContent = deployed
        ? autonomous ? "Contracts live · agent automation on" : "Contracts live · agent automation off"
        : "Execution is not live";
    });
    document.querySelectorAll("[data-live-summary]").forEach((target) => {
      const deployed = payload.protocol?.deploymentStatus === "DEPLOYED";
      const autonomous = payload.autonomyStatus === "ENABLED";
      target.textContent = deployed
        ? autonomous
          ? "Contracts are live and autonomous execution is enabled. Every action still passes current on-chain policy."
          : "Contracts and Punk Accounts are live. Automated collection is currently paused. Activation and saved preferences remain available while execution permissions stay off."
        : "Execution is not live. Public Scout data may still be available for read-only browsing.";
    });
    document.querySelectorAll("[data-scout-token-id]").forEach((target) => {
      target.textContent = payload.scoutStatus?.tokenId ?? "—";
    });
    document.querySelectorAll("[data-public-scout-token-display]").forEach((target) => {
      target.textContent = payload.scoutStatus?.tokenId
        ? `#${payload.scoutStatus.tokenId}`
        : "—";
    });
    document.querySelectorAll("[data-opportunity-count]").forEach((target) => {
      target.textContent = String(payload.scoutStatus?.opportunityCount ?? 0);
    });
    document.querySelectorAll("[data-recommendation-count]").forEach((target) => {
      target.textContent = String(payload.scoutStatus?.recommendationCount ?? 0);
    });
    document.querySelectorAll("[data-metadata-count]").forEach((target) => {
      target.textContent = String(payload.scoutStatus?.metadataCount ?? 0);
    });
    if (payload.scoutStatus?.tokenId) {
      document.querySelectorAll("[data-scout-gallery-link]").forEach((target) => {
        target.href = `/punk/${encodeURIComponent(payload.scoutStatus.tokenId)}`;
      });
    }
  } catch {
    statusTargets.forEach((target) => {
      target.textContent = "STATUS UNAVAILABLE";
      target.classList.remove("loading");
    });
    document.querySelectorAll("[data-owner-execution-status]").forEach((target) => {
      target.textContent = "Execution status unavailable";
    });
    document.querySelectorAll("[data-live-summary]").forEach((target) => {
      target.textContent = "Live execution status could not be confirmed. No execution capability is inferred.";
    });
  }
}

function opportunityCard(opportunity) {
  const scores = opportunity.scores ?? {};
  const metadata = opportunity.metadata ?? {};
  const analysisStatus = metadata.analysisStatus ?? null;
  const card = document.createElement("article");
  card.className = "opportunity-card";
  const collection = opportunity.collection_address
    ?? opportunity.nft_collection_address
    ?? opportunity.collection
    ?? "Unknown collection";
  const collectionName = metadata.collectionSignals?.identity?.name;
  const nftMetadata = displayMetadata(opportunity);
  const token = opportunity.token_id ?? opportunity.nft_token_id ?? opportunity.tokenId ?? "—";
  const mintDecision = opportunity.decision_detail?.mintInterest?.decision ?? null;
  card.innerHTML = `
    <div class="art-placeholder" data-card-art><span>ART PREVIEW PENDING</span></div>
    <div class="card-body">
      <div class="card-meta"><span data-card-type></span><span data-card-risk></span></div>
      <h3 data-card-title></h3>
      <p class="signal-note" data-card-signal></p>
      <p class="evidence-note" data-card-evidence></p>
      <ul class="trait-list" data-card-traits hidden></ul>
      <div class="score-strip" aria-label="Opportunity scores">
        <div><span>Art</span><strong data-score-art></strong></div>
        <div><span>Taste</span><strong data-score-taste></strong></div>
        <div><span>Creator</span><strong data-score-creator></strong></div>
        <div><span>Market</span><strong data-score-market></strong></div>
        <div><span>Liquidity</span><strong data-score-liquidity></strong></div>
        <div><span>Collection</span><strong data-score-collection></strong></div>
        <div><span>Art evidence</span><strong data-score-art-evidence></strong></div>
        <div><span>Market evidence</span><strong data-score-market-evidence></strong></div>
        <div><span>Contract risk</span><strong data-score-risk></strong></div>
        <div><span>Contract evidence</span><strong data-score-evidence></strong></div>
      </div>
      <div class="card-actions">
        <button class="action-button" type="button" disabled>Watch</button>
        <button class="action-button" type="button" disabled>Propose</button>
      </div>
      <a class="opensea-attribution" data-card-opensea href="https://opensea.io" target="_blank" rel="noopener noreferrer nofollow" hidden>Metadata via OpenSea ↗</a>
      <p class="locked-note">Scout data only. Acquisition controls are disabled.</p>
    </div>`;
  card.querySelector("[data-card-type]").textContent = opportunity.acquisition_mode
    ? `ACQUIRED · ${opportunity.acquisition_mode}`
    : mintDecision
      ? `${opportunity.opportunity_type ?? opportunity.opportunityType ?? "MINT"} · ${mintDecision.replaceAll("_", " ")}`
    : opportunity.recommendation
      ? `${opportunity.opportunity_type ?? opportunity.opportunityType ?? "SCOUT"} · ${opportunity.recommendation}`
      : opportunity.opportunity_type ?? opportunity.opportunityType ?? "UNKNOWN";
  card.querySelector("[data-card-risk]").textContent = opportunity.risk_label ?? "UNKNOWN";
  const displayName = typeof nftMetadata.name === "string" && nftMetadata.name
    ? nftMetadata.name
    : collectionName;
  card.querySelector("[data-card-title]").textContent = displayName
    ? `${displayName} · #${token}`
    : `${String(collection).slice(0, 8)}… · #${token}`;
  card.querySelector("[data-card-signal]").textContent = opportunity.acquisition_mode
    ? `Recorded acquisition · ${opportunity.acquired_at ?? "time unavailable"}`
    : scoutSignal(opportunity);
  card.querySelector("[data-card-evidence]").textContent = collectionEvidenceSummary(metadata);
  if (opportunity.explanation) {
    card.querySelector("[data-card-evidence]").textContent = `${opportunity.explanation} ${card.querySelector("[data-card-evidence]").textContent}`;
  }
  if (mintDecision) {
    const reasons = opportunity.decision_detail?.mintInterest?.reasons ?? [];
    const detail = reasons.length ? reasons.join("; ") : "This Punk's configured mint checks passed";
    card.querySelector("[data-card-evidence]").textContent = `Mint view: ${detail}. ${card.querySelector("[data-card-evidence]").textContent}`;
  }
  card.querySelector("[data-score-art]").textContent =
    transparentScore(scores, analysisStatus, "artScore", "art");
  card.querySelector("[data-score-taste]").textContent =
    transparentScore(scores, analysisStatus, "tasteMatch", "taste");
  card.querySelector("[data-score-creator]").textContent =
    transparentScore(scores, analysisStatus, "creatorScore", "creator");
  card.querySelector("[data-score-market]").textContent =
    transparentScore(scores, analysisStatus, "marketScore", "market");
  card.querySelector("[data-score-liquidity]").textContent =
    transparentScore(scores, analysisStatus, "liquidityScore", "liquidity");
  card.querySelector("[data-score-collection]").textContent =
    transparentScore(scores, analysisStatus, "collectionScore", "collection");
  const artEvidence = transparentScore(
    scores,
    analysisStatus,
    "artConfidence",
    "art",
  );
  const marketEvidence = transparentScore(
    scores,
    analysisStatus,
    "marketConfidence",
    "market",
  );
  card.querySelector("[data-score-art-evidence]").textContent =
    artEvidence === "—" ? artEvidence : `${artEvidence}%`;
  card.querySelector("[data-score-market-evidence]").textContent =
    marketEvidence === "—" ? marketEvidence : `${marketEvidence}%`;
  const contractRisk = transparentScore(
    scores,
    analysisStatus,
    "contractRiskScore",
    "contract",
  );
  const evidenceCoverage = transparentScore(
    scores,
    analysisStatus,
    "contractRiskConfidence",
    "contract",
  );
  card.querySelector("[data-score-risk]").textContent =
    contractRisk === "—" ? contractRisk : `${contractRisk}/100`;
  card.querySelector("[data-score-evidence]").textContent =
    evidenceCoverage === "—" ? evidenceCoverage : `${evidenceCoverage}%`;
  renderCardArtwork(card, opportunity, token);
  return card;
}

async function loadOpportunities() {
  const grid = document.querySelector("[data-opportunities]");
  if (!grid) return;
  try {
    const response = await fetch("/api/broker/opportunities?limit=24", {
      headers: { accept: "application/json" },
    });
    const payload = await response.json();
    grid.replaceChildren();
    if (!payload.ok || !payload.opportunities?.length) {
      grid.innerHTML = '<p class="empty-state">Scout has not published any Robinhood discoveries yet.</p>';
      return;
    }
    payload.opportunities.forEach((opportunity) => grid.append(opportunityCard(opportunity)));
  } catch {
    grid.innerHTML = '<p class="empty-state">Scout data is temporarily unavailable. This discovery feed does not authorize transactions.</p>';
  }
}

function punkTokenId() {
  const pathMatch = window.location.pathname.match(/^\/punk\/(\d+)\/?$/);
  return pathMatch?.[1] ?? new URLSearchParams(window.location.search).get("tokenId") ?? "317";
}

function confirmedLiveAssetCard(asset) {
  const card = document.createElement("article");
  card.className = "panel live-acquisition-card";
  card.dataset.liveCanaryAsset = `${asset.collection}:${asset.tokenId}`;
  const badge = document.createElement("span");
  badge.className = "tag";
  badge.textContent = asset.executionMode === "AUTONOMOUS_FREE_MINT"
    ? "AUTONOMOUS · CONTAINED"
    : "CONFIRMED ONCHAIN";
  const title = document.createElement("h3");
  title.textContent = asset.name;
  const details = document.createElement("dl");
  for (const [label, value] of [
    ["Standard", asset.standard],
    ["Token ID", `#${asset.tokenId}`],
    ["Held by", asset.owner],
    ["Execution", asset.executionMode === "AUTONOMOUS_FREE_MINT"
      ? "Separate agent · zero-value free mint"
      : "Owner approved"],
  ]) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    row.append(term, description);
    details.append(row);
  }
  const explorer = document.createElement("a");
  explorer.className = "opensea-attribution";
  explorer.href = `https://robinhoodchain.blockscout.com/token/${asset.collection}/instance/${asset.tokenId}`;
  explorer.target = "_blank";
  explorer.rel = "noopener noreferrer";
  explorer.textContent = "View NFT on Blockscout ↗";
  const transaction = document.createElement("a");
  transaction.className = "opensea-attribution";
  transaction.target = "_blank";
  transaction.rel = "noopener noreferrer";
  transaction.href = asset.transactionHash
    ? `https://robinhoodchain.blockscout.com/tx/${asset.transactionHash}`
    : explorer.href;
  transaction.textContent = asset.transactionHash
    ? "View acquisition transaction ↗"
    : "View NFT transaction evidence ↗";
  const note = document.createElement("p");
  note.className = "locked-note";
  note.textContent = asset.executionMode === "AUTONOMOUS_FREE_MINT"
    ? "Minted by the separately authorized agent. Autonomy is now off, the agent is revoked, and this Punk policy is paused and disabled."
    : "Read directly from the verified canary NFT contract while indexer materialization catches up.";
  card.append(badge, title, details, explorer, transaction, note);
  return card;
}

let loadedPunkPayload = null;
let pendingLivePunkState = null;

function applyLivePunkState(liveState) {
  if (!liveState || liveState.status !== "LIVE_ONCHAIN") return;
  if (!loadedPunkPayload) {
    pendingLivePunkState = liveState;
    return;
  }
  publishOwnerSnapshot({ owner_snapshot: liveState.owner }, liveState.tokenId, "punk");
  document.querySelectorAll("[data-punk-account]").forEach((item) => {
    item.textContent = liveState.activated
      ? `Activated · ${liveState.account}`
      : "Not activated";
    item.title = liveState.activated ? liveState.account : "No live Punk Account found";
  });
  const gallery = document.querySelector("[data-gallery]");
  if (!gallery) return;
  const acquisitions = Array.isArray(loadedPunkPayload.acquisitions)
    ? loadedPunkPayload.acquisitions : [];
  const asset = liveState.canaryAsset;
  const indexed = asset && acquisitions.some((item) => (
    String(item.nft_collection_address ?? "").toLowerCase() === asset.collection
    && String(item.nft_token_id ?? "") === asset.tokenId
  ));
  gallery.querySelector("[data-live-canary-asset]")?.remove();
  gallery.querySelector(".empty-state")?.remove();
  if (asset && !indexed) gallery.prepend(confirmedLiveAssetCard(asset));
  if (!gallery.childElementCount) {
    gallery.innerHTML = '<p class="empty-state">No confirmed acquisitions were found on-chain or in the indexer.</p>';
  }
  const count = acquisitions.length + (asset && !indexed ? 1 : 0);
  document.querySelectorAll("[data-collected-count]").forEach((item) => {
    item.textContent = String(count);
  });
  document.querySelectorAll("[data-collected-detail]").forEach((item) => {
    item.textContent = asset ? "Includes live on-chain canary" : "Confirmed indexed assets";
  });
}

window.addEventListener("gogh:live-punk-state", (event) => {
  pendingLivePunkState = event?.detail ?? null;
  applyLivePunkState(pendingLivePunkState);
});

async function loadPunk() {
  const target = document.querySelector("[data-punk-page]");
  if (!target) return;
  const tokenId = punkTokenId();
  document.querySelectorAll("[data-punk-id]").forEach((item) => { item.textContent = tokenId; });
  try {
    const response = await fetch(`/api/punk/${encodeURIComponent(tokenId)}`, {
      headers: { accept: "application/json" },
    });
    const payload = await response.json();
    loadedPunkPayload = payload;
    const liveState = payload.liveState?.status === "LIVE_ONCHAIN" ? payload.liveState : null;
    publishOwnerSnapshot(liveState
      ? { owner_snapshot: liveState.owner }
      : payload.punk, tokenId, "punk");
    renderPunkArtwork(payload.identity?.artwork, tokenId);
    const account = liveState?.activated
      ? liveState.account
      : payload.punk?.account_address ?? null;
    document.querySelectorAll("[data-punk-account]").forEach((item) => {
      item.textContent = account ? `Activated · ${account}` : "Not activated";
      item.title = account ?? "No live Punk Account found";
    });
    const gallery = document.querySelector("[data-gallery]");
    if (gallery) {
      const acquisitions = Array.isArray(payload.acquisitions) ? payload.acquisitions : [];
      const liveAsset = liveState?.canaryAsset ?? null;
      const indexedLiveAsset = liveAsset && acquisitions.some((item) => (
        String(item.nft_collection_address ?? "").toLowerCase() === liveAsset.collection
        && String(item.nft_token_id ?? "") === liveAsset.tokenId
      ));
      gallery.replaceChildren();
      if (liveAsset && !indexedLiveAsset) gallery.append(confirmedLiveAssetCard(liveAsset));
      acquisitions.forEach((acquisition) => gallery.append(opportunityCard(acquisition)));
      if (!gallery.childElementCount) {
        gallery.innerHTML = '<p class="empty-state">No confirmed acquisitions were found on-chain or in the indexer.</p>';
      }
      const collectedCount = acquisitions.length + (liveAsset && !indexedLiveAsset ? 1 : 0);
      document.querySelectorAll("[data-collected-count]").forEach((item) => {
        item.textContent = String(collectedCount);
      });
      document.querySelectorAll("[data-collected-detail]").forEach((item) => {
        item.textContent = liveAsset ? "Includes live on-chain canary" : "Confirmed indexed assets";
      });
    }
    const recommendations = document.querySelector("[data-punk-recommendations]");
    const recommendationCount = payload.recommendations?.length ?? 0;
    document.querySelectorAll("[data-punk-recommendation-total]").forEach((item) => {
      item.textContent = recommendationCount ? `${recommendationCount} LATEST` : "EMPTY";
    });
    if (recommendations) {
      recommendations.innerHTML = payload.recommendations?.length
        ? ""
        : '<p class="empty-state">Scout recommendations are syncing. This recommendation feed does not authorize transactions.</p>';
      payload.recommendations?.forEach((recommendation) => {
        recommendations.append(opportunityCard(recommendation));
      });
    }
    const timeline = document.querySelector("[data-decisions]");
    if (timeline) {
      timeline.innerHTML = payload.decisions?.length
        ? ""
        : '<p class="empty-state">No Curator Journal entries have been indexed.</p>';
      payload.decisions?.forEach((decision) => {
        const item = document.createElement("article");
        item.className = "timeline-item";
        const time = document.createElement("time");
        time.textContent = decision.occurred_at ?? "Pending";
        if (decision.title) {
          const title = document.createElement("h3");
          title.textContent = decision.title;
          item.append(time, title);
        } else {
          item.append(time);
        }
        const description = document.createElement("p");
        description.textContent = decision.summary ?? decision.event_type ?? "SCOUT";
        item.append(description);
        const evidence = [
          ["Event", decision.event_type],
          ["Token", decision.nft_token_id ? `#${decision.nft_token_id}` : null],
          ["Policy", decision.policy_version],
          ["Nonce", decision.acquisition_nonce],
          ["Gas used", decision.gas_used],
        ].filter((entry) => entry[1] !== null && entry[1] !== undefined);
        if (evidence.length) {
          const list = document.createElement("dl");
          list.className = "journal-evidence";
          evidence.forEach(([label, value]) => {
            const row = document.createElement("div");
            const term = document.createElement("dt");
            const detail = document.createElement("dd");
            term.textContent = label;
            detail.textContent = String(value);
            row.append(term, detail);
            list.append(row);
          });
          item.append(list);
        }
        if (typeof decision.transaction_url === "string") {
          const link = document.createElement("a");
          link.className = "opensea-attribution";
          link.href = decision.transaction_url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "View transaction ↗";
          item.append(link);
        }
        timeline.append(item);
      });
    }
    if (pendingLivePunkState) applyLivePunkState(pendingLivePunkState);
  } catch {
    document.querySelectorAll("[data-punk-account]").forEach((item) => { item.textContent = "Indexer unavailable"; });
  }
}

document.querySelectorAll("[data-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

loadStatus();
loadOpportunities();
loadPunk();
