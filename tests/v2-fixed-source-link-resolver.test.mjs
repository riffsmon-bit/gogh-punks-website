import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { encodeErrorResult, encodeFunctionResult, keccak256, parseAbi, toFunctionSelector } from "viem";

import { createRobinhoodLinkInspector } from
  "../broker/src/v4/discovery/robinhood-link-resolver.mjs";
import { V2_SEADROP, V2_SEADROP_CODE_HASH, V2_REVIEWED_COLLECTION_CODE_HASHES } from
  "../broker/src/v4/discovery/seadrop-ingestor.mjs";
import { handleV2InspectUrl } from "../netlify/functions/broker-v2-inspect-url.mjs";
import compressed from "./fixtures/fixed-source-link-runtimes.json" with { type: "json" };

// Public runtime snapshots from September 13, 2026. Hashes must agree with the
// existing reviewed constants; these fixtures do not add a test-only trust pin.
const CODE = Object.fromEntries(Object.entries(compressed).map(([name, data]) => (
  [name, `0x${gunzipSync(Buffer.from(data, "base64")).toString("hex")}`]
)));
const PEPPies = "0xb73f1d1aee57410d537d87b656e98b9d3df5b213";
const GOGH = "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6";
const HASH = `0x${"12".repeat(32)}`;
const NOW = new Date("2026-09-13T19:00:00.000Z");
const SECONDS = BigInt(Math.floor(NOW.getTime() / 1000));
const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
const link = (contract = PEPPies) => `https://robinhoodchain.blockscout.com/address/${contract}`;
const ABI = parseAbi([
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function getPublicDrop(address nftContract) view returns ((uint80 mintPrice,uint48 startTime,uint48 endTime,uint16 maxTotalMintableByWallet,uint16 feeBps,bool restrictFeeRecipients))",
  "function getMintStats(address minter) view returns (uint256 minterNumMinted,uint256 currentTotalMinted,uint256 maxSupply)",
  "function getFeeRecipientIsAllowed(address nftContract,address feeRecipient) view returns (bool)",
]);
const SELECTORS = new Map(ABI.map((item) => [toFunctionSelector(item), item.name]));

function rpcFixture({ mutate, collectionCode = CODE.peppies, seaDropCode = CODE.seaDrop,
  drop: dropOverrides = {}, stats = [0n, 100n, 1000n], feeAllowed = true,
  environment = {}, timeoutMs = 1000 } = {}) {
  const calls = [];
  const drop = { mintPrice: 100000000000000n, startTime: SECONDS - 60n, endTime: SECONDS + 3600n,
    maxTotalMintableByWallet: 50, feeBps: 0, restrictFeeRecipients: true, ...dropOverrides };
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body);
    const { method, params = [], id } = request;
    calls.push({ url, options, method, params });
    let result;
    if (method === "eth_chainId") result = "0x1237";
    else if (method === "eth_getBlockByNumber") result = {
      number: "0x64", hash: HASH, timestamp: `0x${SECONDS.toString(16)}`, transactions: [],
    };
    else if (method === "eth_getCode") result = params[0].toLowerCase() === V2_SEADROP
      ? seaDropCode : collectionCode;
    else if (method === "eth_getStorageAt") result = `0x${"0".repeat(64)}`;
    else if (method === "eth_call") {
      const functionName = SELECTORS.get(params[0].data.slice(0, 10));
      if (!functionName) throw new Error("Unexpected selector");
      const value = functionName === "supportsInterface" ? params[0].data.slice(10, 18) === "80ac58cd"
        : functionName === "getPublicDrop" ? drop : functionName === "getMintStats" ? stats : feeAllowed;
      result = encodeFunctionResult({ abi: ABI, functionName, result: value });
    } else throw new Error(`Unexpected RPC method ${method}`);
    const payload = { jsonrpc: "2.0", id, result };
    const changed = await mutate?.({ method, params, payload, calls, options });
    return changed ?? Response.json(payload);
  };
  return { calls, fetchImpl, inspect: createRobinhoodLinkInspector({ fetchImpl,
    now: () => NOW, environment, timeoutMs }) };
}

function unavailable(result) {
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.reason, "INSPECTION_UNAVAILABLE");
  assert.equal(result.evidence.anchor, null);
  assert.equal(result.evidence.contractInspection, null);
  assert.equal(result.evidence.mint.status, "UNKNOWN");
  assert.equal(result.evidence.mint.priceWei, null);
  assert.equal(result.evidence.simulationStatus, "UNAVAILABLE");
  assert.equal(result.executable, false);
}

test("fixed source inspects reviewed SeaDrop state with real reader/ABI and canonical anchor", async () => {
  assert.equal(keccak256(CODE.seaDrop), V2_SEADROP_CODE_HASH);
  assert.ok(V2_REVIEWED_COLLECTION_CODE_HASHES.includes(keccak256(CODE.peppies)));
  const f = rpcFixture();
  const result = await f.inspect(link());
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.reason, "SEADROP_STATE_OBSERVED");
  assert.deepEqual(result.evidence.anchor, { blockNumber: "100", blockHash: HASH,
    blockTimestamp: SECONDS.toString(), canonicalRechecked: true });
  assert.equal(result.evidence.contractInspection.erc721.value, true);
  assert.equal(result.evidence.contractInspection.minimalProxy, true);
  assert.equal(result.evidence.contractInspection.securityVerdict, "NOT_A_SECURITY_CLEARANCE");
  assert.deepEqual(result.evidence.mint, { status: "OBSERVED", standard: "SEADROP_PUBLIC",
    mintContract: V2_SEADROP, priceWei: "100000000000000", startTime: (SECONDS - 60n).toString(),
    endTime: (SECONDS + 3600n).toString(), walletLimit: "50", totalMinted: "100", maxSupply: "1000",
    feeRecipientAllowed: true, publicWindow: "OPEN", reason: "PUBLIC_STATE_OBSERVED" });
  assert.equal(result.executable, false);
  assert.equal(result.externalTransactionAccepted, false);
  for (const flag of ["transactionPrepared", "externalCalldataAccepted", "executionAuthorized"]) {
    assert.equal(result.evidence[flag], false);
  }
  assert.equal(result.evidence.walletAuthority, "NONE");
  assert.equal(result.evidence.simulationStatus, "UNAVAILABLE");
  assert.ok(Object.isFrozen(result.evidence.mint));
  assert.ok(f.calls.length <= 20);
  assert.equal(f.calls.filter(({ method }) => method === "eth_chainId").length, 2);
  assert.equal(f.calls.filter(({ method }) => method === "eth_getBlockByNumber").length, 2);
  for (const { url, options, method, params } of f.calls) {
    assert.equal(url, PUBLIC_RPC);
    assert.equal(options.method, "POST"); assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_getStorageAt", "eth_call"].includes(method));
    if (["eth_getCode", "eth_getStorageAt", "eth_call"].includes(method)) assert.equal(params.at(-1), "0x64");
  }
});

test("unreviewed runtime retains anchored contract evidence and explicitly unsupported mint state", async () => {
  const f = rpcFixture({ collectionCode: "0x60006000" });
  const result = await f.inspect(link(GOGH));
  assert.equal(result.evidence.contract, GOGH);
  assert.equal(result.evidence.contractInspection.codeHash, keccak256("0x60006000"));
  assert.equal(result.reason, "UNSUPPORTED_MINT_RUNTIME");
  assert.equal(result.evidence.mint.status, "UNSUPPORTED");
  assert.equal(result.evidence.mint.priceWei, null);
  assert.equal(result.evidence.anchor.canonicalRechecked, true);
  assert.ok(f.calls.every(({ params }) => params[0]?.to?.toLowerCase() !== V2_SEADROP));
});

test("address without contract code is BLOCKED after canonical recheck", async () => {
  const result = await rpcFixture({ collectionCode: "0x" }).inspect(link());
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "NO_CONTRACT_CODE");
  assert.equal(result.evidence.contractInspection, null);
  assert.equal(result.evidence.anchor.canonicalRechecked, true);
  assert.equal(result.executable, false);
});

test("mint price zero is observed data while reverted or changed-runtime mint state stays unknown", async () => {
  const free = await rpcFixture({ drop: { mintPrice: 0n } }).inspect(link());
  assert.equal(free.evidence.mint.priceWei, "0");
  assert.equal(free.evidence.mint.status, "OBSERVED");
  assert.equal(free.evidence.simulationStatus, "UNAVAILABLE");
  const changed = await rpcFixture({ seaDropCode: "0x6000" }).inspect(link());
  assert.equal(changed.evidence.mint.reason, "SEADROP_RUNTIME_MISMATCH");
  assert.equal(changed.evidence.mint.priceWei, null);
  const reverted = await rpcFixture({ mutate: ({ method, params, payload }) => {
    if (method === "eth_call" && SELECTORS.get(params[0].data.slice(0, 10)) === "getPublicDrop") {
      return Response.json({ jsonrpc: "2.0", id: payload.id,
        error: { code: 3, message: "private provider secret", data: "0x1234" } });
    }
  } }).inspect(link());
  assert.equal(reverted.evidence.mint.status, "UNKNOWN");
  assert.equal(reverted.evidence.mint.priceWei, null);
  assert.equal(reverted.evidence.anchor.canonicalRechecked, true);
  assert.doesNotMatch(JSON.stringify(reverted), /private provider secret|0x1234/);
});

test("public window, exhausted supply and fee-recipient observations never imply execution", async () => {
  for (const [drop, expected] of [[{ startTime: SECONDS + 10n }, "NOT_STARTED"],
    [{ endTime: SECONDS }, "ENDED"], [{ maxTotalMintableByWallet: 0 }, "DISABLED"]]) {
    const result = await rpcFixture({ drop }).inspect(link());
    assert.equal(result.evidence.mint.publicWindow, expected);
    assert.equal(result.executable, false);
  }
  const result = await rpcFixture({ stats: [0n, 1000n, 1000n], feeAllowed: false }).inspect(link());
  assert.equal(result.evidence.mint.reason, "MINT_SUPPLY_EXHAUSTED");
  assert.equal(result.evidence.mint.feeRecipientAllowed, false);
  assert.equal(result.status, "NEEDS_REVIEW");
});

test("wrong chain, changed canonical block and stale/future blocks discard all inspection evidence", async () => {
  for (const mutate of [
    ({ method, payload }) => { if (method === "eth_chainId") payload.result = "0x1"; },
    ({ method, payload, calls }) => {
      if (method === "eth_chainId" && calls.length > 1) payload.result = "0x1";
    },
    ({ method, params, payload }) => {
      if (method === "eth_getBlockByNumber" && params[0] !== "latest") payload.result.hash = `0x${"34".repeat(32)}`;
    },
    ({ method, params, payload }) => {
      if (method === "eth_getBlockByNumber" && params[0] !== "latest") payload.result.number = "0x65";
    },
    ({ method, params, payload }) => {
      if (method === "eth_getBlockByNumber" && params[0] !== "latest") payload.result.timestamp = `0x${(SECONDS + 1n).toString(16)}`;
    },
    ...[-121n, 31n].map((delta) => ({ method, payload }) => {
      if (method === "eth_getBlockByNumber") payload.result.timestamp = `0x${(SECONDS + delta).toString(16)}`;
    }),
  ]) unavailable(await rpcFixture({ mutate }).inspect(link()));
});

test("malformed and excessive responses fail closed even in optional contract probes", async () => {
  for (const mutate of [
    ({ method, payload }) => { if (method === "eth_getStorageAt") payload.result = "0x00"; },
    ({ method, payload }) => { if (method === "eth_getStorageAt") payload.id += 100; },
    ({ method }) => method === "eth_getStorageAt" ? new Response("not-json") : undefined,
    () => new Response("{}", { headers: { "content-length": "262145" } }),
    () => new Response("x".repeat(262145)),
    ({ payload }) => Response.json({ ...payload, padding: "x".repeat(220000) }),
    () => new Response("private upstream content", { status: 503 }),
    () => ({ ok: true, redirected: true }),
  ]) unavailable(await rpcFixture({ mutate }).inspect(link()));
});

test("overall deadline cancels stalled response streams and tolerates fetches ignoring abort", async () => {
  let cancelled = 0;
  const f = rpcFixture({ timeoutMs: 25, mutate: () => new Response(new ReadableStream({
    pull() {}, cancel() { cancelled += 1; },
  })) });
  unavailable(await f.inspect(link()));
  assert.equal(cancelled, 1);
  const ignored = createRobinhoodLinkInspector({ environment: {}, timeoutMs: 25,
    fetchImpl: async () => new Promise(() => {}) });
  unavailable(await ignored(link()));
});

test("only server configuration selects RPC and no user website/social/market URL is fetched", async () => {
  const secretEndpoint = "https://archive.example.org/private-provider-token?key=private-provider-key";
  const f = rpcFixture({ environment: { ROBINHOOD_ARCHIVE_RPC_URL: secretEndpoint } });
  const result = await f.inspect(link());
  assert.ok(f.calls.every(({ url }) => url === secretEndpoint));
  assert.doesNotMatch(JSON.stringify(result), /archive\.example|private-provider/);
  f.calls.length = 0;
  for (const url of ["https://example.org/mint", "https://opensea.io/collection/example",
    "https://x.com/example/status/123456"]) {
    assert.equal((await f.inspect(url)).reason, "NO_TRUSTED_RESOLVER");
  }
  for (const url of ["https://[::1]/", `https://explorer.testnet.chain.robinhood.com/address/${PEPPies}`]) {
    await assert.rejects(f.inspect(url));
  }
  assert.equal(f.calls.length, 0);
  for (const url of ["http://archive.example.org/", "https://user:secret@archive.example.org/",
    "https://127.0.0.1/", "https://archive.example.org/#secret"]) {
    assert.throws(() => createRobinhoodLinkInspector({ environment: { ROBINHOOD_ARCHIVE_RPC_URL: url } }),
      /configured link inspection source is invalid/);
  }
});

test("contract OffchainLookup data cannot initiate CCIP or arbitrary URL fetches", async (t) => {
  const offchain = encodeErrorResult({ abi: parseAbi([
    "error OffchainLookup(address sender,string[] urls,bytes callData,bytes4 callbackFunction,bytes extraData)",
  ]), errorName: "OffchainLookup", args: [V2_SEADROP, ["https://127.0.0.1/private"],
    "0x", "0x12345678", "0x"] });
  const externalFetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No additional fetch is permitted");
  });
  const f = rpcFixture({ mutate: ({ method, params, payload }) => {
    if (method === "eth_call" && SELECTORS.get(params[0].data.slice(0, 10)) === "getPublicDrop") {
      return Response.json({ jsonrpc: "2.0", id: payload.id,
        error: { code: 3, message: "execution reverted", data: offchain } });
    }
  } });
  const result = await f.inspect(link());
  assert.equal(result.evidence.mint.status, "UNKNOWN");
  assert.equal(externalFetch.mock.callCount(), 0);
  assert.doesNotMatch(JSON.stringify(result), /127\.0\.0\.1|12345678/);
});

test("production endpoint default dependency returns real observed evidence without an injected inspector", async (t) => {
  const previous = { site: process.env.SITE_URL, archive: process.env.ROBINHOOD_ARCHIVE_RPC_URL };
  process.env.SITE_URL = "https://goghpunks.xyz";
  delete process.env.ROBINHOOD_ARCHIVE_RPC_URL;
  t.after(() => {
    for (const [key, value] of [["SITE_URL", previous.site], ["ROBINHOOD_ARCHIVE_RPC_URL", previous.archive]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const realSeconds = BigInt(Math.floor(Date.now() / 1000));
  const f = rpcFixture({ mutate: ({ method, payload }) => {
    if (method === "eth_getBlockByNumber") payload.result.timestamp = `0x${realSeconds.toString(16)}`;
  } });
  t.mock.method(globalThis, "fetch", f.fetchImpl);
  const owner = `0x${"78".repeat(20)}`;
  const response = await handleV2InspectUrl(new Request("https://goghpunks.xyz/api/v2/inspect-url", {
    method: "POST", headers: { origin: "https://goghpunks.xyz", "content-type": "application/json" },
    body: JSON.stringify({ tokenId: "93", url: link() }),
  }), { pool: {}, requireSession: async () => ({ walletAddress: owner }),
    readAuthority: async (tokenId, { expectedOwner }) => {
      assert.equal(tokenId, "93"); assert.equal(expectedOwner, owner); return { owner };
    } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.inspection.reason, "SEADROP_STATE_OBSERVED");
  assert.equal(payload.inspection.evidence.mint.priceWei, "100000000000000");
  assert.doesNotMatch(payload.message, /resolver is required/);
  assert.equal(payload.transactionPrepared, false);
  assert.equal(payload.externalCalldataAccepted, false);
});
