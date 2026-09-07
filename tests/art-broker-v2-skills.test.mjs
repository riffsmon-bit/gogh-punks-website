import assert from "node:assert/strict";
import test from "node:test";

import { activatePunkSkill, draftPunkSkillFromConversation,
  isTeachPunkSkillMessage, normalizePunkSkill } from "../broker/src/v4/punk-skill.mjs";

const OWNER = "0x1111111111111111111111111111111111111111";
const PUNK_WALLET = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-09-06T20:00:00.000Z");

test("owner conversation compiles a bounded read-only Punk skill", () => {
  const skill = draftPunkSkillFromConversation({
    message: "Teach yourself to rank small pixel collections and explain the screening result.",
    punkTokenId: "93", expectedOwner: OWNER, punkWallet: PUNK_WALLET, now: NOW,
  });
  assert.equal(isTeachPunkSkillMessage("Teach my Punk to inspect links."), true);
  assert.equal(skill.schema, "GOGH_PUNK_SKILL_V1");
  assert.equal(skill.state, "DRAFT");
  assert.equal(skill.authority, "READ_ONLY");
  assert.equal(skill.policyEffect, "NONE");
  assert.deepEqual(skill.capabilities, ["EXPLAIN_SCREENING", "RANK_POLICY_MATCHES",
    "REVIEW_COLLECTION", "EXPLAIN_FINDINGS"]);
  assert.equal(Object.isFrozen(skill), true);
  assert.deepEqual(normalizePunkSkill(skill), skill);
});

test("a taught skill needs matching current-owner confirmation", () => {
  const draft = draftPunkSkillFromConversation({ message: "Teach yourself to inspect mint links.",
    punkTokenId: "93", expectedOwner: OWNER, punkWallet: PUNK_WALLET, now: NOW });
  const active = activatePunkSkill(draft, { owner: OWNER, punkTokenId: "93",
    punkWallet: PUNK_WALLET });
  assert.equal(active.state, "ACTIVE");
  assert.throws(() => activatePunkSkill(draft, { owner: PUNK_WALLET, punkTokenId: "93",
    punkWallet: PUNK_WALLET }), /current owner/);
});

test("skills cannot encode wallet authority or safety bypasses", () => {
  for (const message of [
    "Teach yourself to sign any transaction.",
    "Teach yourself to withdraw all assets.",
    "Teach yourself to bypass simulation.",
    "Teach yourself my private key.",
  ]) {
    assert.throws(() => draftPunkSkillFromConversation({ message, punkTokenId: "93",
      expectedOwner: OWNER, punkWallet: PUNK_WALLET, now: NOW }), /unsafe authority/);
  }
});
