const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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
    statusTargets.forEach((target) => {
      target.textContent = payload.protocol?.deploymentStatus === "NOT_DEPLOYED"
        ? "LOCAL FOUNDATION · NOT DEPLOYED"
        : String(payload.protocol?.deploymentStatus ?? "UNAVAILABLE");
      target.classList.remove("loading");
    });
    document.querySelectorAll("[data-autonomy-status]").forEach((target) => {
      target.textContent = payload.autonomyStatus ?? "DISABLED";
    });
  } catch {
    statusTargets.forEach((target) => {
      target.textContent = "STATUS UNAVAILABLE";
      target.classList.remove("loading");
    });
  }
}

function opportunityCard(opportunity) {
  const scores = opportunity.scores ?? {};
  const metadata = opportunity.metadata ?? {};
  const analysisStatus = metadata.analysisStatus ?? null;
  const card = document.createElement("article");
  card.className = "opportunity-card";
  const collection = opportunity.collection_address ?? opportunity.collection ?? "Unknown collection";
  const collectionName = metadata.collectionSignals?.identity?.name;
  const token = opportunity.token_id ?? opportunity.tokenId ?? "—";
  card.innerHTML = `
    <div class="art-placeholder" aria-hidden="true">ART PREVIEW PENDING</div>
    <div class="card-body">
      <div class="card-meta"><span data-card-type></span><span data-card-risk></span></div>
      <h3 data-card-title></h3>
      <p class="signal-note" data-card-signal></p>
      <p class="evidence-note" data-card-evidence></p>
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
      <p class="locked-note">Scout data only. Acquisition controls are disabled.</p>
    </div>`;
  card.querySelector("[data-card-type]").textContent =
    opportunity.opportunity_type ?? opportunity.opportunityType ?? "UNKNOWN";
  card.querySelector("[data-card-risk]").textContent = opportunity.risk_label ?? "UNKNOWN";
  card.querySelector("[data-card-title]").textContent = collectionName
    ? `${collectionName} · #${token}`
    : `${String(collection).slice(0, 8)}… · #${token}`;
  card.querySelector("[data-card-signal]").textContent = scoutSignal(opportunity);
  card.querySelector("[data-card-evidence]").textContent = collectionEvidenceSummary(metadata);
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
      grid.innerHTML = '<p class="empty-state">The Scout index is staged but has not published any Robinhood discoveries yet.</p>';
      return;
    }
    payload.opportunities.forEach((opportunity) => grid.append(opportunityCard(opportunity)));
  } catch {
    grid.innerHTML = '<p class="empty-state">Scout data is temporarily unavailable. No transaction capability is active.</p>';
  }
}

function punkTokenId() {
  const pathMatch = window.location.pathname.match(/^\/punk\/(\d+)\/?$/);
  return pathMatch?.[1] ?? new URLSearchParams(window.location.search).get("tokenId") ?? "317";
}

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
    const account = payload.punk?.account_address ?? "Not activated";
    document.querySelectorAll("[data-punk-account]").forEach((item) => { item.textContent = account; });
    const gallery = document.querySelector("[data-gallery]");
    if (gallery) {
      gallery.innerHTML = payload.acquisitions?.length
        ? ""
        : '<p class="empty-state">No indexed acquisitions yet. This gallery is read-only until the canary foundation is deployed and validated.</p>';
      payload.acquisitions?.forEach((acquisition) => gallery.append(opportunityCard(acquisition)));
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
        const description = document.createElement("p");
        description.textContent = decision.event_type ?? "SCOUT";
        item.append(time, description);
        timeline.append(item);
      });
    }
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
