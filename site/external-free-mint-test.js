const EXPECTED_SCHEMA = "GOGH_EXTERNAL_FREE_MINT_SITE_STATUS_V1";
const ADDRESS = /^0x[0-9a-f]{40}$/;
const PUNK_TOKEN_ID = /^(0|[1-9]\d{0,3})$/;

function own(record, key) {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

function text(target, value) {
  if (target) target.textContent = value;
}

function field(root, name, value) {
  text(root.querySelector(`[data-external-mint-field="${name}"]`), value);
}

function validHttps(value, hostname) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === hostname && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function normalizeExternalFreeMintStatus(payload) {
  const status = own(payload, "externalFreeMintTest");
  const candidate = own(status, "candidate");
  const controls = own(status, "controls");
  const readiness = own(status, "readiness");
  const result = own(status, "result");
  if (
    own(status, "schema") !== EXPECTED_SCHEMA
    || !PUNK_TOKEN_ID.test(own(status, "punkTokenId"))
    || own(status, "executionEnabled") !== false
    || !ADDRESS.test(own(status, "account"))
    || !ADDRESS.test(own(status, "agent"))
    || !ADDRESS.test(own(candidate, "collection"))
    || !ADDRESS.test(own(candidate, "venue"))
    || own(candidate, "opportunityType") !== "FREE_MINT"
    || own(candidate, "assetStandard") !== "ERC721"
    || own(candidate, "quantity") !== "1"
    || own(candidate, "mintPriceWei") !== "0"
    || own(candidate, "verification") !== "UNVERIFIED_COLLECTION"
    || own(controls, "nativeValueWei") !== "0"
    || own(controls, "tokenQuantity") !== "1"
    || own(controls, "opaqueAdapterDataAllowed") !== false
    || own(controls, "tokenApprovalsAllowed") !== false
    || own(controls, "arbitraryTargetsAllowed") !== false
    || own(controls, "genericMintPermissionAllowed") !== false
    || own(controls, "containImmediatelyAfterRun") !== true
    || typeof readiness !== "object"
    || (own(status, "status") === "COMPLETED_AND_CONTAINED" && (
      !ADDRESS.test(own(result, "nftOwner"))
      || !/^\d+$/.test(own(result, "tokenId"))
      || !/^0x[0-9a-f]{64}$/.test(own(result, "transactionHash"))
      || own(result, "nftOwner") !== own(status, "account")
    ))
  ) throw new Error("INVALID_EXTERNAL_MINT_STATUS");
  const openSeaUrl = validHttps(own(candidate, "openSeaUrl"), "opensea.io");
  if (!openSeaUrl) throw new Error("INVALID_EXTERNAL_MINT_LINK");
  return Object.freeze({ status, candidate, controls, readiness, result, openSeaUrl });
}

function renderProgress(root, readiness) {
  const steps = [
    ["Adapter reviewed", own(readiness, "reviewedAdapterSource")],
    ["Adapter deployed", own(readiness, "adapterDeployed")],
    ["Owner mandate armed", own(readiness, "ownerMandateArmed")],
    ["Agent authorized", own(readiness, "agentAuthorized")],
    ["Autonomy enabled", own(readiness, "autonomousMintFeatureEnabled")],
    ["Exact run prepared", own(readiness, "exactExecutionPrepared")],
    ["One mint executed", own(readiness, "executionCompleted")],
    ["Contained again", own(readiness, "containmentCompleted")],
  ];
  root.replaceChildren(...steps.map(([label, complete]) => {
    const item = document.createElement("span");
    item.className = `external-mint-step ${complete === true ? "complete" : "pending"}`;
    item.textContent = `${complete === true ? "✓" : "○"} ${label}`;
    return item;
  }));
}

export function renderExternalFreeMintStatus(root, normalized) {
  const { status, candidate, controls, readiness, result, openSeaUrl } = normalized;
  text(root.querySelector("[data-external-mint-name]"), own(candidate, "name"));
  const badge = root.querySelector("[data-external-mint-state]");
  text(badge, own(status, "status").replaceAll("_", " "));
  badge.classList.toggle("off", own(status, "executionEnabled") !== true);
  field(root, "punk", `#${own(status, "punkTokenId")}`);
  field(root, "agent", own(status, "agent"));
  field(root, "account", own(status, "account"));
  field(root, "collection", own(candidate, "collection"));
  field(root, "venue", own(candidate, "venue"));
  field(root, "economics", "0 ETH · 1 ERC-721 · no approvals");
  field(root, "supply", result
    ? `Minted token #${own(result, "tokenId")} at block ${own(result, "blockNumber")}`
    : `${own(candidate, "observedSupply")} / ${own(candidate, "maximumSupply")} at ${own(candidate, "observedAt")} · expected token ${own(candidate, "observedNextTokenId")}`);
  field(root, "risk", `${own(candidate, "verification")} · ${own(candidate, "openSeaSafetySnapshot")}`);
  field(root, "runner", own(status, "executionMode").replaceAll("_", " "));
  field(root, "containment", controls.containImmediatelyAfterRun
    ? "Disable autonomy, revoke agent, pause account, and return to DISABLED immediately"
    : "INVALID");
  text(root.querySelector("[data-external-mint-warning]"), own(status, "notice"));
  const link = root.querySelector("[data-external-mint-opensea]");
  link.href = openSeaUrl;
  const transaction = root.querySelector("[data-external-mint-transaction]");
  if (transaction && result) {
    transaction.hidden = false;
    transaction.href = `https://robinhoodchain.blockscout.com/tx/${own(result, "transactionHash")}`;
  }
  renderProgress(root.querySelector("[data-external-mint-progress]"), readiness);
  const run = root.querySelector("[data-external-mint-run]");
  run.disabled = own(status, "executionEnabled") !== true;
  if (result) run.textContent = "Mint complete · contained";
}

async function boot() {
  const root = document.querySelector("[data-external-free-mint-test]");
  if (!root) return;
  const routeToken = location.pathname.match(/^\/punk\/(\d+)\/?$/)?.[1];
  try {
    const response = await fetch("/api/broker/status", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("STATUS_UNAVAILABLE");
    const normalized = normalizeExternalFreeMintStatus(await response.json());
    if (routeToken !== normalized.status.punkTokenId) return;
    root.hidden = false;
    renderExternalFreeMintStatus(root, normalized);
  } catch {
    text(root.querySelector("[data-external-mint-state]"), "LOCKED · status unavailable");
    text(root.querySelector("[data-external-mint-warning]"), "The reviewed external-mint state could not be verified. No execution is available.");
  }
}

if (typeof document !== "undefined") boot();
