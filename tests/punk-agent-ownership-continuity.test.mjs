import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbiItem } from "viem";
import deployment from "../deployments/robinhood-punk-agent-account.json" with { type: "json" };
import { ROBINHOOD } from "../broker/src/config.mjs";
import { verifyPunkAgentOwnershipContinuity } from "../broker/src/agent-account/punk-agent-ownership-continuity.mjs";
import { runPunkAgentMissionOnce } from "../broker/src/agent-account/punk-agent-worker.mjs";

const addr = digit => `0x${digit.repeat(40)}`;
const hash = digit => `0x${digit.repeat(64)}`;
const OWNER = addr("1"), ACCOUNT = addr("2"), SIGNER = addr("3"), OTHER = addr("4");
const CODE = "0x6001600055";
const CONFIGURED = parseAbiItem("event AutonomousSessionConfigured(uint64 indexed generation,address indexed owner,address indexed sessionKey,address adapter,address venue,address targetCollection,uint32 maxMintsPerDay,uint32 maxMintsTotal,uint48 validAfter,uint48 validUntil,uint256 maxGasCostWei,uint256 minimumNativeReserveWei)");
const TRANSFER = parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)");
function log(event, args, address, blockNumber, blockHash) {
  const plain = event.inputs.filter(input => !input.indexed);
  return { address, blockNumber, blockHash, transactionHash: hash("c"), logIndex: 1,
    topics: encodeEventTopics({ abi: [event], args }),
    data: encodeAbiParameters(plain, plain.map(input => args[input.name])), removed: false };
}
function fixture() {
  const now = new Date(), seconds = BigInt(Math.floor(now.getTime() / 1_000));
  const manifest = { ...structuredClone(deployment), status: "DEPLOYED", contracts: {
    GoghPunkAgentAccount: { address: addr("5"), deploymentTransaction: hash("5"), deploymentBlock: 1,
      runtimeBytecodeHash: keccak256(CODE), verificationStatus: "VERIFIED" },
    GoghPunkAgentAccountRegistry: { address: addr("6"), deploymentTransaction: hash("6"), deploymentBlock: 2,
      runtimeBytecodeHash: keccak256(CODE), verificationStatus: "VERIFIED" },
  }, configuration: Object.fromEntries(Object.keys(deployment.configuration).map(key => [key, true])),
  authorization: { deploymentAuthorized: true, automaticSubmissionEnabled: true } };
  const session = { sessionKey: SIGNER, authorizingOwner: OWNER,
    adapter: manifest.reusedContracts.AutomatedSeaDropStudioFreeMintAdapter,
    venue: manifest.reusedContracts.SeaDrop, adapterCodeHash: hash("d"), targetCollection: addr("0"),
    generation: 1n, validAfter: seconds - 10n, validUntil: seconds + 600n,
    maxMintsPerDay: 1, remainingMints: 1, mintsToday: 0, day: 1,
    maxGasCostWei: 1_000_000n, minimumNativeReserveWei: 0n };
  const f = { now, manifest, from: 100n, to: 110n, owner: OWNER, session, logs: [], queries: [],
    signatures: 0, submissions: 0, failures: [], reserved: 0, recorded: 0 };
  f.mission = { tokenId: "93", owner: OWNER, account: ACCOUNT, sessionGeneration: "1",
    authorizationTransactionHash: hash("a"), strategyHash: hash("b"), strategy: { operatingMode: "AUTONOMOUS" } };
  f.runtime = { account: ACCOUNT, owner: OWNER, session };
  f.receipt = () => ({ status: "success", transactionHash: hash("a"), blockNumber: f.from,
    blockHash: hash("a"), logs: [log(CONFIGURED, { ...session, owner: OWNER,
      maxMintsTotal: 1 }, ACCOUNT, f.from, hash("a"))] });
  f.client = {
    getChainId: async () => 4663, getCode: async () => CODE, getBalance: async () => 1_000_000n,
    getBlock: async ({ blockNumber }) => ({ number: blockNumber ?? f.to,
      hash: blockNumber === f.from ? hash("a") : hash("b"), timestamp: seconds }),
    getTransactionReceipt: async () => f.receipt(),
    getLogs: async query => { f.queries.push(query); return f.logs.filter(l => l.blockNumber >= query.fromBlock && l.blockNumber <= query.toBlock); },
    readContract: async ({ functionName }) => {
      const values = { account: ACCOUNT, owner: f.owner, ownerOf: f.owner,
        entryPoint: manifest.entryPoint, adapterRegistry: manifest.reusedContracts.ArtAdapterRegistry,
        acquisitionNonce: 0n, sessionGeneration: session.generation, entryPointDeposit: 1_000_000n,
        autonomousSession: session, isAutonomousSessionActive: true, getNonce: 0n, getUserOpHash: hash("e") };
      if (!(functionName in values)) throw Error(`Unexpected read ${functionName}`);
      return values[functionName];
    },
  };
  f.roundTrip = () => { f.logs = [log(TRANSFER, { from: OWNER, to: OTHER, tokenId: 93n }, ROBINHOOD.canonicalCollection, 105n, hash("b")),
    log(TRANSFER, { from: OTHER, to: OWNER, tokenId: 93n }, ROBINHOOD.canonicalCollection, 106n, hash("b"))]; };
  f.check = () => verifyPunkAgentOwnershipContinuity({ client: f.client, mission: f.mission, runtime: f.runtime, deployment: f.manifest });
  f.candidate = { checkedAt: now.toISOString(), tokenId: "42", screeningInputHash: "screen", simulationInputHash: "sim",
    opportunity: { schema: "GOGH_NORMALIZED_OPPORTUNITY_V2", version: 2, opportunityId: "test:mint", chainId: 4663,
      collectionContract: addr("7"), mintContract: session.venue, adapter: session.adapter,
      mintStage: "PUBLIC", mintMethod: "mintPublic(address,address,address,uint256)", priceWei: "0",
      estimatedGasCostWei: "100", supply: 100, walletLimit: 1, startTime: new Date(now.getTime() - 60000).toISOString(),
      endTime: new Date(now.getTime() + 600000).toISOString(), website: null,
      socialUrls: { x: null, discord: null, farcaster: null }, sourceUrls: ["https://example.com"], artStyles: ["PIXEL_ART"],
      imageReference: null, collectionName: "Test", contractCodeHash: hash("f"), adapterCodeHash: session.adapterCodeHash,
      screeningStatus: "PASSED", simulationStatus: "PASSED", riskLevel: "LOW", riskScore: 10,
      expectedNftReceiver: ACCOUNT, unexpectedApprovals: false, unexpectedTransfers: false,
      createdAt: now.toISOString(), updatedAt: now.toISOString() } };
  f.run = hooks => runPunkAgentMissionOnce({ deployment: manifest, client: f.client, now,
    signer: { address: SIGNER, signMessage: async () => { f.signatures++; return `0x${"12".repeat(64)}1b`; } },
    gas: { verificationGasLimit: "100000", callGasLimit: "150000", preVerificationGas: "50000", maxPriorityFeePerGas: "1", maxFeePerGas: "2" },
    bundler: { request: async ({ method }) => {
      if (method === "eth_chainId") return "0x1237";
      if (method === "eth_supportedEntryPoints") return [manifest.entryPoint];
      if (method === "eth_estimateUserOperationGas") { hooks?.estimate?.(); return { verificationGasLimit: "90000", callGasLimit: "140000", preVerificationGas: "40000" }; }
      if (method === "eth_sendUserOperation") { f.submissions++; return hash("e"); }
      throw Error(`Unexpected bundler ${method}`);
    } }, loadMission: async () => f.mission,
    loadCandidate: async () => { hooks?.candidate?.(); return f.candidate; },
    reserveOperation: async () => { f.reserved++; hooks?.reserve?.(); return { operationId: "local-operation" }; },
    markSubmitted: async () => { f.recorded++; }, markFailed: async failure => { f.failures.push(failure); } });
  return f;
}

const BOUND = parseAbiItem('event SessionEpochBound(uint64 indexed generation,uint256 indexed epoch,uint256 securityGeneration)');
function epochFixture() {
  const f = fixture();
  f.manifest.schema = 'GOGH_PUNK_EPOCH_ACCOUNT_DEPLOYMENT_V1';
  Object.assign(f.manifest.configuration, { wrapperOperatorRegistrationConfirmed: true,
    wrappedOwnerIntegrationReady: true, legacyEnrollmentReviewed: true });
  const record = address => ({ ...f.manifest.contracts.GoghPunkAgentAccount, address });
  f.manifest.epochAuthority = { wrapper: record(addr('8')), epochs: record(addr('9')), progression: record(addr('a')) };
  f.epoch = 1n; f.authorizedEpoch = 1n; f.security = 0n;
  const originalRead = f.client.readContract;
  f.client.readContract = async query => {
    const values = { AUTHORITY_MODEL: keccak256(new TextEncoder().encode('GOGH_WRAPPED_EPOCH_V1')),
      wrapper: addr('8'), epochs: addr('9'), progression: addr('a'), authorizedEpoch: f.authorizedEpoch,
      authorizedSecurityGeneration: 0n, COLLECTION: ROBINHOOD.canonicalCollection, CHAIN_ID: 4663n,
      resolveOwner: f.owner, isWrapped: true, epoch: f.epoch, securityGeneration: f.security, executionPaused: false };
    if (query.functionName === 'ownerOf') return query.address.toLowerCase() === ROBINHOOD.canonicalCollection.toLowerCase() ? addr('8') : f.owner;
    return Object.hasOwn(values, query.functionName) ? values[query.functionName] : originalRead(query);
  };
  const receipt = f.receipt;
  f.receipt = () => { const r = receipt(); r.logs.push(log(BOUND, { generation: f.session.generation,
    epoch: f.authorizedEpoch, securityGeneration: 0n }, ACCOUNT, f.from, hash('a'))); return r; };
  return f;
}

test('pinned epoch worker validates authorization event without polling original Transfer history', async () => {
  const f = epochFixture(); const result = await f.run();
  assert.equal(result.status, 'SUBMITTED'); assert.equal(f.signatures, 1); assert.equal(f.submissions, 1);
  assert.equal(f.queries.length, 0);
});
for (const point of ['initial', 'candidate', 'estimate', 'reserve']) {
  test(`epoch worker rejects round trip at ${point}`, async () => {
    const f = epochFixture(); const change = () => { f.epoch = 3n; };
    if (point === 'initial') change();
    const result = await f.run({ [point]: change });
    assert.equal(result.status, 'OWNERSHIP_CHANGED_SINCE_AUTHORIZATION'); assert.equal(f.submissions, 0);
    assert.equal(f.signatures, ['estimate', 'reserve'].includes(point) ? 1 : 0);
    assert.equal(f.failures[0].terminal, true);
  });
}
test('epoch worker rejects missing binding event, tampered code pins and emergency generation change', async () => {
  const missing = epochFixture(); const receipt = missing.receipt;
  missing.receipt = () => ({ ...receipt(), logs: receipt().logs.slice(0, 1) });
  await assert.rejects(missing.check(), { code: 'OWNERSHIP_CONTINUITY_UNVERIFIED' });
  const tampered = epochFixture(); tampered.manifest.epochAuthority.wrapper.runtimeBytecodeHash = hash('f');
  await assert.rejects(tampered.check(), { code: 'OWNERSHIP_CONTINUITY_UNVERIFIED' });
  const paused = epochFixture(); paused.security = 2n;
  await assert.rejects(paused.check(), { code: 'OWNERSHIP_CHANGED_SINCE_AUTHORIZATION' });
});
test('new epoch authorization works and does not inherit legacy history-window limits', async () => {
  const f = epochFixture(); f.epoch = 3n; f.authorizedEpoch = 3n;
  f.session.generation = 2n; f.mission.sessionGeneration = '2'; f.to = f.from + 40_001n;
  assert.equal((await f.check()).verified, true);
});

test("canonical authorization and bounded continuous ownership are required", async () => {
  const f = fixture(), result = await f.check();
  assert.equal(result.verified, true); assert.equal(result.fromBlock, "100"); assert.equal(result.toBlock, "110");
  assert.equal(f.queries[0].address, ROBINHOOD.canonicalCollection); assert.equal(f.queries[0].args.tokenId, 93n);
});
test("round trip is rejected even though current owner and active session are unchanged", async () => {
  const f = fixture(); f.roundTrip();
  await assert.rejects(f.check(), { code: "OWNERSHIP_CHANGED_SINCE_AUTHORIZATION" });
});
test("new authorization after a transfer starts a new history window", async () => {
  const f = fixture(); f.roundTrip(); f.from = 120n; f.to = 130n; f.session.generation = 2n; f.mission.sessionGeneration = "2";
  assert.equal((await f.check()).verified, true);
});
test("history is chunked without gaps and capped", async () => {
  const f = fixture(); f.to = 4200n; await f.check();
  assert.deepEqual(f.queries.map(q => [q.fromBlock, q.toBlock]), [[100n, 2099n], [2100n, 4099n], [4100n, 4200n]]);
  f.to = 40100n; await assert.rejects(f.check(), { code: "OWNERSHIP_HISTORY_WINDOW_EXCEEDED" });
});
for (const mode of ["missing_hash", "reverted", "wrong_hash", "wrong_generation", "wrong_event_owner", "wrong_account",
  "anchor_reorg", "rpc_error", "malformed_logs", "removed_log", "wrong_log_token", "stale_head", "same_height_reorg", "wrong_chain"]) {
  test(`continuity fails closed: ${mode}`, async () => {
    const f = fixture(), receipt = f.receipt();
    if (mode === "missing_hash") delete f.mission.authorizationTransactionHash;
    if (mode === "reverted") receipt.status = "reverted";
    if (mode === "wrong_hash") receipt.transactionHash = hash("f");
    if (mode === "wrong_generation") f.mission.sessionGeneration = "2";
    if (mode === "wrong_event_owner") receipt.logs[0].topics[2] = `0x${"0".repeat(24)}${OTHER.slice(2)}`;
    if (mode === "wrong_account") receipt.logs[0].address = OTHER;
    if (mode === "anchor_reorg") receipt.blockHash = hash("f");
    if (mode === "rpc_error") f.client.getLogs = async () => { throw Error("secret provider details"); };
    if (mode === "malformed_logs") f.client.getLogs = async () => null;
    if (["removed_log", "wrong_log_token"].includes(mode)) {
      f.roundTrip();
      if (mode === "removed_log") f.logs[0].removed = true;
      else f.logs[0].topics[3] = `0x${"0".repeat(63)}1`;
    }
    if (mode === "stale_head") { const get = f.client.getBlock; f.client.getBlock = async input => ({ ...await get(input), timestamp: 1n }); }
    if (mode === "same_height_reorg") { const get = f.client.getBlock; let latest = 0; f.client.getBlock = async input => ({ ...await get(input), ...(input.blockTag === "latest" && ++latest > 1 ? { hash: hash("f") } : {}) }); }
    if (mode === "wrong_chain") f.client.getChainId = async () => 1;
    f.receipt = () => receipt;
    await assert.rejects(f.check(), e => ["OWNERSHIP_CONTINUITY_UNVERIFIED", "SESSION_STATE_MISMATCH"].includes(e.code) && !e.message.includes("secret"));
  });
}
test("worker permits a continuously authorized mock mint", async () => {
  const f = fixture(); assert.equal((await f.run()).status, "SUBMITTED");
  assert.equal(f.signatures, 1); assert.equal(f.submissions, 1); assert.equal(f.recorded, 1);
  assert.equal(f.queries.length, 3);
});
for (const stage of ["initial", "candidate", "estimate", "reserve"]) test(`worker blocks round trip at ${stage}`, async () => {
  const f = fixture(); if (stage === "initial") f.roundTrip();
  const result = await f.run({ [stage]: () => f.roundTrip() });
  assert.equal(result.status, "OWNERSHIP_CHANGED_SINCE_AUTHORIZATION");
  assert.equal(f.submissions, 0); assert.equal(f.recorded, 0);
  assert.equal(f.signatures, ["estimate", "reserve"].includes(stage) ? 1 : 0);
  assert.equal(f.failures[0].terminal, true);
  if (["estimate", "reserve"].includes(stage)) assert.equal(f.failures[0].reservation.operationId, "local-operation");
});
test("worker with missing historical evidence never signs, submits or treats owner equality as sufficient", async () => {
  const f = fixture(); delete f.mission.authorizationTransactionHash;
  assert.equal((await f.run()).status, "OWNERSHIP_CONTINUITY_UNVERIFIED");
  assert.equal(f.signatures, 0); assert.equal(f.submissions, 0); assert.equal(f.failures[0].terminal, false);
});
test("worker never exposes an arbitrary provider error code", async () => {
  const f = fixture(); f.client.getCode = async () => { throw Object.assign(Error("private"), { code: "secret provider response" }); };
  const result = await f.run();
  assert.equal(result.status, "OWNERSHIP_CONTINUITY_UNVERIFIED");
  assert.equal(JSON.stringify(f.failures).includes("secret"), false);
  assert.equal(f.signatures, 0); assert.equal(f.submissions, 0);
});
test("transfer inside the authorization block is conservatively blocked", async () => {
  const f = fixture(); f.roundTrip(); f.logs[0].blockNumber = f.from; f.logs[0].blockHash = hash("a");
  await assert.rejects(f.check(), { code: "OWNERSHIP_CHANGED_SINCE_AUTHORIZATION" });
});

function advancingHead(f = fixture()) {
  f.head = f.to; f.latestReads = 0; f.stateReads = []; f.step = 2n;
  f.blockHash = number => number === f.from ? hash("a") : `0x${number.toString(16).padStart(64, "0")}`;
  const timestamp = BigInt(Math.floor(f.now.getTime() / 1_000));
  f.client.getBlock = async ({ blockNumber }) => {
    if (blockNumber === undefined) {
      if (f.latestReads++) f.head += f.step;
      const block = { number: f.head, hash: f.blockHash(f.head), timestamp };
      if (f.latestReads === 2) f.onClosing?.(block);
      return block;
    }
    return { number: blockNumber, hash: f.blockHash(blockNumber), timestamp };
  };
  const read = f.client.readContract;
  f.client.readContract = query => { f.stateReads.push(query); return read(query); };
  return f;
}

test("advancing head is covered without gaps and evidence stops at the checked closing block", async () => {
  const f = advancingHead(), result = await f.check();
  assert.equal(result.verified, true); assert.equal(result.toBlock, "112");
  assert.equal(result.blockHash, f.blockHash(112n)); assert.equal(f.latestReads, 2);
  assert.deepEqual(f.queries.map(q => [q.fromBlock, q.toBlock]), [[100n, 110n], [111n, 112n]]);
  for (const functionName of ["ownerOf", "sessionGeneration", "isAutonomousSessionActive"])
    assert.deepEqual(f.stateReads.filter(q => q.functionName === functionName).map(q => q.blockNumber), [110n, 112n]);
});

test("worker can scan, sign and submit on an advancing chain with all three guards", async () => {
  const f = advancingHead(); assert.equal((await f.run()).status, "SUBMITTED");
  assert.equal(f.latestReads, 6); assert.equal(f.signatures, 1); assert.equal(f.submissions, 1);
  assert.deepEqual(f.queries.map(q => [q.fromBlock, q.toBlock]), [
    [100n, 110n], [111n, 112n], [100n, 114n], [115n, 116n], [100n, 118n], [119n, 120n],
  ]);
});

for (const height of [111n, 112n]) test(`a transfer at tail block ${height} blocks signing even if the current owner is unchanged`, async () => {
  const f = advancingHead();
  f.onClosing = () => { f.logs = [log(TRANSFER, { from: OWNER, to: OTHER, tokenId: 93n },
    ROBINHOOD.canonicalCollection, height, f.blockHash(height))]; };
  assert.equal((await f.run()).status, "OWNERSHIP_CHANGED_SINCE_AUTHORIZATION");
  assert.equal(f.signatures, 0); assert.equal(f.submissions, 0); assert.equal(f.failures[0].terminal, true);
});

test("away-and-back transfers entirely inside the new tail are rejected", async () => {
  const f = advancingHead(); f.onClosing = () => { f.logs = [
    log(TRANSFER, { from: OWNER, to: OTHER, tokenId: 93n }, ROBINHOOD.canonicalCollection, 111n, f.blockHash(111n)),
    log(TRANSFER, { from: OTHER, to: OWNER, tokenId: 93n }, ROBINHOOD.canonicalCollection, 112n, f.blockHash(112n)),
  ]; };
  await assert.rejects(f.check(), { code: "OWNERSHIP_CHANGED_SINCE_AUTHORIZATION" });
});

for (const change of ["owner", "generation", "revoked", "epoch", "security"]) {
  test(`closing snapshot rechecks ${change}`, async () => {
    const f = advancingHead(["epoch", "security"].includes(change) ? epochFixture() : fixture());
    f.onClosing = () => {
      if (change === "owner") f.owner = OTHER;
      if (change === "generation") f.session.generation++;
      if (change === "epoch") f.epoch += 2n;
      if (change === "security") f.security++;
      if (change === "revoked") {
        const read = f.client.readContract;
        f.client.readContract = query => query.functionName === "isAutonomousSessionActive" ? false : read(query);
      }
    };
    await assert.rejects(f.check(), { code: change === "owner" ? "OWNER_CHANGED"
      : ["epoch", "security"].includes(change) ? "OWNERSHIP_CHANGED_SINCE_AUTHORIZATION" : "SESSION_STATE_MISMATCH" });
  });
}

for (const fault of ["backwards", "too_far", "stale", "future", "timestamp_backwards", "missing_hash", "tail_rpc", "tail_malformed",
  "tail_removed", "tail_wrong_token", "tail_noncanonical", "initial_reorg", "anchor_reorg", "closing_reorg", "closing_wrong_number"]) {
  test(`advancing snapshot fails closed: ${fault}`, async () => {
    const f = advancingHead(), get = f.client.getBlock, logs = f.client.getLogs;
    f.onClosing = block => {
      if (fault === "backwards") block.number = 109n;
      if (fault === "too_far") block.number = 2111n;
      if (fault === "stale") block.timestamp -= 31n;
      if (fault === "future") block.timestamp += 60n;
      if (fault === "timestamp_backwards") block.timestamp--;
      if (fault === "missing_hash") delete block.hash;
      if (["tail_removed", "tail_wrong_token", "tail_noncanonical"].includes(fault)) {
        f.logs = [log(TRANSFER, { from: OWNER, to: OTHER, tokenId: fault === "tail_wrong_token" ? 94n : 93n },
          ROBINHOOD.canonicalCollection, 111n, fault === "tail_noncanonical" ? hash("f") : f.blockHash(111n))];
        if (fault === "tail_removed") f.logs[0].removed = true;
      }
    };
    f.client.getLogs = query => {
      if (query.fromBlock > f.to && fault === "tail_rpc") throw Error("private provider error");
      if (query.fromBlock > f.to && fault === "tail_malformed") return null;
      return logs(query);
    };
    f.client.getBlock = async query => {
      const block = await get(query);
      if (f.latestReads >= 2 && query.blockNumber !== undefined) {
        if ((fault === "initial_reorg" && query.blockNumber === 110n)
          || (fault === "anchor_reorg" && query.blockNumber === 100n)
          || (fault === "closing_reorg" && query.blockNumber === 112n)) block.hash = hash("f");
        if (fault === "closing_wrong_number" && query.blockNumber === 112n) block.number = 113n;
      }
      return block;
    };
    await assert.rejects(f.check(), { code: "OWNERSHIP_CONTINUITY_UNVERIFIED" });
  });
}

test("the closing tail cannot extend the inclusive legacy history cap", async () => {
  const f = fixture(); f.to = 40099n; advancingHead(f);
  await assert.rejects(f.check(), { code: "OWNERSHIP_HISTORY_WINDOW_EXCEEDED" });
  assert.equal(f.queries.at(-1).toBlock, 40099n);
});

test("a slow closing read cannot return expired evidence", async t => {
  const f = advancingHead(); let now = f.now.getTime(); t.mock.method(Date, "now", () => now);
  const read = f.client.readContract;
  f.client.readContract = query => { if (query.blockNumber === 112n) now += 31_000; return read(query); };
  await assert.rejects(f.check(), { code: "OWNERSHIP_CONTINUITY_UNVERIFIED" });
});

test("a transfer in the final guard's new tail preserves reconciliation and prevents submission", async () => {
  const f = advancingHead(), get = f.client.getBlock;
  f.client.getBlock = async query => {
    const block = await get(query);
    if (query.blockTag === "latest" && f.latestReads === 6) f.logs = [
      log(TRANSFER, { from: OWNER, to: OTHER, tokenId: 93n }, ROBINHOOD.canonicalCollection, 119n, f.blockHash(119n)),
      log(TRANSFER, { from: OTHER, to: OWNER, tokenId: 93n }, ROBINHOOD.canonicalCollection, 120n, f.blockHash(120n)),
    ];
    return block;
  };
  assert.equal((await f.run()).status, "OWNERSHIP_CHANGED_SINCE_AUTHORIZATION");
  assert.equal(f.signatures, 1); assert.equal(f.reserved, 1); assert.equal(f.submissions, 0); assert.equal(f.recorded, 0);
  assert.equal(f.failures[0].reservation.operationId, "local-operation");
});

test("further block production during closing state reads does not extend the attested range", async () => {
  const f = advancingHead(), read = f.client.readContract;
  f.client.readContract = query => { if (query.blockNumber === 112n) f.head++; return read(query); };
  const evidence = await f.check();
  assert.equal(f.head, 115n); assert.equal(evidence.toBlock, "112");
  assert.equal(evidence.blockHash, f.blockHash(112n)); assert.equal(f.queries.at(-1).toBlock, 112n);
});
