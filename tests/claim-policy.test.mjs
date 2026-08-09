import assert from "node:assert/strict";
import test from "node:test";
import { ClaimDecision, decideClaim } from "../netlify/functions/_shared/claim-policy.mjs";

const walletA = "0x1111111111111111111111111111111111111111";
const walletB = "0x2222222222222222222222222222222222222222";

test("the 200th unique wallet is accepted", () => {
  assert.equal(
    decideClaim({
      existingRows: [],
      walletAddress: walletA,
      discordUserId: "100000000000000001",
      count: 199,
      cap: 200,
    }),
    ClaimDecision.CREATE,
  );
});

test("wallet 201 is rejected", () => {
  assert.equal(
    decideClaim({
      existingRows: [],
      walletAddress: walletA,
      discordUserId: "100000000000000001",
      count: 200,
      cap: 200,
    }),
    ClaimDecision.CAP_REACHED,
  );
});

test("an exact wallet and Discord pair is idempotent even after the cap", () => {
  assert.equal(
    decideClaim({
      existingRows: [
        { wallet_address: walletA, discord_user_id: "100000000000000001" },
      ],
      walletAddress: walletA.toUpperCase().replace("0X", "0x"),
      discordUserId: "100000000000000001",
      count: 200,
      cap: 200,
    }),
    ClaimDecision.IDEMPOTENT,
  );
});

test("a wallet cannot grant GTD to two Discord accounts", () => {
  assert.equal(
    decideClaim({
      existingRows: [
        { wallet_address: walletA, discord_user_id: "100000000000000001" },
      ],
      walletAddress: walletA,
      discordUserId: "100000000000000002",
      count: 1,
      cap: 200,
    }),
    ClaimDecision.WALLET_LINKED,
  );
});

test("a Discord account cannot capture with two wallets", () => {
  assert.equal(
    decideClaim({
      existingRows: [
        { wallet_address: walletA, discord_user_id: "100000000000000001" },
      ],
      walletAddress: walletB,
      discordUserId: "100000000000000001",
      count: 1,
      cap: 200,
    }),
    ClaimDecision.DISCORD_LINKED,
  );
});
