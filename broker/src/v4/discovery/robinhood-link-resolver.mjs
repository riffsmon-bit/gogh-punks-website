import { createPublicClient, custom, parseAbi, keccak256 } from "viem";

import { inspectArtBrokerLink, normalizeArtBrokerLink } from "../link-scanner.mjs";
import { inspectContract } from "../skill-forge/research-tools.mjs";
import { V2_SEADROP, V2_SEADROP_CODE_HASH, V2_REVIEWED_COLLECTION_CODE_HASHES,
  V2_OPEN_SEA_FEE_RECIPIENT } from "./seadrop-ingestor.mjs";

const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
const READ_METHODS = new Set([
  "eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_getStorageAt", "eth_call",
]);
const REVIEWED_RUNTIMES = new Set(V2_REVIEWED_COLLECTION_CODE_HASHES);
const ZERO = `0x${"0".repeat(40)}`;
const HASH = /^0x[0-9a-f]{64}$/i;
const HEX = /^0x(?:[0-9a-f]{2})*$/i;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i;
const ABI = parseAbi([
  "function getPublicDrop(address nftContract) view returns ((uint80 mintPrice,uint48 startTime,uint48 endTime,uint16 maxTotalMintableByWallet,uint16 feeBps,bool restrictFeeRecipients))",
  "function getMintStats(address minter) view returns (uint256 minterNumMinted,uint256 currentTotalMinted,uint256 maxSupply)",
  "function getFeeRecipientIsAllowed(address nftContract,address feeRecipient) view returns (bool)",
]);
const LIMITATIONS = Object.freeze([
  "Observed contract interfaces and runtime hashes are not a security clearance.",
  "Public-window and supply observations do not establish this wallet's mint eligibility.",
  "No selected-wallet simulation, gas estimate, transaction or execution authorization is provided.",
]);

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function sourceUrl(environment) {
  const configured = environment.ROBINHOOD_ARCHIVE_RPC_URL;
  if (configured === undefined || configured === "") return PUBLIC_RPC;
  try {
    // This is server-owned configuration, never an HTTP request or model field.
    // Reuse the scanner's strict HTTPS/DNS syntax without exposing this URL.
    return normalizeArtBrokerLink(configured).canonicalUrl;
  } catch { throw new TypeError("The configured link inspection source is invalid."); }
}

function block(value, now) {
  if (!value || !QUANTITY.test(value.number ?? "") || !QUANTITY.test(value.timestamp ?? "")
    || !HASH.test(value.hash ?? "") || BigInt(value.hash) === 0n) throw new Error("INVALID_ANCHOR");
  const timestamp = BigInt(value.timestamp);
  const clock = BigInt(Math.floor(new Date(now()).getTime() / 1000));
  if (timestamp > clock + 30n || timestamp < clock - 120n) throw new Error("STALE_ANCHOR");
  return { number: BigInt(value.number), hash: value.hash.toLowerCase(), timestamp };
}

function emptyMint(reason, status = "UNKNOWN") {
  return { status, standard: null, mintContract: null, priceWei: null, startTime: null,
    endTime: null, walletLimit: null, totalMinted: null, maxSupply: null,
    feeRecipientAllowed: null, publicWindow: "UNKNOWN", reason };
}

async function seaDropState(client, report, anchor) {
  if (!REVIEWED_RUNTIMES.has(report.codeHash)) {
    return emptyMint("UNSUPPORTED_MINT_RUNTIME", "UNSUPPORTED");
  }
  const blockNumber = anchor.number;
  const code = await client.getCode({ address: V2_SEADROP, blockNumber });
  if (!code || keccak256(code) !== V2_SEADROP_CODE_HASH) {
    return emptyMint("SEADROP_RUNTIME_MISMATCH");
  }
  const [drop, stats] = await Promise.all([
    client.readContract({ address: V2_SEADROP, abi: ABI, functionName: "getPublicDrop",
      args: [report.contract], blockNumber }),
    client.readContract({ address: report.contract, abi: ABI, functionName: "getMintStats",
      args: [ZERO], blockNumber }),
  ]);
  const feeRecipientAllowed = !drop.restrictFeeRecipients || await client.readContract({
    address: V2_SEADROP, abi: ABI, functionName: "getFeeRecipientIsAllowed",
    args: [report.contract, V2_OPEN_SEA_FEE_RECIPIENT], blockNumber,
  });
  const startTime = BigInt(drop.startTime), endTime = BigInt(drop.endTime);
  const walletLimit = BigInt(drop.maxTotalMintableByWallet);
  const publicWindow = walletLimit === 0n || endTime <= startTime ? "DISABLED"
    : anchor.timestamp < startTime ? "NOT_STARTED" : anchor.timestamp >= endTime ? "ENDED" : "OPEN";
  return { status: "OBSERVED", standard: "SEADROP_PUBLIC", mintContract: V2_SEADROP,
    priceWei: drop.mintPrice.toString(), startTime: startTime.toString(), endTime: endTime.toString(),
    walletLimit: walletLimit.toString(), totalMinted: stats[1].toString(), maxSupply: stats[2].toString(),
    feeRecipientAllowed, publicWindow,
    reason: stats[1] >= stats[2] ? "MINT_SUPPLY_EXHAUSTED" : "PUBLIC_STATE_OBSERVED" };
}

export function createRobinhoodLinkInspector({ fetchImpl = fetch, now = () => new Date(),
  timeoutMs = 8_000, environment = process.env } = {}) {
  if (typeof fetchImpl !== "function" || typeof now !== "function"
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8_000) {
    throw new TypeError("Link inspection dependencies are invalid.");
  }
  const endpoint = sourceUrl(environment);

  async function resolve(link) {
    const controller = new AbortController();
    let requests = 0, bytes = 0, fatal = null, initial = null;
    const stop = (reason) => { fatal ??= reason; throw new Error(reason); };
    const deadline = new Promise((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("INSPECTION_DEADLINE")),
        { once: true });
    });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    async function request({ method, params }) {
      if (controller.signal.aborted || fatal) throw new Error(fatal ?? "INSPECTION_DEADLINE");
      if (!READ_METHODS.has(method) || ++requests > 20) stop("RPC_READ_LIMIT");
      const id = requests;
      let response;
      try {
        response = await fetchImpl(endpoint, { method: "POST", redirect: "error",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal: controller.signal });
      } catch { stop("RPC_UNAVAILABLE"); }
      if (!response.ok || response.redirected || !response.body?.getReader) stop("RPC_UNAVAILABLE");
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 262_144)) {
        stop("RPC_RESPONSE_TOO_LARGE");
      }
      const reader = response.body.getReader();
      const cancel = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener("abort", cancel, { once: true });
      if (controller.signal.aborted) cancel();
      const chunks = []; let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength; bytes += value.byteLength;
          if (length > 262_144 || bytes > 1_048_576) stop("RPC_RESPONSE_TOO_LARGE");
          chunks.push(value);
        }
      } catch { stop(fatal ?? "RPC_UNAVAILABLE"); }
      finally {
        controller.signal.removeEventListener("abort", cancel);
        cancel();
      }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { stop("RPC_MALFORMED"); }
      if (!payload || payload.jsonrpc !== "2.0" || payload.id !== id
        || Object.hasOwn(payload, "result") === Object.hasOwn(payload, "error")) stop("RPC_MALFORMED");
      // Reverted optional contract reads remain UNKNOWN. Never expose upstream
      // messages/data, which may include URLs, credentials or return bytes.
      if (payload.error) throw new Error("RPC_CALL_FAILED");
      const result = payload.result;
      if (method === "eth_chainId" && !QUANTITY.test(result ?? "")) stop("RPC_MALFORMED");
      if (method === "eth_getBlockByNumber") {
        const anchor = block(result, now);
        if (params[0] === "latest") initial = anchor;
        else if (anchor.number !== BigInt(params[0])) stop("INVALID_ANCHOR");
      }
      if ((method === "eth_getCode" || method === "eth_call")
        && (typeof result !== "string" || !HEX.test(result) || result.length > 131_074)) stop("RPC_MALFORMED");
      if (method === "eth_getStorageAt" && !HASH.test(result ?? "")) stop("RPC_MALFORMED");
      return result;
    }
    const client = createPublicClient({ cacheTime: 0, ccipRead: false,
      transport: custom({ request }, { retryCount: 0 }) });
    async function anchorEvidence() {
      if (!initial) throw new Error("INVALID_ANCHOR");
      const [chainId, canonical] = await Promise.all([
        client.getChainId(), client.getBlock({ blockNumber: initial.number }),
      ]);
      if (chainId !== 4663) throw new Error("WRONG_CHAIN");
      if (canonical.hash?.toLowerCase() !== initial.hash || canonical.timestamp !== initial.timestamp
        || canonical.number !== initial.number) throw new Error("ANCHOR_CHANGED");
      if (fatal) throw new Error(fatal);
      return { blockNumber: initial.number.toString(), blockHash: initial.hash,
        blockTimestamp: initial.timestamp.toString(), canonicalRechecked: true };
    }
    const base = () => ({ status: "NEEDS_REVIEW", source: "ROBINHOOD_MAINNET_RPC", chainId: 4663,
      contract: link.identity, observedAt: new Date(now()).toISOString(), simulationStatus: "UNAVAILABLE",
      transactionPrepared: false, externalCalldataAccepted: false,
      executionAuthorized: false, walletAuthority: "NONE", limitations: LIMITATIONS });
    try {
      const work = async () => {
        let report;
        try { report = await inspectContract({ client, contract: link.identity }); }
        catch (error) {
          if (error.message !== "NO_CONTRACT_CODE") throw error;
          return { ...base(), status: "BLOCKED", reason: "NO_CONTRACT_CODE",
            anchor: await anchorEvidence(), contractInspection: null, mint: emptyMint("NO_CONTRACT_CODE") };
        }
        let mint;
        try { mint = await seaDropState(client, report, initial); }
        catch { mint = emptyMint("MINT_STATE_UNAVAILABLE"); }
        const anchor = await anchorEvidence();
        return { ...base(), reason: mint.status === "OBSERVED" ? "SEADROP_STATE_OBSERVED" : mint.reason,
          anchor, contractInspection: report, mint };
      };
      return freeze(await Promise.race([work(), deadline]));
    } catch {
      return freeze({ ...base(), reason: "INSPECTION_UNAVAILABLE", anchor: null,
        contractInspection: null, mint: emptyMint("INSPECTION_UNAVAILABLE") });
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  return (value) => inspectArtBrokerLink(value, { resolvers: { ROBINHOOD_CONTRACT: resolve } });
}

export function inspectRobinhoodArtBrokerLink(value) {
  return createRobinhoodLinkInspector()(value);
}
