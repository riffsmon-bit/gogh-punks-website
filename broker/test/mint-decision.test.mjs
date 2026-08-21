import assert from "node:assert/strict";
import test from "node:test";
import { buildPerPunkMintDecisions } from "../src/scout/mint-decision.mjs";

const COLLECTION = "0x1111111111111111111111111111111111111111";
const MINT = "0x2222222222222222222222222222222222222222";
const OWNER = "0x4444444444444444444444444444444444444444";

function accountFor(tokenId) {
  return `0x${BigInt(tokenId + 1).toString(16).padStart(40, "0")}`;
}

function opportunity(overrides = {}) {
  return {
    id: "controlled-free-mint-42",
    chainId: 4663,
    opportunityType: "FREE_MINT",
    collection: COLLECTION,
    tokenId: "42",
    expectedPrice: "0",
    maxPrice: "0",
    riskLabel: "LOWER_RISK",
    scores: {
      artScore: 90,
      artConfidence: 90,
      contractRiskScore: 10,
      contractRiskConfidence: 90,
      marketConfidence: 50,
    },
    metadata: {
      actionableMint: true,
      mintPriceStatus: "KNOWN",
      mintContract: MINT,
      assetStandard: "ERC721",
      collectionSignals: { art: { dimensions: { pixelArt: 95, photography: 5 } } },
    },
    ...overrides,
  };
}

function punk(tokenId, mode, overrides = {}) {
  return {
    tokenId: String(tokenId),
    account: accountFor(tokenId),
    expectedOwner: OWNER,
    personaKey: "PIXEL_MAXI",
    mandate: {
      tokenId: String(tokenId),
      configuredBy: OWNER,
      version: 3,
      mode,
      economicSettings: { allowFreeMints: true, maxMintsPerDay: 1 },
      riskSettings: { unknownMintMode: "SCOUT_ONLY", maxContractRiskScore: 30 },
      artisticPreferences: { minimumTasteMatch: 80, dimensions: { pixelArt: 100 } },
      mintPermissions: {
        approvedMintContracts: [MINT],
        approvedCollections: [COLLECTION],
      },
      ...overrides.mandate,
    },
    controls: { acquisitionsToday: 0, ...overrides.controls },
  };
}

test("one opportunity produces independent deterministic IGNORE/WATCH/RECOMMEND/PROPOSE states", () => {
  const input = {
    opportunity: opportunity(),
    punks: [
      punk(4, "APPROVAL_REQUIRED", {
        controls: {
          proposalSupported: true,
          targetInspectionValidated: true,
          ownerMandateCurrent: true,
          policySnapshotValidated: true,
        },
      }),
      punk(1, "DISABLED"),
      punk(3, "SCOUT"),
      punk(2, "SCOUT", { controls: { acquisitionsToday: 1 } }),
    ],
  };
  const first = buildPerPunkMintDecisions(input);
  const second = buildPerPunkMintDecisions(input);
  assert.deepEqual(first, second);
  assert.deepEqual(first.artifact.decisions.map(({ punkTokenId, decision }) => [punkTokenId, decision]), [
    ["1", "IGNORE"],
    ["2", "WATCH"],
    ["3", "RECOMMEND"],
    ["4", "PROPOSE"],
  ]);
  assert.equal(first.artifact.decisions[0].punk.account, accountFor(1));
  assert.equal(first.artifact.decisions[0].punk.expectedOwner, OWNER);
  assert.match(first.artifact.opportunityHash, /^0x[0-9a-f]{64}$/);
  assert.match(first.artifact.decisions[0].controlsHash, /^0x[0-9a-f]{64}$/);
  assert.match(first.decisionHash, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(first.artifact.security, {
    executionEnabled: false,
    autonomyEnabled: false,
    signingPerformed: false,
    submissionPerformed: false,
    chainWritePerformed: false,
    rpcPerformed: false,
    persistencePerformed: false,
    identityEvidence: "SUPPLIED_UNVERIFIED_LOCAL",
  });
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.artifact.decisions));
});

test("different mandate dimensions independently change the Punk decision", () => {
  const result = buildPerPunkMintDecisions({
    opportunity: opportunity(),
    punks: [
      punk(1, "SCOUT"),
      punk(2, "SCOUT", {
        mandate: {
          artisticPreferences: { minimumTasteMatch: 80, dimensions: { photography: 100 } },
        },
      }),
    ],
  });
  assert.equal(result.artifact.decisions[0].mandateTasteMatch, 95);
  assert.equal(result.artifact.decisions[0].decision, "RECOMMEND");
  assert.equal(result.artifact.decisions[1].mandateTasteMatch, 5);
  assert.equal(result.artifact.decisions[1].decision, "WATCH");
});

test("multi-Punk proof rejects ambiguity, non-mints, unknown fields, and bounds", () => {
  assert.throws(
    () => buildPerPunkMintDecisions({ opportunity: opportunity(), punks: [punk(1, "SCOUT"), punk(1, "SCOUT")] }),
    /Duplicate Punk/,
  );
  assert.throws(
    () => buildPerPunkMintDecisions({ opportunity: opportunity({ opportunityType: "SECONDARY_BUY" }), punks: [punk(1, "SCOUT")] }),
    /mint type/,
  );
  assert.throws(
    () => buildPerPunkMintDecisions({ opportunity: opportunity(), punks: [{ ...punk(1, "SCOUT"), execute: true }] }),
    /Unsupported/,
  );
  assert.throws(
    () => buildPerPunkMintDecisions({
      opportunity: opportunity(),
      punks: [punk(1, "SCOUT"), { ...punk(2, "SCOUT"), account: accountFor(1) }],
    }),
    /Duplicate supplied Punk Account/,
  );
  assert.throws(
    () => buildPerPunkMintDecisions({ opportunity: opportunity(), punks: [] }),
    /between 1 and 100/,
  );
  assert.throws(
    () => buildPerPunkMintDecisions({ opportunity: opportunity(), punks: Array.from({ length: 101 }, (_, index) => punk(index, "SCOUT")) }),
    /between 1 and 100/,
  );
});

test("decision proof rejects coercible token IDs and non-canonical nested JSON", () => {
  for (const value of [
    true,
    [],
    "",
    "0x1",
    "01",
    "+1",
    "1e2",
    1.5,
    (1n << 256n).toString(),
  ]) {
    assert.throws(
      () => buildPerPunkMintDecisions({
        opportunity: opportunity(),
        punks: [{ ...punk(1, "SCOUT"), tokenId: value }],
      }),
      /tokenId must be a non-negative integer/,
      String(value),
    );
  }

  let getterCalled = false;
  const hostileArray = [];
  hostileArray.length = 1;
  Object.defineProperty(hostileArray, "0", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "hidden";
    },
  });
  assert.throws(
    () => buildPerPunkMintDecisions({
      opportunity: { ...opportunity(), hostileArray },
      punks: [punk(1, "SCOUT")],
    }),
    /cannot contain accessors/,
  );
  assert.equal(getterCalled, false);

  class HostileArray extends Array {}
  for (const hostile of [new HostileArray("hidden"), Object.setPrototypeOf(["hidden"], null)]) {
    assert.throws(
      () => buildPerPunkMintDecisions({
        opportunity: { ...opportunity(), hostile },
        punks: [punk(1, "SCOUT")],
      }),
      /ordinary arrays/,
    );
  }

  const symbolOpportunity = opportunity();
  symbolOpportunity[Symbol("hidden")] = true;
  assert.throws(
    () => buildPerPunkMintDecisions({ opportunity: symbolOpportunity, punks: [punk(1, "SCOUT")] }),
    /symbol keys/,
  );
});

test("decision proof requires the exact Robinhood chain and canonical-only aliases", () => {
  const missingChain = opportunity();
  delete missingChain.chainId;
  for (const candidate of [
    missingChain,
    opportunity({ chainId: 1 }),
    opportunity({ chain_id: 1 }),
  ]) {
    assert.throws(
      () => buildPerPunkMintDecisions({ opportunity: candidate, punks: [punk(1, "SCOUT")] }),
      /chainId|canonical field names/,
    );
  }

  const contradictoryOpportunities = [
    opportunity({ token_id: "999" }),
    opportunity({ risk_label: "UNKNOWN" }),
    opportunity({ collection_address: "0x9999999999999999999999999999999999999999" }),
    opportunity({ metadata: { ...opportunity().metadata, asset_standard: "ERC1155" } }),
  ];
  for (const candidate of contradictoryOpportunities) {
    assert.throws(
      () => buildPerPunkMintDecisions({ opportunity: candidate, punks: [punk(1, "APPROVAL_REQUIRED")] }),
      /canonical|unsupported/,
    );
  }

  const contradictoryMandates = [
    { chain_id: 1 },
    { collection_address: "0x9999999999999999999999999999999999999999" },
    { token_id: "999" },
    { economic_settings: { allowFreeMints: false } },
    { risk_settings: { maxContractRiskScore: 100 } },
    { artistic_preferences: { minimumTasteMatch: 0 } },
  ];
  for (const extra of contradictoryMandates) {
    const configured = punk(1, "APPROVAL_REQUIRED");
    configured.mandate = { ...configured.mandate, ...extra };
    assert.throws(
      () => buildPerPunkMintDecisions({ opportunity: opportunity(), punks: [configured] }),
      /unsupported field/,
    );
  }
});

test("inherited mandate, setting, and control properties cannot manufacture PROPOSE", () => {
  const pollutedKeys = {
    configuredBy: OWNER,
    mode: "APPROVAL_REQUIRED",
    allowFreeMints: true,
    proposalSupported: true,
    targetInspectionValidated: true,
    ownerMandateCurrent: true,
    policySnapshotValidated: true,
    expectedOwner: OWNER,
  };
  const prior = new Map(
    Object.keys(pollutedKeys).map((key) => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]),
  );
  try {
    for (const [key, value] of Object.entries(pollutedKeys)) {
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        enumerable: false,
        writable: true,
        value,
      });
    }
    const configured = punk(1, "SCOUT");
    delete configured.mandate.configuredBy;
    delete configured.mandate.mode;
    delete configured.mandate.economicSettings.allowFreeMints;
    configured.controls = { acquisitionsToday: 0 };
    const result = buildPerPunkMintDecisions({ opportunity: opportunity(), punks: [configured] });
    assert.equal(result.artifact.decisions[0].decision, "WATCH");
    assert.equal(result.artifact.decisions[0].mintInterest.wantsToJoin, false);
  } finally {
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
      else delete Object.prototype[key];
    }
  }
});

test("inherited mint metadata, risk score, and Taste evidence cannot manufacture PROPOSE", () => {
  const keys = [
    "actionableMint",
    "mintPriceStatus",
    "collectionSignals",
    "analysisStatus",
    "contractRiskScore",
  ];
  const prior = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]));
  let getterCalls = 0;
  try {
    const inherited = {
      actionableMint: true,
      mintPriceStatus: "KNOWN",
      collectionSignals: { art: { dimensions: { pixelArt: 100 } }, analyzerVersion: "polluted" },
      analysisStatus: { contract: "VERIFIED" },
      contractRiskScore: 10,
    };
    for (const key of keys) {
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        enumerable: false,
        get() {
          getterCalls += 1;
          return inherited[key];
        },
      });
    }
    const candidate = opportunity();
    candidate.metadata = {
      mintContract: MINT,
      assetStandard: "ERC721",
    };
    delete candidate.scores.contractRiskScore;
    const configured = punk(1, "APPROVAL_REQUIRED", {
      controls: {
        proposalSupported: true,
        targetInspectionValidated: true,
        ownerMandateCurrent: true,
        policySnapshotValidated: true,
      },
    });
    const result = buildPerPunkMintDecisions({ opportunity: candidate, punks: [configured] });
    assert.equal(result.artifact.decisions[0].decision, "WATCH");
    assert.equal(result.artifact.decisions[0].mintInterest.actionable, false);
    assert.equal(getterCalls, 0);
  } finally {
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
      else delete Object.prototype[key];
    }
  }
});

test("inherited Taste dimensions and persona keys cannot change a Punk decision", () => {
  const priorPixelArt = Object.getOwnPropertyDescriptor(Object.prototype, "pixelArt");
  const priorPersona = Object.getOwnPropertyDescriptor(Object.prototype, "POLLUTED_PERSONA");
  try {
    Object.defineProperty(Object.prototype, "pixelArt", {
      configurable: true,
      enumerable: false,
      value: 100,
    });
    Object.defineProperty(Object.prototype, "POLLUTED_PERSONA", {
      configurable: true,
      enumerable: false,
      value: { name: "Polluted", weights: { photography: 100 } },
    });

    const candidate = opportunity();
    candidate.metadata.collectionSignals.art.dimensions = { photography: 0 };
    const configured = punk(1, "APPROVAL_REQUIRED", {
      mandate: {
        artisticPreferences: { minimumTasteMatch: 80, dimensions: { photography: 1 } },
      },
      controls: {
        proposalSupported: true,
        targetInspectionValidated: true,
        ownerMandateCurrent: true,
        policySnapshotValidated: true,
      },
    });
    const result = buildPerPunkMintDecisions({ opportunity: candidate, punks: [configured] });
    assert.equal(result.artifact.decisions[0].mandateTasteMatch, 0);
    assert.equal(result.artifact.decisions[0].decision, "WATCH");

    const pollutedPersonaPunk = punk(2, "SCOUT");
    pollutedPersonaPunk.personaKey = "POLLUTED_PERSONA";
    assert.throws(
      () => buildPerPunkMintDecisions({ opportunity: candidate, punks: [pollutedPersonaPunk] }),
      /Unknown Scout persona/,
    );
  } finally {
    if (priorPixelArt) Object.defineProperty(Object.prototype, "pixelArt", priorPixelArt);
    else delete Object.prototype.pixelArt;
    if (priorPersona) Object.defineProperty(Object.prototype, "POLLUTED_PERSONA", priorPersona);
    else delete Object.prototype.POLLUTED_PERSONA;
  }
});

test("inherited toJSON cannot alter mandate or reasoning hashes", () => {
  const baseline = buildPerPunkMintDecisions({ opportunity: opportunity(), punks: [punk(1, "SCOUT")] });
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  let getterCalls = 0;
  try {
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      enumerable: false,
      get() {
        getterCalls += 1;
        return () => "polluted";
      },
    });
    const hardened = buildPerPunkMintDecisions({ opportunity: opportunity(), punks: [punk(1, "SCOUT")] });
    assert.equal(hardened.artifact.decisions[0].mandateHash, baseline.artifact.decisions[0].mandateHash);
    assert.equal(hardened.artifact.decisions[0].reasoningHash, baseline.artifact.decisions[0].reasoningHash);
    assert.equal(getterCalls, 0);
  } finally {
    if (prior) Object.defineProperty(Object.prototype, "toJSON", prior);
    else delete Object.prototype.toJSON;
  }
});
