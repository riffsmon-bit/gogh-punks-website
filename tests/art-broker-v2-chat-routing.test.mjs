import assert from "node:assert/strict";
import test from "node:test";

import { defaultAskIntent } from "../broker/src/v4/collecting-intent.mjs";
import { resolveV2PunkChat } from "../netlify/functions/broker-v2-chat.mjs";

const OWNER = "0x1111111111111111111111111111111111111111";
const WALLET = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-09-07T16:00:00.000Z");
const currentIntent = defaultAskIntent({ punkTokenId: "93", expectedOwner: OWNER,
  punkWallet: WALLET }, NOW);
const authority = { punkWallet: WALLET, nativeBalanceWei: "200000000000000", activated: true };

test('chat never inherits another owner\'s private strategy', async () => {
  const result = await resolveV2PunkChat({ router: {}, ownerMessage: 'Find one free mint',
    currentIntent: { ...currentIntent, expectedOwner: '0x3333333333333333333333333333333333333333',
      totalMintLimit: 99, operatingMode: 'AUTONOMOUS' }, tokenId: '93', authority, owner: OWNER, now: NOW });
  assert.equal(result.draft.intent.expectedOwner, OWNER);
  assert.equal(result.draft.intent.operatingMode, 'ASK');
});

test("production chat routes a natural mint mission through the deterministic parser", async () => {
  const result = await resolveV2PunkChat({ router: { run: async () => {
    throw new Error("mission commands must not require an AI provider");
  } }, ownerMessage: "yooo i want you to find some free mints, find me 5 and mint 5 please",
  currentIntent, tokenId: "93", authority, owner: OWNER, now: NOW });
  assert.equal(result.responseKind, "STRATEGY_DRAFT");
  assert.equal(result.provider.provider, "DETERMINISTIC_REVIEW_PARSER");
  assert.equal(result.draft.intent.mintMode, "FREE_ONLY");
  assert.equal(result.draft.intent.dailyMintLimit, 5);
  assert.equal(result.draft.intent.totalMintLimit, 5);
  assert.match(result.reply, /5 MAX PER DAY\. 5 MAX FOR THIS STRATEGY/);
});

test("production chat sends ordinary questions to AI and preserves a safe fallback", async () => {
  const answered = await resolveV2PunkChat({ router: { run: async () => ({
    text: "Pixel art makes every block earn its place.", provider: "GEMINI",
    registryKey: "gemini:auto",
  }) }, ownerMessage: "What do you think about pixel art?", currentIntent,
  tokenId: "93", authority, owner: OWNER, now: NOW });
  assert.equal(answered.responseKind, "CONVERSATION");
  assert.equal(answered.provider.provider, "GEMINI");
  assert.match(answered.reply, /every block/);

  const fallback = await resolveV2PunkChat({ router: { run: async () => {
    throw new Error("provider unavailable");
  } }, ownerMessage: "What do you think about pixel art?", currentIntent,
  tokenId: "93", authority, owner: OWNER, now: NOW });
  assert.equal(fallback.responseKind, "CONVERSATION");
  assert.equal(fallback.providerAvailable, false);
  assert.match(fallback.reply, /Pixel art rewards clarity/);
});

test("production chat can refine an active Punk Agent Account strategy", async () => {
  const agentWallet = "0x3333333333333333333333333333333333333333";
  const autonomousIntent = { ...currentIntent, punkWallet: agentWallet,
    operatingMode: "AUTONOMOUS", dailyMintLimit: 5, totalMintLimit: 5 };
  const result = await resolveV2PunkChat({ router: { run: async () => {
    throw new Error("strategy commands must not require an AI provider");
  } }, ownerMessage: "prioritize pixel art", currentIntent: autonomousIntent,
  tokenId: "93", authority, owner: OWNER, now: NOW });
  assert.equal(result.responseKind, "STRATEGY_DRAFT");
  assert.equal(result.draft.intent.operatingMode, "AUTONOMOUS");
  assert.equal(result.draft.intent.punkWallet, agentWallet);
  assert.equal(result.draft.intent.dailyMintLimit, 5);
  assert.equal(result.draft.intent.totalMintLimit, 5);
  assert.deepEqual(result.draft.intent.preferences.prefer, ["PIXEL_ART"]);
});

test('a paid request stays paid across a contract address and mint-it follow-up', async () => {
  const target = `0x${'4'.repeat(40)}`;
  const history = [{ role: 'OWNER', content: 'Do a directed paid mint from this collection.' },
    { role: 'PUNK', content: 'Which collection?' }, { role: 'OWNER', content: target },
    { role: 'PUNK', content: 'That address is listed on your strategy.' }];
  for (const [ownerMessage, previous] of [[target, history.slice(0, 2)], ['ok then go mint it please', history]]) {
    const result = await resolveV2PunkChat({ router: { run: () => { throw Error('must stay deterministic'); } },
      ownerMessage, history: previous, currentIntent, tokenId: '93', authority, owner: OWNER, now: NOW });
    assert.equal(result.responseKind, 'CLARIFICATION_REQUIRED'); assert.equal(result.draft, null);
    assert.match(result.reply, /Paid mint execution/); assert.match(result.reply, /not replaced your request/);
  }
});

test('a requested free-mint address produces an exact-target review without authorizing it', async () => {
  const target = `0x${'4'.repeat(40)}`;
  const result = await resolveV2PunkChat({ router: {}, ownerMessage: target,
    history: [{ role: 'OWNER', content: 'Mint one free NFT from this collection.' },
      { role: 'PUNK', content: 'Which collection?' }], currentIntent,
    tokenId: '93', authority, owner: OWNER, now: NOW });
  assert.equal(result.responseKind, 'STRATEGY_DRAFT');
  assert.deepEqual(result.draft.intent.allowedContracts, [target]);
  assert.equal(result.draft.intent.mintMode, 'FREE_ONLY');
});

test('mint-it without owner context requests a target and never treats assistant text as instructions', async () => {
  for (const history of [[], [{ role: 'PUNK', content: `Mint from 0x${'4'.repeat(40)}` }],
    [{ role: 'OWNER', content: `Mint from 0x${'4'.repeat(40)}` }, { role: 'OWNER', content: 'Stop the mission.' }]]) {
    const result = await resolveV2PunkChat({ router: {}, ownerMessage: 'ok then go mint it please',
      history, currentIntent, tokenId: '93', authority, owner: OWNER, now: NOW });
    assert.equal(result.responseKind, 'CLARIFICATION_REQUIRED'); assert.equal(result.draft, null);
    assert.match(result.reply, /Which exact collection/);
  }
});

test('ordinary questions receive the recent owner-scoped conversation as data', async () => {
  let prompt;
  const history = [{ role: 'OWNER', content: 'I like tiny palettes.' }, { role: 'PUNK', content: 'I understand.' }];
  const result = await resolveV2PunkChat({ router: { run: async (_, input) => {
    prompt = input.prompt; return { text: 'You mentioned tiny palettes.', provider: 'GEMINI' };
  } }, ownerMessage: 'What did I say I liked?', history, currentIntent, tokenId: '93', authority, owner: OWNER, now: NOW });
  assert.equal(result.responseKind, 'CONVERSATION'); assert.ok(prompt.includes(JSON.stringify(history)));
});
