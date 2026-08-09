import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
} from "viem";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { getCaptureConfig, getRpcUrl, getSiteUrl } from "./config.mjs";

export class WalletVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WalletVerificationError";
    this.code = code;
  }
}

export function normalizeWalletAddress(value) {
  try {
    return getAddress(String(value)).toLowerCase();
  } catch {
    throw new WalletVerificationError(
      "INVALID_WALLET",
      "Connect a valid EVM wallet address.",
    );
  }
}

export function buildVerificationMessage({ walletAddress, discordUserId, requestId }) {
  const { chainId, signatureMinutes } = getCaptureConfig();
  const siteUrl = getSiteUrl();
  const now = new Date();
  const expirationTime = new Date(now.getTime() + signatureMinutes * 60_000);
  const nonce = generateSiweNonce();
  const message = createSiweMessage({
    address: getAddress(walletAddress),
    chainId,
    domain: new URL(siteUrl).host,
    expirationTime,
    issuedAt: now,
    nonce,
    requestId,
    resources: [`https://discord.com/users/${discordUserId}`],
    statement: "Sign in to Gogh Punks to capture one of 200 GTD allowlist spots. No transaction or approval is requested.",
    uri: `${siteUrl}/verify/`,
    version: "1",
  });
  return { nonce, message, expirationTime };
}

export async function verifyWalletSignature({ walletAddress, message, signature }) {
  if (
    !/^0x[0-9a-fA-F]+$/.test(signature) ||
    signature.length < 4 ||
    signature.length % 2 !== 0 ||
    signature.length > 10_000
  ) {
    throw new WalletVerificationError(
      "INVALID_SIGNATURE",
      "The wallet signature is not valid.",
    );
  }
  const rpcUrl = getRpcUrl();
  const chain = defineChain({
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: {
      default: {
        name: "Robinhood Chain Blockscout",
        url: "https://robinhoodchain.blockscout.com",
      },
    },
  });
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const valid = await client.verifyMessage({
    address: getAddress(walletAddress),
    message,
    signature,
  });
  if (!valid) {
    throw new WalletVerificationError(
      "INVALID_SIGNATURE",
      "That signature does not match the connected wallet.",
    );
  }
  return true;
}
