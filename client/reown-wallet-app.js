import { createAppKit } from "@reown/appkit";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { defineChain } from "@reown/appkit/networks";

const ROBINHOOD = defineChain({
  id: 4663,
  caipNetworkId: "eip155:4663",
  chainNamespace: "eip155",
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Blockscout",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
});

function projectId(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{32}$/.test(value)) {
    throw new TypeError("Reown wallet connection is not configured.");
  }
  return value;
}

export function createReownWalletSession(configuration = {}) {
  const id = projectId(configuration.projectId);
  const metadataUrl = new URL(configuration.metadataUrl ?? window.location.origin);
  if (!["https:", "http:"].includes(metadataUrl.protocol)) {
    throw new TypeError("The wallet metadata origin is invalid.");
  }
  const appKit = createAppKit({
    adapters: [new EthersAdapter()],
    networks: [ROBINHOOD],
    defaultNetwork: ROBINHOOD,
    projectId: id,
    metadata: {
      name: "Gogh Punks Art Broker",
      description: "Owner-controlled autonomous art curation on Robinhood Chain",
      url: metadataUrl.origin,
      icons: [`${metadataUrl.origin}/assets/gogh-punks-pfp.png`],
    },
    features: {
      analytics: false,
      email: false,
      socials: false,
      swaps: false,
      onramp: false,
      history: false,
    },
    enableWallets: true,
    allWallets: "SHOW",
    enableNetworkSwitch: true,
  });

  return Object.freeze({
    appKit,
    network: ROBINHOOD,
    ready: () => appKit.ready(),
    open: () => appKit.open(),
    openAccount: () => appKit.open({ view: "Account" }),
    openNetwork: () => appKit.open({ view: "Networks" }),
    close: () => appKit.close(),
    switchNetwork: () => appKit.switchNetwork(ROBINHOOD, { throwOnFailure: true }),
    disconnect: () => appKit.disconnect("eip155"),
    getAccount: () => appKit.getAccount("eip155"),
    getNetwork: () => ({ chainId: appKit.getChainId() }),
    // AppKit exposes the active EVM provider through getWalletProvider().
    // getProviders() is not part of the public AppKit client API and calling it
    // leaves the modal mounted while the surrounding session initialization fails.
    getProvider: () => appKit.getWalletProvider() ?? null,
    getError: () => appKit.getError(),
    subscribeAccount: (callback) => appKit.subscribeAccount(callback, "eip155"),
    subscribeNetwork: (callback) => appKit.subscribeNetwork(callback),
    subscribeProvider: (callback) => appKit.subscribeProviders((providers) => {
      callback(providers?.eip155 ?? null);
    }),
    subscribeState: (callback) => appKit.subscribeState(callback),
  });
}

globalThis.GoghReownWallet = Object.freeze({ createReownWalletSession });
