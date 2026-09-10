import { createPublicClient, defineChain, http, parseAbi, parseAbiItem } from "viem";
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
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
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

// Legacy chat stays bound to ORIGINAL ownership, not wrapper receipt ownership.
// Epoch profiles have a separate API; this does not expand legacy wallet authority.
export async function readV2ChatAuthority(tokenId, { client = rpcClient(), ...options } = {}) {
  const result = await readV2PunkAuthority(tokenId, { ...options, client });
  const block = await client.getBlock({ blockNumber: BigInt(result.blockNumber) });
  if (!/^0x[0-9a-f]{64}$/i.test(block?.hash ?? '') || String(block.number) !== result.blockNumber) {
    throw new PublicError(503, 'OWNERSHIP_UNAVAILABLE', 'Ownership snapshot could not be verified.');
  }
  return { ...result, blockHash: block.hash };
}

export async function assertV2ChatAuthorityUnchanged(before, { client = rpcClient(), registry } = {}) {
  const after = await readV2ChatAuthority(before.tokenId, { expectedOwner: before.owner, client, ...(registry ? { registry } : {}) });
  const from = BigInt(before.blockNumber), to = BigInt(after.blockNumber);
  const changed = () => { throw new PublicError(409, 'CHAT_AUTHORITY_CHANGED',
    'Punk ownership changed while answering. Refresh and send a new message. No draft was saved.'); };
  if (to < from || to - from > 1000n || after.punkWallet !== before.punkWallet) changed();
  const canonicalBefore = await client.getBlock({ blockNumber: from });
  if (canonicalBefore.hash !== before.blockHash) changed();
  const event = parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)');
  // Include both boundary blocks conservatively. A transfer away AND BACK must
  // invalidate an in-flight answer even when ownerOf returns the same address.
  const logs = await client.getLogs({ address: ROBINHOOD.canonicalCollection, event,
    args: { tokenId: BigInt(before.tokenId) }, fromBlock: from, toBlock: to, strict: true });
  if (!Array.isArray(logs) || logs.length !== 0) changed();
  const canonicalAfter = await client.getBlock({ blockNumber: to });
  if (canonicalAfter.hash !== after.blockHash) changed();
  return after;
}
