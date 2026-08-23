import assert from "node:assert/strict";
import test from "node:test";

import { encodeAbiParameters, encodeEventTopics } from "viem";
import {
  PUBLIC_DROP_UPDATED_EVENT,
  SEADROP_HINT_INDEX_SCHEMA,
  buildSeaDropPublicDropHintIndex,
} from "../broker/src/discovery/seadrop-public-drop-index.mjs";
import { SEA_DROP } from "../broker/src/recommendation/automated-seadrop-run-plan.mjs";

const A = (digit) => `0x${digit.repeat(40)}`;
const H = (digit) => `0x${digit.repeat(64)}`;

function log(collection, blockNumber, price = 0n, end = 1_800_001_000n) {
  const drop = {
    mintPrice: price, startTime: 1_799_999_000n, endTime: end,
    maxTotalMintableByWallet: 3, feeBps: 250, restrictFeeRecipients: true,
  };
  return {
    address: SEA_DROP,
    blockNumber: String(blockNumber), blockHash: H("a"), transactionHash: H("b"),
    transactionIndex: 1, logIndex: blockNumber, removed: false,
    topics: encodeEventTopics({ abi: [PUBLIC_DROP_UPDATED_EVENT], eventName: "PublicDropUpdated", args: { nftContract: collection } }),
    data: encodeAbiParameters([{
      type: "tuple", components: [
        { name: "mintPrice", type: "uint80" }, { name: "startTime", type: "uint48" },
        { name: "endTime", type: "uint48" }, { name: "maxTotalMintableByWallet", type: "uint16" },
        { name: "feeBps", type: "uint16" }, { name: "restrictFeeRecipients", type: "bool" },
      ],
    }], [drop]),
  };
}

function options() {
  return {
    chainId: 4663, fromBlock: "1", confirmedBlock: "100",
    confirmedBlockHash: H("c"), confirmedBlockTimestamp: "1800000000",
    checkedAt: "2027-01-15T08:00:00.000Z",
    sourceOrigin: "https://rpc.mainnet.chain.robinhood.com",
  };
}

test("retains the latest update and emits only active zero-price discovery hints", () => {
  const result = buildSeaDropPublicDropHintIndex([
    log(A("1"), 2, 1n), log(A("1"), 3, 0n), log(A("2"), 4, 1n),
    log(A("3"), 5, 0n, 1_799_999_999n),
  ], options());
  assert.equal(result.schema, SEADROP_HINT_INDEX_SCHEMA);
  assert.equal(result.uniqueUpdatedCollections, 3);
  assert.deepEqual(result.candidates.map((item) => item.collection), [A("1")]);
  assert.equal(result.source.authoritativeExecutionEvidence, false);
  assert.equal(result.safety.candidatesAuthorized, false);
  assert.match(result.indexHash, /^0x[0-9a-f]{64}$/);
});

test("rejects removed, foreign, malformed, excessive-range, and hostile logs", () => {
  const mutations = [
    (logs) => { logs[0].removed = true; },
    (logs) => { logs[0].address = A("9"); },
    (logs) => { logs[0].topics[0] = H("f"); },
    (logs, opts) => { opts.fromBlock = "0"; opts.confirmedBlock = "100001"; },
  ];
  for (const mutate of mutations) {
    const logs = [log(A("1"), 2)]; const opts = options(); mutate(logs, opts);
    assert.throws(() => buildSeaDropPublicDropHintIndex(logs, opts));
  }
  let invoked = 0;
  const hostile = log(A("1"), 2);
  Object.defineProperty(hostile, "data", { enumerable: true, get() { invoked += 1; return "0x"; } });
  assert.throws(() => buildSeaDropPublicDropHintIndex([hostile], options()), { code: "INVALID_JSON" });
  assert.equal(invoked, 0);
});

test("real discovery CLI source has no signer, wallet, submission, or write path", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("../scripts/discover-active-seadrop-free-mints.mjs", import.meta.url), "utf8",
  ));
  assert.doesNotMatch(source, /privateKey|walletClient|sendTransaction|sendRawTransaction|writeFile|appendFile|deployContract/);
});
