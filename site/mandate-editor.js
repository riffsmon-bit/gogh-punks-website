const CHAIN_ID = 4663;
const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const DIMENSIONS = [
  "pixelArt",
  "generativeArt",
  "oneOfOne",
  "emergingArtists",
  "onChainArt",
  "experimentalNFTs",
];

function integer(input) {
  const value = Number(input.value);
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new TypeError("A preference value is invalid.");
  }
  return value;
}

function currentMandate(form, tokenId) {
  if (typeof tokenId !== "string" || !/^(0|[1-9]\d{0,3})$/.test(tokenId)) {
    throw new TypeError("Choose a wallet-owned Punk before editing its mandate.");
  }
  const element = (name) => {
    const target = form.elements.namedItem(name);
    if (!target) throw new TypeError(`Missing mandate field ${name}`);
    return target;
  };
  return {
    chainId: CHAIN_ID,
    collection: COLLECTION,
    tokenId,
    mode: element("mode").value,
    economicSettings: {
      inspectMints: element("inspectMints").checked,
      allowFreeMints: element("allowFreeMints").checked,
      maxMintsPerDay: integer(element("maxMintsPerDay")),
    },
    riskSettings: {
      unknownMintMode: element("unknownMintMode").value,
      maxContractRiskScore: integer(element("maxContractRiskScore")),
    },
    artisticPreferences: {
      minimumTasteMatch: integer(element("minimumTasteMatch")),
      dimensions: Object.fromEntries(DIMENSIONS.map((name) => [name, integer(element(name))])),
    },
  };
}

async function responseJson(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The mandate service returned an unreadable response.");
  }
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.message ?? "The mandate request was rejected.");
  }
  return payload;
}

function applyMandate(form, mandate) {
  if (!mandate) return;
  for (const [name, value] of [
    ["mode", mandate.mode],
    ["maxMintsPerDay", mandate.economicSettings?.maxMintsPerDay],
    ["unknownMintMode", mandate.riskSettings?.unknownMintMode],
    ["maxContractRiskScore", mandate.riskSettings?.maxContractRiskScore],
    ["minimumTasteMatch", mandate.artisticPreferences?.minimumTasteMatch],
    ...DIMENSIONS.map((name) => [name, mandate.artisticPreferences?.dimensions?.[name]]),
  ]) {
    const target = form.elements.namedItem(name);
    if (target && value !== undefined && value !== null) target.value = String(value);
  }
  for (const [name, value] of [
    ["inspectMints", mandate.economicSettings?.inspectMints],
    ["allowFreeMints", mandate.economicSettings?.allowFreeMints],
  ]) {
    const target = form.elements.namedItem(name);
    if (target && typeof value === "boolean") target.checked = value;
  }
}

export function setupMandateEditor({ windowObject, documentObject, fetchFunction } = {}) {
  const browserWindow = windowObject ?? (typeof window === "undefined" ? null : window);
  const browserDocument = documentObject ?? (typeof document === "undefined" ? null : document);
  const request = fetchFunction ?? browserWindow?.fetch?.bind(browserWindow);
  const form = browserDocument?.querySelector("[data-mandate-form]");
  if (!browserWindow || !browserDocument || !form || typeof request !== "function") return null;
  const provider = browserWindow.ethereum;
  const save = browserDocument.querySelector("[data-mandate-save]");
  const stateTarget = browserDocument.querySelector("[data-mandate-state]");
  const badge = browserDocument.querySelector("[data-mandate-badge]");
  const summary = browserDocument.querySelector("[data-mandate-summary]");
  const heading = browserDocument.querySelector("[data-mandate-punk-heading]");
  let wallet = browserWindow.__GOGH_WALLET_SNAPSHOT__ ?? null;
  let pending = false;
  let version = null;
  let selectedTokenId = null;
  let selectionOwner = null;
  let loadRevision = 0;

  function ownerReady() {
    return Boolean(provider?.request
      && wallet?.chainId === CHAIN_ID
      && /^0x[0-9a-fA-F]{40}$/.test(wallet?.account ?? "")
      && selectedTokenId !== null
      && selectionOwner === wallet.account.toLowerCase());
  }

  function render(message = null, status = null) {
    const ready = ownerReady();
    save.disabled = pending || !ready;
    save.textContent = pending
      ? "Waiting for wallet…"
      : ready
        ? "Sign & save preference only"
        : selectedTokenId ? `Connect Punk #${selectedTokenId} owner to save` : "Choose one of your Punks";
    badge.textContent = version === null
      ? (ready ? "Owner ready" : selectedTokenId ? "Owner check required" : "Choose Punk")
      : `Saved v${version}`;
    badge.classList.toggle("off", version === null && !ready);
    if (message) stateTarget.textContent = message;
    stateTarget.dataset.mandateStatus = status ?? (ready ? "ready" : "locked");
  }

  function syncOutputs() {
    const mode = form.elements.namedItem("mode");
    if (mode?.value === "AUTONOMOUS") {
      form.elements.namedItem("inspectMints").checked = true;
      form.elements.namedItem("allowFreeMints").checked = true;
      const dailyLimit = form.elements.namedItem("maxMintsPerDay");
      if (dailyLimit.value === "0") dailyLimit.value = "1";
    }
    for (const output of browserDocument.querySelectorAll("[data-mandate-value]")) {
      const input = form.elements.namedItem(output.dataset.mandateValue);
      if (input) output.value = input.value;
    }
    if (summary) {
      if (!selectedTokenId) {
        summary.textContent = "Choose a live-verified Punk above to load or create its own Art Mandate.";
        return;
      }
      const selected = currentMandate(form, selectedTokenId);
      const action = selected.mode === "DISABLED"
        ? "Scout will ignore mint opportunities for this Punk."
        : !selected.economicSettings.inspectMints
          ? "Scout will not inspect mint opportunities."
          : selected.mode === "APPROVAL_REQUIRED"
            && selected.economicSettings.allowFreeMints
            && selected.economicSettings.maxMintsPerDay === 1
            ? "Scout may recommend one free mint per day for your review. You must still approve every mint in your wallet."
            : selected.mode === "AUTONOMOUS"
              && selected.economicSettings.inspectMints
              && selected.economicSettings.allowFreeMints
              && selected.economicSettings.maxMintsPerDay >= 1
              ? `You are requesting at most ${selected.economicSettings.maxMintsPerDay} autonomous free ${selected.economicSettings.maxMintsPerDay === 1 ? "mint" : "mints"} per day. Saving this preference does not arm the contracts; each target adapter, the owner policy, guardian feature gate, and short-lived agent authorization must still pass on-chain.`
            : "Scout can research mint opportunities and show them to you, but it cannot prepare or submit a mint.";
      summary.textContent = selected.mode === "AUTONOMOUS"
        ? `${action} Paid mints, unknown-collection execution, approvals, and selling stay disabled.`
        : `${action} Paid mints and autonomous execution stay disabled.`;
    }
  }

  async function load(tokenId) {
    const current = ++loadRevision;
    try {
      const payload = await responseJson(await request(
        `/api/broker/mandate?tokenId=${encodeURIComponent(tokenId)}`, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      }));
      if (current !== loadRevision || selectedTokenId !== tokenId) return;
      if (String(payload.tokenId) !== tokenId) throw new Error("The mandate response belongs to another Punk.");
      if (payload.mandate) {
        if (String(payload.mandate.tokenId) !== tokenId) {
          throw new Error("The saved mandate belongs to another Punk.");
        }
        applyMandate(form, payload.mandate);
        version = payload.mandate.version;
        render(`Saved version ${version} is loaded for Punk #${tokenId}. It is a preference only; no agent was started.`, "saved");
      } else {
        render("No owner-signed mandate is saved yet. The conservative Scout defaults are shown.");
      }
      syncOutputs();
    } catch (error) {
      if (current !== loadRevision || selectedTokenId !== tokenId) return;
      render(error.message, "error");
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!ownerReady() || pending) return;
    pending = true;
    render("Preparing an owner-only preference signature…", "pending");
    const expectedAccount = wallet.account.toLowerCase();
    const expectedTokenId = selectedTokenId;
    try {
      const prepared = await responseJson(await request("/api/broker/mandate", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          walletAddress: expectedAccount,
          mandate: currentMandate(form, expectedTokenId),
        }),
      }));
      const signature = await provider.request({
        method: "personal_sign",
        params: [prepared.message, expectedAccount],
      });
      const [accounts, chainHex] = await Promise.all([
        provider.request({ method: "eth_accounts" }),
        provider.request({ method: "eth_chainId" }),
      ]);
      if (!Array.isArray(accounts) || accounts[0]?.toLowerCase() !== expectedAccount
        || Number.parseInt(chainHex, 16) !== CHAIN_ID
        || selectedTokenId !== expectedTokenId) {
        throw new Error("Wallet account or network changed before the preference was saved.");
      }
      const completed = await responseJson(await request("/api/broker/mandate", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          challengeId: prepared.challengeId,
          walletAddress: expectedAccount,
          signature,
        }),
      }));
      version = completed.mandate.version;
      applyMandate(form, completed.mandate);
      syncOutputs();
      render(
        completed.mandate.autonomyRequested
          ? `Saved version ${version} for Punk #${expectedTokenId}. Preference saved only: no agent was started and no transaction was sent. Agent automation remains off until a separate on-chain setup is completed.`
          : `Saved version ${version} for Punk #${expectedTokenId}. Scout may use this preference on a later run; no agent was started and no transaction was sent.`,
        "saved",
      );
    } catch (error) {
      render(error?.message ?? "The preference signature was cancelled or rejected.", "error");
    } finally {
      pending = false;
      render();
    }
  }

  function walletChanged(event) {
    wallet = event?.detail ?? null;
    if (!wallet?.account || wallet.account.toLowerCase() !== selectionOwner) {
      selectedTokenId = null;
      selectionOwner = null;
      version = null;
      loadRevision += 1;
      if (heading) heading.textContent = "Select a Punk";
    }
    render();
  }

  function punkSelected(event) {
    const tokenId = String(event?.detail?.tokenId ?? "");
    const owner = String(event?.detail?.owner ?? "").toLowerCase();
    if (!/^(0|[1-9]\d{0,3})$/.test(tokenId)
      || !ownerReadyForSelection(owner)) return;
    selectedTokenId = tokenId;
    selectionOwner = owner;
    version = null;
    form.reset?.();
    if (heading) heading.textContent = `Punk #${tokenId}`;
    render(`Loading Punk #${tokenId}'s saved preferences…`, "pending");
    syncOutputs();
    load(tokenId);
  }

  function ownerReadyForSelection(owner) {
    return wallet?.chainId === CHAIN_ID
      && /^0x[0-9a-f]{40}$/.test(owner)
      && wallet?.account?.toLowerCase() === owner;
  }

  form.addEventListener("input", syncOutputs);
  form.addEventListener("submit", submit);
  browserWindow.addEventListener("gogh:wallet-state", walletChanged);
  browserWindow.addEventListener("gogh:mandate-punk-selected", punkSelected);
  render();
  syncOutputs();
  return Object.freeze({
    currentMandate: () => selectedTokenId ? currentMandate(form, selectedTokenId) : null,
    destroy() {
      form.removeEventListener("input", syncOutputs);
      form.removeEventListener("submit", submit);
      browserWindow.removeEventListener("gogh:wallet-state", walletChanged);
      browserWindow.removeEventListener("gogh:mandate-punk-selected", punkSelected);
    },
  });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupMandateEditor();
}
