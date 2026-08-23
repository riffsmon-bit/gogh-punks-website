import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { screenAutomatedSeaDropLiveFromFiles } from
  "../scripts/screen-automated-seadrop-live.mjs";

test("live screen CLI fails before RPC when endpoints or exact inputs are missing", async () => {
  await assert.rejects(
    screenAutomatedSeaDropLiveFromFiles([], {}),
    { code: "INVALID_ARGUMENTS" },
  );
  await assert.rejects(
    screenAutomatedSeaDropLiveFromFiles([
      "--candidate", "missing.json", "--scope", "missing.json",
    ], {}),
    { code: "INVALID_PROVIDER" },
  );
});

test("live screen CLI refuses symlink input files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gogh-v2-screen-"));
  const target = join(directory, "target.json");
  const linked = join(directory, "linked.json");
  await writeFile(target, "{}", { mode: 0o600 });
  await symlink(target, linked);
  await assert.rejects(
    screenAutomatedSeaDropLiveFromFiles([
      "--candidate", linked, "--scope", target,
    ], {
      ROBINHOOD_RPC_URL: "https://official.example/rpc",
      ROBINHOOD_SECONDARY_RPC_URL: "https://secondary.example/rpc",
    }),
    { code: "INVALID_FILE" },
  );
});

test("live screen source has no signer, wallet, send, deploy, or write path", async () => {
  const source = await readFile(
    new URL("../scripts/screen-automated-seadrop-live.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /O_NOFOLLOW/);
  assert.match(source, /createPublicClient/);
  assert.doesNotMatch(source, /createWalletClient|privateKeyToAccount|sendTransaction|sendRawTransaction/);
  assert.doesNotMatch(source, /writeContract|deployContract|writeFile|appendFile/);
});
