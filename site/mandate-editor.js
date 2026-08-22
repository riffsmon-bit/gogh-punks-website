const CHAIN_ID = 4663;
const COLLECTION = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const TOKEN_ID = "1797";
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

function currentMandate(form) {
  const element = (name) => {
    const target = form.elements.namedItem(name);
    if (!target) throw new TypeError(`Missing mandate field ${name}`);
    return target;
  };
  return {
    chainId: CHAIN_ID,
    collection: COLLECTION,
    tokenId: TOKEN_ID,
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
  let wallet = browserWindow.__GOGH_WALLET_SNAPSHOT__ ?? null;
  let pending = false;
  let version = null;

  function ownerReady() {
    return Boolean(provider?.request
      && wallet?.status === "owner"
      && wallet?.chainId === CHAIN_ID
      && /^0x[0-9a-fA-F]{40}$/.test(wallet?.account ?? ""));
  }

  function render(message = null, status = null) {
    const ready = ownerReady();
    save.disabled = pending || !ready;
    save.textContent = pending
      ? "Waiting for wallet…"
      : ready
        ? "Sign and save preferences"
        : `Connect Punk #${TOKEN_ID} owner to save`;
    badge.textContent = version === null ? (ready ? "Owner ready" : "Connect owner") : `Saved v${version}`;
    badge.classList.toggle("off", version === null && !ready);
    if (message) stateTarget.textContent = message;
    stateTarget.dataset.mandateStatus = status ?? (ready ? "ready" : "locked");
  }

  function syncOutputs() {
    for (const output of browserDocument.querySelectorAll("[data-mandate-value]")) {
      const input = form.elements.namedItem(output.dataset.mandateValue);
      if (input) output.value = input.value;
    }
    if (summary) {
      const selected = currentMandate(form);
      const action = selected.mode === "DISABLED"
        ? "Scout will ignore mint opportunities for this Punk."
        : !selected.economicSettings.inspectMints
          ? "Scout will not inspect mint opportunities."
          : selected.mode === "APPROVAL_REQUIRED"
            && selected.economicSettings.allowFreeMints
            && selected.economicSettings.maxMintsPerDay === 1
            ? "Scout may recommend one free mint per day for your review. You must still approve every mint in your wallet."
            : "Scout can research mint opportunities and show them to you, but it cannot prepare or submit a mint.";
      summary.textContent = `${action} Paid mints and autonomous execution stay disabled.`;
    }
  }

  async function load() {
    try {
      const payload = await responseJson(await request("/api/broker/mandate", {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      }));
      if (payload.mandate) {
        applyMandate(form, payload.mandate);
        version = payload.mandate.version;
        render(`Saved version ${version} is loaded. Connect the current owner to update it.`, "saved");
      } else {
        render("No owner-signed mandate is saved yet. The conservative Scout defaults are shown.");
      }
      syncOutputs();
    } catch (error) {
      render(error.message, "error");
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!ownerReady() || pending) return;
    pending = true;
    render("Preparing an owner-only preference signature…", "pending");
    const expectedAccount = wallet.account.toLowerCase();
    try {
      const prepared = await responseJson(await request("/api/broker/mandate", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          walletAddress: expectedAccount,
          mandate: currentMandate(form),
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
        || Number.parseInt(chainHex, 16) !== CHAIN_ID) {
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
      render(`Saved version ${version}. Scout will use it on its next run. No transaction was sent.`, "saved");
    } catch (error) {
      render(error?.message ?? "The preference signature was cancelled or rejected.", "error");
    } finally {
      pending = false;
      render();
    }
  }

  function walletChanged(event) {
    wallet = event?.detail ?? null;
    render();
  }

  form.addEventListener("input", syncOutputs);
  form.addEventListener("submit", submit);
  browserWindow.addEventListener("gogh:wallet-state", walletChanged);
  render();
  load();
  return Object.freeze({
    currentMandate: () => currentMandate(form),
    destroy() {
      form.removeEventListener("input", syncOutputs);
      form.removeEventListener("submit", submit);
      browserWindow.removeEventListener("gogh:wallet-state", walletChanged);
    },
  });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setupMandateEditor();
}
