import { decodeEventLog, parseAbi, parseAbiItem } from "viem";
import { ROBINHOOD } from "../config.mjs";
import { PUNK_AGENT_EPOCH_DEPLOYMENT_SCHEMA } from './punk-agent-account-manifest.mjs';
import { verifyEpochSessionOwnership } from './punk-agent-epoch-authority.mjs';

const CONFIGURED = parseAbiItem("event AutonomousSessionConfigured(uint64 indexed generation,address indexed owner,address indexed sessionKey,address adapter,address venue,address targetCollection,uint32 maxMintsPerDay,uint32 maxMintsTotal,uint48 validAfter,uint48 validUntil,uint256 maxGasCostWei,uint256 minimumNativeReserveWei)");
const TRANSFER = parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)");
const OWNER_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);
const SESSION_ABI = parseAbi(["function sessionGeneration() view returns (uint64)", "function isAutonomousSessionActive() view returns (bool)"]);
const HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const PAGE = 2_000n;
export const MAX_OWNERSHIP_HISTORY_BLOCKS = 40_000n;
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
function fail(code) { throw Object.assign(new Error(code), { code }); }
function uint(value) {
  if (!/^(0|[1-9]\d{0,77})$/.test(String(value))) fail("OWNERSHIP_CONTINUITY_UNVERIFIED");
  return BigInt(value);
}

// Worker-side mitigation, NOT an on-chain transfer epoch. Does not revoke or sign.
// Never use a cached current-owner address as proof that no round trip occurred.
export async function verifyPunkAgentOwnershipContinuity({ client, mission, runtime, deployment }) {
  try {
    const epochModel = deployment?.schema === PUNK_AGENT_EPOCH_DEPLOYMENT_SCHEMA;
    if (!HASH.test(mission?.authorizationTransactionHash) || !ADDRESS.test(mission?.owner)
      || !ADDRESS.test(mission?.account) || !same(runtime?.account, mission.account)
      || !same(runtime?.owner, mission.owner)) fail("OWNERSHIP_CONTINUITY_UNVERIFIED");
    const tokenId = uint(mission.tokenId), generation = uint(mission.sessionGeneration);
    if (generation !== uint(runtime.session?.generation)) fail("SESSION_STATE_MISMATCH");
    if (await client.getChainId() !== ROBINHOOD.chainId) fail("OWNERSHIP_CONTINUITY_UNVERIFIED");
    const tip = await client.getBlock({ blockTag: "latest" });
    const receipt = await client.getTransactionReceipt({ hash: mission.authorizationTransactionHash });
    if (!HASH.test(tip?.hash) || !HASH.test(receipt?.blockHash) || receipt.status !== "success"
      || !same(receipt.transactionHash, mission.authorizationTransactionHash)
      || !Array.isArray(receipt.logs)) fail("OWNERSHIP_CONTINUITY_UNVERIFIED");
    const from = uint(receipt.blockNumber), to = uint(tip.number);
    const tipTime = Number(uint(tip.timestamp)) * 1_000;
    if (!Number.isSafeInteger(tipTime) || tipTime > Date.now() + 5_000 || Date.now() - tipTime > 30_000)
      fail("OWNERSHIP_CONTINUITY_UNVERIFIED");
    if (from > to) fail("OWNERSHIP_CONTINUITY_UNVERIFIED");
    if (!epochModel && to - from + 1n > MAX_OWNERSHIP_HISTORY_BLOCKS) fail("OWNERSHIP_HISTORY_WINDOW_EXCEEDED");
    const anchor = await client.getBlock({ blockNumber: from });
    if (!same(anchor?.hash, receipt.blockHash) || uint(anchor.number) !== from) fail("OWNERSHIP_CONTINUITY_UNVERIFIED");
    const events = receipt.logs.flatMap(log => {
      if (!same(log.address, mission.account)) return [];
      try { return [decodeEventLog({ abi: [CONFIGURED], data: log.data, topics: log.topics, strict: true })]; }
      catch { return []; }
    });
    if (events.length !== 1 || events[0].args.generation !== generation
      || !same(events[0].args.owner, mission.owner)
      || !same(events[0].args.sessionKey, runtime.session.sessionKey)) fail("OWNERSHIP_CONTINUITY_UNVERIFIED");
    const epochState = epochModel ? await verifyEpochSessionOwnership({ client, deployment, mission, receipt, blockNumber: to }) : null;
    const [owner, liveGeneration, active] = await Promise.all([
      epochState ? epochState.owner : client.readContract({ address: ROBINHOOD.canonicalCollection, abi: OWNER_ABI,
        functionName: "ownerOf", args: [tokenId], blockNumber: to }),
      client.readContract({ address: mission.account, abi: SESSION_ABI,
        functionName: "sessionGeneration", blockNumber: to }),
      client.readContract({ address: mission.account, abi: SESSION_ABI,
        functionName: "isAutonomousSessionActive", blockNumber: to }),
    ]);
    if (!same(owner, mission.owner)) fail("OWNER_CHANGED");
    if (uint(liveGeneration) !== generation || active !== true) fail("SESSION_STATE_MISMATCH");
    // Include the authorization block conservatively: even an earlier same-block
    // transfer requires authorization in a later block. Never infer log ordering.
    for (let start = from; !epochModel && start <= to; start += PAGE) {
      const end = start + PAGE - 1n < to ? start + PAGE - 1n : to;
      const logs = await client.getLogs({ address: ROBINHOOD.canonicalCollection,
        event: TRANSFER, args: { tokenId }, fromBlock: start, toBlock: end, strict: true });
      if (!Array.isArray(logs) || logs.length > 1_000) fail("OWNERSHIP_CONTINUITY_UNVERIFIED");
      for (const log of logs) {
        if (!same(log.address, ROBINHOOD.canonicalCollection) || log.removed === true
          || !HASH.test(log.blockHash) || uint(log.blockNumber) < start || uint(log.blockNumber) > end)
          fail("OWNERSHIP_CONTINUITY_UNVERIFIED");
        const decoded = decodeEventLog({ abi: [TRANSFER], data: log.data, topics: log.topics, strict: true });
        if (decoded.args.tokenId !== tokenId) fail("OWNERSHIP_CONTINUITY_UNVERIFIED");
        const block = await client.getBlock({ blockNumber: uint(log.blockNumber) });
        if (!same(block?.hash, log.blockHash) || uint(block.number) !== uint(log.blockNumber)) fail("OWNERSHIP_CONTINUITY_UNVERIFIED");
        fail("OWNERSHIP_CHANGED_SINCE_AUTHORIZATION");
      }
    }
    const [tipAgain, anchorAgain, newest] = await Promise.all([
      client.getBlock({ blockNumber: to }), client.getBlock({ blockNumber: from }), client.getBlock({ blockTag: "latest" }),
    ]);
    if (!same(tipAgain?.hash, tip.hash) || !same(anchorAgain?.hash, receipt.blockHash)
      || !same(newest?.hash, tip.hash) || uint(tipAgain.number) !== to || uint(anchorAgain.number) !== from
      || uint(newest.number) !== to || Date.now() - tipTime > 30_000)
      fail("OWNERSHIP_CONTINUITY_UNVERIFIED");
    return Object.freeze({ verified: true, account: mission.account, tokenId: tokenId.toString(),
      authorizationTransactionHash: mission.authorizationTransactionHash,
      generation: generation.toString(), fromBlock: from.toString(), toBlock: to.toString(), blockHash: tip.hash });
  } catch (error) {
    if (["OWNERSHIP_CHANGED_SINCE_AUTHORIZATION", "OWNERSHIP_HISTORY_WINDOW_EXCEEDED", "OWNER_CHANGED", "SESSION_STATE_MISMATCH"].includes(error?.code)) throw error;
    fail("OWNERSHIP_CONTINUITY_UNVERIFIED");
  }
}
