import { keccak256Hex } from "./keccak256.js";

const CHAIN_ID = 4663;
const OWNER_OF = "0x6352211e";
const ACCOUNT = "0x2dd7c658";
const MINTED = "0x4f02c420";

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function decodedAddress(value) {
  return typeof value === "string" && /^0x0{24}[0-9a-fA-F]{40}$/.test(value)
    ? `0x${value.slice(-40)}`.toLowerCase()
    : null;
}

async function rpc(provider, method, params = []) {
  return provider.request({ method, params });
}

export async function readBrowserPunkDisplay(provider, status, tokenId) {
  if (!provider?.request || status?.protocol?.deploymentStatus !== "DEPLOYED") return null;
  const chain = await rpc(provider, "eth_chainId");
  if (BigInt(chain) !== BigInt(CHAIN_ID)) return null;
  const idWord = word(tokenId);
  const [ownerRaw, accountRaw] = await Promise.all([
    rpc(provider, "eth_call", [{ to: status.chain.canonicalCollection,
      data: `${OWNER_OF}${idWord}` }, "latest"]),
    rpc(provider, "eth_call", [{ to: status.protocol.accountRegistry,
      data: `${ACCOUNT}${idWord}` }, "latest"]),
  ]);
  const owner = decodedAddress(ownerRaw);
  const account = decodedAddress(accountRaw);
  if (!owner || !account) return null;
  const code = await rpc(provider, "eth_getCode", [account, "latest"]);
  const activated = typeof code === "string" && code !== "0x";
  let canaryAsset = null;
  const external = status.externalFreeMintTest;
  if (activated && external?.status === "COMPLETED_AND_CONTAINED"
    && external.punkTokenId === tokenId && external.account === account
    && external.result?.nftOwner === account) {
    const runtime = await rpc(provider, "eth_getCode", [external.candidate.collection, "latest"]);
    if (keccak256Hex(runtime).toLowerCase()
      === external.candidate.collectionRuntimeCodeHash.toLowerCase()) {
      const assetOwnerRaw = await rpc(provider, "eth_call", [{ to: external.candidate.collection,
        data: `${OWNER_OF}${word(external.result.tokenId)}` }, "latest"]);
      if (decodedAddress(assetOwnerRaw) === account) {
        canaryAsset = Object.freeze({
          status: "CONFIRMED_ONCHAIN",
          collection: external.candidate.collection,
          tokenId: external.result.tokenId,
          owner: account,
          name: `${external.candidate.name} #${external.result.tokenId}`,
          standard: "ERC721",
          executionMode: external.executionMode,
          transactionHash: external.result.transactionHash,
          containment: external.result.containment,
        });
      }
    }
  }
  const canary = [status.canaryDisplay, status.autonomousCanaryDisplay].find((candidate) => (
    candidate && ["DEPLOYED", "COMPLETED_AND_CONTAINED"].includes(candidate.status)
      && candidate.punkTokenId === tokenId && candidate.account === account
  ));
  if (activated && !canaryAsset && canary) {
    if (canary.runtimeCodeHash) {
      const runtime = await rpc(provider, "eth_getCode", [canary.collection, "latest"]);
      if (keccak256Hex(runtime).toLowerCase() !== canary.runtimeCodeHash.toLowerCase()) {
        return Object.freeze({ status: "LIVE_ONCHAIN", tokenId, owner, account, activated,
          canaryAsset: null });
      }
    }
    const mintedRaw = await rpc(provider, "eth_call", [{ to: canary.collection, data: MINTED },
      "latest"]);
    if (BigInt(mintedRaw) === 1n) {
      const assetOwnerRaw = await rpc(provider, "eth_call", [{ to: canary.collection,
        data: `${OWNER_OF}${word(canary.tokenId)}` }, "latest"]);
      if (decodedAddress(assetOwnerRaw) === account) {
        canaryAsset = Object.freeze({
          status: "CONFIRMED_ONCHAIN",
          collection: canary.collection,
          tokenId: canary.tokenId,
          owner: account,
          name: canary.executionMode === "AUTONOMOUS_FREE_MINT"
            ? `Gogh Autonomous Canary #${canary.tokenId}`
            : `Gogh One-Shot Canary #${canary.tokenId}`,
          standard: "ERC721",
          executionMode: canary.executionMode ?? "OWNER_APPROVED_FREE_MINT",
          transactionHash: canary.transactionHash ?? null,
          containment: canary.containment ?? null,
        });
      }
    }
  }
  return Object.freeze({ status: "LIVE_ONCHAIN", tokenId, owner, account, activated,
    canaryAsset });
}

export function setupLivePunkDisplay({ windowObject, fetchFunction } = {}) {
  const browserWindow = windowObject ?? (typeof window === "undefined" ? null : window);
  if (!browserWindow) return null;
  const request = fetchFunction ?? browserWindow.fetch.bind(browserWindow);
  const match = browserWindow.location.pathname.match(/^\/punk\/(\d+)\/?$/);
  if (!match) return null;
  let status = null;
  let revision = 0;
  async function refresh(event) {
    const current = ++revision;
    const wallet = event?.detail ?? browserWindow.__GOGH_WALLET_SNAPSHOT__;
    if (!wallet?.account || wallet.chainId !== CHAIN_ID) return;
    try {
      if (!status) {
        const response = await request("/api/broker/status", {
          headers: { accept: "application/json" }, cache: "no-store",
        });
        status = await response.json();
      }
      const liveState = await readBrowserPunkDisplay(
        browserWindow.__GOGH_WALLET_PROVIDER__, status, match[1],
      );
      if (current !== revision || !liveState) return;
      browserWindow.dispatchEvent(new browserWindow.CustomEvent("gogh:live-punk-state", {
        detail: liveState,
      }));
    } catch {
      // Indexed display remains available; no live state is inferred on failure.
    }
  }
  browserWindow.addEventListener("gogh:wallet-state", refresh);
  refresh({ detail: browserWindow.__GOGH_WALLET_SNAPSHOT__ });
  return Object.freeze({ refresh });
}

if (typeof window !== "undefined") setupLivePunkDisplay({ windowObject: window });
