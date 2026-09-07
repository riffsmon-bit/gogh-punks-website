import { createPublicClient, defineChain, http, parseAbi } from "viem";
import { ROBINHOOD } from "../../../broker/src/config.mjs";
import automationManifest from "../../../deployments/robinhood-automation-v3.json" with { type: "json" };
import { PublicError } from "./http.mjs";
import { getRpcUrl } from "./config.mjs";
import { normalizeWalletAddress } from "./verification.mjs";

const OWNER_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);
const REGISTRY_ABI = parseAbi([
  "function account(uint256 tokenId) view returns (address)",
  "function isAccountCreated(uint256 tokenId) view returns (bool)",
]);
const TOKEN = /^(?:0|[1-9]\d{0,3})$/;

function rpcClient() {
  const rpcUrl = getRpcUrl();
  const chain = defineChain({ id: ROBINHOOD.chainId, name: ROBINHOOD.name,
    nativeCurrency: ROBINHOOD.nativeCurrency, rpcUrls: { default: { http: [rpcUrl] } } });
  return createPublicClient({ chain, transport: http(rpcUrl, { timeout: 8_000, retryCount: 1 }) });
}

export async function readV2PunkAuthority(tokenId, { expectedOwner = null,
  client = rpcClient(), registry = automationManifest.contracts.GoghPunkAccountRegistryV3.address } = {}) {
  if (typeof tokenId !== "string" || !TOKEN.test(tokenId)) {
    throw new PublicError(400, "INVALID_TOKEN_ID", "Choose a valid Gogh Punk.");
  }
  const normalizedExpected = expectedOwner === null ? null : normalizeWalletAddress(expectedOwner);
  if (expectedOwner !== null && !normalizedExpected) throw new PublicError(400, "INVALID_WALLET", "Choose a valid wallet.");
  const blockNumber = await client.getBlockNumber();
  const [ownerValue, accountValue, createdValue] = await Promise.all([
    client.readContract({ address: ROBINHOOD.canonicalCollection, abi: OWNER_ABI,
      functionName: "ownerOf", args: [BigInt(tokenId)], blockNumber }),
    client.readContract({ address: registry, abi: REGISTRY_ABI,
      functionName: "account", args: [BigInt(tokenId)], blockNumber }),
    client.readContract({ address: registry, abi: REGISTRY_ABI,
      functionName: "isAccountCreated", args: [BigInt(tokenId)], blockNumber }),
  ]);
  const owner = normalizeWalletAddress(ownerValue);
  const punkWallet = normalizeWalletAddress(accountValue);
  if (!owner || !punkWallet || typeof blockNumber !== "bigint" || blockNumber < 0n) {
    throw new PublicError(503, "OWNERSHIP_UNAVAILABLE", "Live Punk ownership is unavailable.");
  }
  if (normalizedExpected && owner !== normalizedExpected) {
    throw new PublicError(403, "NOT_CURRENT_OWNER", `The connected wallet is not the current owner of Punk #${tokenId}.`);
  }
  const [code, nativeBalance] = await Promise.all([
    client.getCode({ address: punkWallet, blockNumber }),
    client.getBalance({ address: punkWallet, blockNumber }),
  ]);
  const activated = createdValue === true && typeof code === "string" && code !== "0x";
  if (createdValue !== activated) throw new PublicError(503, "PUNK_WALLET_STATE_MISMATCH",
    "The Punk Wallet activation signals disagree.");
  return Object.freeze({ chainId: ROBINHOOD.chainId,
    collection: ROBINHOOD.canonicalCollection, tokenId, owner, punkWallet, activated,
    blockNumber: blockNumber.toString(), nativeBalanceWei: nativeBalance.toString() });
}
