import assert from "node:assert/strict";
import test from "node:test";

import { decodeFunctionData } from "viem";

import {
  buildPunkAgentAccountSessionSetup,
  ENTRY_POINT_V08,
  PUNK_AGENT_ACCOUNT_SETUP_INPUT_SCHEMA,
  PUNK_AGENT_ACCOUNT_SETUP_SCHEMA,
} from "../broker/src/agent-account/punk-agent-account-setup.mjs";

const NOW = 1_800_000_000;
const ADDRESSES = Object.freeze({
  owner: "0x0000000000000000000000000000000000000001",
  account: "0x0000000000000000000000000000000000000002",
  registry: "0x0000000000000000000000000000000000000003",
  adapters: "0x0000000000000000000000000000000000000004",
  adapter: "0x0000000000000000000000000000000000000005",
  venue: "0x0000000000000000000000000000000000000006",
  session: "0x0000000000000000000000000000000000000007",
});

function input(accountCreated = false) {
  return {
    schema: PUNK_AGENT_ACCOUNT_SETUP_INPUT_SCHEMA,
    version: 1,
    chainId: 4663,
    checkedAt: new Date(NOW * 1_000).toISOString(),
    punk: {
      tokenId: "93",
      expectedOwner: ADDRESSES.owner,
      account: ADDRESSES.account,
      accountCreated,
    },
    infrastructure: {
      accountRegistry: ADDRESSES.registry,
      entryPoint: ENTRY_POINT_V08,
      adapterRegistry: ADDRESSES.adapters,
      adapter: ADDRESSES.adapter,
      venue: ADDRESSES.venue,
    },
    session: {
      sessionKey: ADDRESSES.session,
      adapterCodeHash: `0x${"ab".repeat(32)}`,
      targetCollection: "0x0000000000000000000000000000000000000000",
      validAfter: String(NOW),
      validUntil: String(NOW + (7 * 86_400)),
      maxMintsPerDay: "6",
      maxMintsTotal: "6",
      maxGasCostWei: "500000000000000",
      minimumNativeReserveWei: "100000000000000",
    },
  };
}

test("Punk Agent Account setup produces two owner approvals for a new Punk account", () => {
  const setup = buildPunkAgentAccountSessionSetup(input(), { nowSeconds: NOW });
  assert.equal(setup.schema, PUNK_AGENT_ACCOUNT_SETUP_SCHEMA);
  assert.equal(setup.setupTransactions.length, 2);
  assert.deepEqual(setup.setupTransactions.map(({ approval, purpose }) => ({ approval, purpose })), [
    { approval: 1, purpose: "ACTIVATE_PUNK_AGENT_ACCOUNT" },
    { approval: 2, purpose: "AUTHORIZE_MISSION_SESSION" },
  ]);
  assert.equal(setup.setupTransactions[0].from, ADDRESSES.owner);
  assert.equal(setup.setupTransactions[0].to, ADDRESSES.registry);
  assert.equal(setup.setupTransactions[1].to, ADDRESSES.account);
  assert.equal(setup.safety.maximumOwnerApprovals, 2);
  assert.equal(setup.safety.punkFundsEntryPointGas, true);
  assert.equal(setup.safety.walletPopupPerMintRequiredAfterSetup, false);
  assert.equal(setup.safety.paidMintsAllowed, false);
  assert.equal(setup.safety.submissionPerformed, false);
  assert.match(setup.artifactHash, /^0x[0-9a-f]{64}$/);
});

test("an activated account needs only the mission-session approval", () => {
  const setup = buildPunkAgentAccountSessionSetup(input(true), { nowSeconds: NOW });
  assert.equal(setup.setupTransactions.length, 1);
  assert.equal(setup.setupTransactions[0].approval, 2);
  assert.equal(setup.setupTransactions[0].purpose, "AUTHORIZE_MISSION_SESSION");
  assert.equal(setup.safety.ownerWalletTransactionsRequired, 1);
});

test("session transaction encodes every reviewed mission limit", () => {
  const setup = buildPunkAgentAccountSessionSetup(input(true), { nowSeconds: NOW });
  const decoded = decodeFunctionData({
    abi: [{
      type: "function", name: "configureAutonomousSession", stateMutability: "nonpayable",
      inputs: [{ name: "config", type: "tuple", components: [
        { name: "sessionKey", type: "address" },
        { name: "adapter", type: "address" },
        { name: "venue", type: "address" },
        { name: "adapterCodeHash", type: "bytes32" },
        { name: "targetCollection", type: "address" },
        { name: "validAfter", type: "uint48" },
        { name: "validUntil", type: "uint48" },
        { name: "maxMintsPerDay", type: "uint32" },
        { name: "maxMintsTotal", type: "uint32" },
        { name: "maxGasCostWei", type: "uint256" },
        { name: "minimumNativeReserveWei", type: "uint256" },
      ] }], outputs: [],
    }],
    data: setup.setupTransactions[0].data,
  });
  const [config] = decoded.args;
  assert.equal(config.sessionKey.toLowerCase(), ADDRESSES.session);
  assert.equal(config.adapter.toLowerCase(), ADDRESSES.adapter);
  assert.equal(config.venue.toLowerCase(), ADDRESSES.venue);
  assert.equal(config.maxMintsPerDay, 6);
  assert.equal(config.maxMintsTotal, 6);
  assert.equal(config.maxGasCostWei, 500000000000000n);
  assert.equal(config.minimumNativeReserveWei, 100000000000000n);
});

test("Punk Agent Account setup rejects unsafe session envelopes", () => {
  const paidGasDisabled = input();
  paidGasDisabled.session.maxGasCostWei = "0";
  assert.throws(
    () => buildPunkAgentAccountSessionSetup(paidGasDisabled, { nowSeconds: NOW }),
    { code: "INVALID_GAS_CAP" },
  );

  const excessive = input();
  excessive.session.maxMintsTotal = "101";
  assert.throws(
    () => buildPunkAgentAccountSessionSetup(excessive, { nowSeconds: NOW }),
    { code: "INVALID_CAP" },
  );

  const wrongEntryPoint = input();
  wrongEntryPoint.infrastructure.entryPoint = "0x0000000000000000000000000000000000000008";
  assert.throws(
    () => buildPunkAgentAccountSessionSetup(wrongEntryPoint, { nowSeconds: NOW }),
    { code: "WRONG_ENTRY_POINT" },
  );
});
