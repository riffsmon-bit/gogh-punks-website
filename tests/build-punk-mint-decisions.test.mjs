import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  parseMintDecisionArguments,
  runPunkMintDecisionCli,
} from "../scripts/build-punk-mint-decisions.mjs";

const OPPORTUNITY = {
  id: "runner-free-mint",
  chainId: 4663,
  opportunityType: "FREE_MINT",
  collection: "0x1111111111111111111111111111111111111111",
  tokenId: "42",
  expectedPrice: "0",
  maxPrice: "0",
  riskLabel: "LOWER_RISK",
  scores: { contractRiskScore: 10, artConfidence: 50, contractRiskConfidence: 50 },
  metadata: {
    actionableMint: true,
    mintPriceStatus: "KNOWN",
    mintContract: "0x2222222222222222222222222222222222222222",
    collectionSignals: { art: { dimensions: { pixelArt: 90 } } },
  },
};
const PUNKS = [{
  tokenId: "1",
  account: "0x3333333333333333333333333333333333333333",
  expectedOwner: "0x4444444444444444444444444444444444444444",
  personaKey: "PIXEL_MAXI",
  mandate: {
    tokenId: "1",
    configuredBy: "0x4444444444444444444444444444444444444444",
    mode: "SCOUT",
    economicSettings: { allowFreeMints: true, maxMintsPerDay: 1 },
    riskSettings: { maxContractRiskScore: 30 },
    artisticPreferences: { minimumTasteMatch: 0 },
  },
  controls: { acquisitionsToday: 0 },
}];

test("runner parser accepts exactly two named input files", () => {
  assert.deepEqual(parseMintDecisionArguments(["--opportunity", "a.json", "--punks", "b.json"]), {
    opportunityPath: "a.json",
    punksPath: "b.json",
  });
  assert.throws(() => parseMintDecisionArguments(["--execute", "yes"]), /unknown argument/);
  assert.throws(() => parseMintDecisionArguments(["--punks", "a.json"]), /both input files/);
  assert.throws(
    () => parseMintDecisionArguments(["--punks", "a.json", "--punks", "b.json", "--opportunity", "c.json"]),
    /duplicate argument/,
  );
});

test("runner builds a read-only proof from injected bounded JSON inputs", async () => {
  const files = new Map([
    [resolve("opportunity.json"), Buffer.from(JSON.stringify(OPPORTUNITY))],
    [resolve("punks.json"), Buffer.from(JSON.stringify(PUNKS))],
  ]);
  const result = await runPunkMintDecisionCli(
    ["--opportunity", "opportunity.json", "--punks", "punks.json"],
    { read: async (path) => files.get(path) },
  );
  assert.equal(result.artifact.decisions[0].decision, "RECOMMEND");
  assert.equal(result.artifact.security.rpcPerformed, false);
  assert.equal(result.artifact.security.persistencePerformed, false);
  assert.equal(result.artifact.security.identityEvidence, "SUPPLIED_UNVERIFIED_LOCAL");

  const oversized = async () => Buffer.alloc(1_000_001);
  await assert.rejects(
    () => runPunkMintDecisionCli(["--opportunity", "a", "--punks", "b"], { read: oversized }),
    /between 1 byte/,
  );
});

test("executable writes only the JSON proof to stdout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gogh-mint-decisions-"));
  const opportunityPath = join(directory, "opportunity.json");
  const punksPath = join(directory, "punks.json");
  await writeFile(opportunityPath, JSON.stringify(OPPORTUNITY));
  await writeFile(punksPath, JSON.stringify(PUNKS));
  const beforeOpportunity = await readFile(opportunityPath, "utf8");
  const beforePunks = await readFile(punksPath, "utf8");
  const result = spawnSync(process.execPath, [
    resolve("scripts/build-punk-mint-decisions.mjs"),
    "--opportunity", opportunityPath,
    "--punks", punksPath,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.artifact.security.signingPerformed, false);
  assert.equal(parsed.artifact.security.chainWritePerformed, false);
  assert.equal(await readFile(opportunityPath, "utf8"), beforeOpportunity);
  assert.equal(await readFile(punksPath, "utf8"), beforePunks);
});
