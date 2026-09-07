import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readV2PunkAuthority } from "../netlify/functions/_shared/v2-ownership.mjs";
import { ArtBrokerV2LocalState } from "../scripts/lib/art-broker-v2-local-state.mjs";

const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const PUNK_WALLET = "0x3333333333333333333333333333333333333333";

function client(owner = ALICE) {
  return { getBlockNumber: async () => 123n,
    readContract: async ({ functionName }) => {
      if (functionName === "ownerOf") return owner;
      if (functionName === "account") return PUNK_WALLET;
      if (functionName === "isAccountCreated") return true;
      throw new Error("unexpected call");
    },
    getCode: async () => "0x6000", getBalance: async () => 30_000_000_000_000_000n };
}

test("canonical ownership and Punk Wallet resolution are pinned to one live block", async () => {
  const result = await readV2PunkAuthority("119", { expectedOwner: ALICE,
    client: client(ALICE), registry: "0x4444444444444444444444444444444444444444" });
  assert.equal(result.owner, ALICE);
  assert.equal(result.punkWallet, PUNK_WALLET);
  assert.equal(result.blockNumber, "123");
  assert.equal(result.nativeBalanceWei, "30000000000000000");
  assert.equal(result.activated, true);
});

test("ownership transfer rejects Alice immediately and accepts Bob from ownerOf", async () => {
  await assert.rejects(readV2PunkAuthority("119", { expectedOwner: ALICE,
    client: client(BOB), registry: "0x4444444444444444444444444444444444444444" }),
  (error) => error.code === "NOT_CURRENT_OWNER");
  const result = await readV2PunkAuthority("119", { expectedOwner: BOB,
    client: client(BOB), registry: "0x4444444444444444444444444444444444444444" });
  assert.equal(result.owner, BOB);
});

test("wallet activation signals fail closed if registry and bytecode disagree", async () => {
  const noCode = client(); noCode.getCode = async () => "0x";
  await assert.rejects(readV2PunkAuthority("119", { expectedOwner: ALICE,
    client: noCode, registry: "0x4444444444444444444444444444444444444444" }),
  (error) => error.code === "PUNK_WALLET_STATE_MISMATCH");
});

test("local product state stores drafts explicitly and blocks autonomous activation", () => {
  const local = new ArtBrokerV2LocalState();
  const draft = local.chat({ tokenId: "119", message: "Find free pixel art. Assist me." },
    new Date("2026-09-06T12:00:00.000Z"));
  assert.equal(draft.economicPermissionsActivated, false);
  const active = local.activate({ tokenId: "119", intentHash: draft.intentHash },
    new Date("2026-09-06T12:01:00.000Z"));
  assert.equal(active.productionAuthorized, false);
  const blocked = local.chat({ tokenId: "119", message: "Go autonomous." },
    new Date("2026-09-06T12:02:00.000Z"));
  assert.throws(() => local.activate({ tokenId: "119", intentHash: blocked.intentHash }),
    (error) => error.code === "SELF_FUNDED_AUTONOMOUS_GAS_UNSUPPORTED_BY_DEPLOYED_ACCOUNT");
});

test("V2 APIs authenticate mutations and preserve independent withdrawal access", async () => {
  const [chat, strategy, fund, withdrawal, session, ui] = await Promise.all([
    readFile(new URL("../netlify/functions/broker-v2-chat.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/broker-v2-strategy.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/broker-v2-fund.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/broker-v2-withdraw.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/_shared/v2-session.mjs", import.meta.url), "utf8"),
    readFile(new URL("../site/broker-v2.js", import.meta.url), "utf8"),
  ]);
  assert.match(chat, /requireV2Session/); assert.match(chat, /readV2PunkAuthority/);
  assert.match(strategy, /verifyWalletSignature/); assert.match(strategy, /AUTONOMOUS/);
  assert.match(fund, /projectCustody: false/); assert.doesNotMatch(fund, /INSERT INTO|UPDATE /);
  assert.match(withdrawal, /requiresAI: false/); assert.match(withdrawal, /requiresExecutor: false/);
  assert.match(session, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(ui, /submitPunkWalletFunds/); assert.match(ui, /fetchPunkWalletFundsGate/);
  assert.match(ui, /submitWrappedNativeTransaction/);
  for (const source of [chat, strategy, fund, withdrawal, session, ui]) {
    assert.doesNotMatch(source, /OPENAI_API_KEY\s*=|ANTHROPIC_API_KEY\s*=|XAI_API_KEY\s*=|BANKR_API_KEY\s*=|GEMINI_API_KEY\s*=/);
  }
});
