import { InMemoryConnectorAuth } from "../../broker/src/connector/connector-auth.mjs";
import { GoghConnector } from "../../broker/src/connector/gogh-connector.mjs";
import { InMemoryConnectorStore } from "../../broker/src/connector/connector-store.mjs";
import { localPunkAccount } from "./v2-local-simulation.mjs";

const OWNER = "0x0000000000000000000000000000000000000001";
const DEMO_SIGNATURE = `0x${"11".repeat(65)}`;

export function createLocalConnector(simulation, { clock = () => Date.now() } = {}) {
  const store = new InMemoryConnectorStore({ clock });
  const auth = new InMemoryConnectorAuth({ clock,
    verifySignature: async () => true,
    readOwner: async () => OWNER });
  const dependencies = {
    listPunks: async () => [Object.freeze({ tokenId: "93", name: "Gogh Punk #93",
      image: "/assets/punks/93.png", punkWallet: localPunkAccount("93"), agentStatus: "active" })],
    requireCurrentOwner: async (tokenId, wallet) => {
      if (wallet !== OWNER || !/^(?:0|[1-9][0-9]{0,3})$/.test(tokenId)) {
        const error = new Error("Control of this Punk has changed.");
        error.code = "OWNERSHIP_CHANGED";
        throw error;
      }
      return true;
    },
    getPunkStatus: async (tokenId) => {
      const session = simulation.session(tokenId);
      return { tokenId, owner: session.owner, punkWallet: session.account,
        policy: session.policy, nativeBalanceWei: "41200000000000000", nftCount: 3,
        mintsUsedToday: 0, spendUsedTodayWei: "0", lastScan: null, lastSuccessfulMint: null };
    },
    getPunkWallet: async (tokenId) => ({ tokenId, punkWallet: localPunkAccount(tokenId) }),
    getPunkPortfolio: async (tokenId) => ({ tokenId, punkWallet: localPunkAccount(tokenId),
      nftCount: 3, tokenCount: 0, nfts: [] }),
    getAgentStatus: async (tokenId) => ({ tokenId, state: "IDLE",
      activity: simulation.activity(tokenId).activity }),
    sendScout: async (tokenId) => {
      const result = simulation.scout({ tokenId });
      return { status: "queued", jobId: `local_scout_${tokenId}_${clock()}`,
        workerResult: result.status };
    },
    inspectMint: async (tokenId, url) => {
      const prepared = await simulation.resolve({ tokenId, url, recipient: localPunkAccount(tokenId) });
      return { supported: true, tokenId, collection: prepared.review.collectionName,
        recipient: prepared.review.candidate.recipient, priceWei: prepared.review.candidate.priceWei,
        currency: "ETH", stage: prepared.review.saleStage, eligible: true,
        paidMint: prepared.review.candidate.priceWei !== "0", reviewId: prepared.reviewId };
    },
    prepareMint: async (tokenId, url) => {
      const prepared = await simulation.resolve({ tokenId, url, recipient: localPunkAccount(tokenId) });
      return { reviewId: prepared.reviewId, collection: prepared.review.collectionName,
        mintPriceWei: prepared.review.candidate.priceWei,
        estimatedGasWei: prepared.estimatedGasWei,
        maximumExpectedSpendWei: (BigInt(prepared.review.candidate.priceWei)
          + BigInt(prepared.estimatedGasWei)).toString(), dailyBudgetRemainingWei: "25000000000000000",
        simulation: "ready" };
    },
    executeMint: async (intent) => simulation.simulate({ tokenId: intent.tokenId,
      reviewId: intent.prepared.reviewId }),
    pauseAgent: async (tokenId) => ({ tokenId, state: "PAUSED", localOnly: true }),
    resumeAgent: async (tokenId) => ({ tokenId, state: "IDLE", localOnly: true }),
  };
  const connector = new GoghConnector({ auth, store, dependencies, clock, executionMode: "simulate" });
  return Object.freeze({ connector, auth, store,
    async authorize({ punkIds = ["93"], scopes = ["punk:read", "agent:read", "agent:scout",
      "mint:inspect", "mint:directed", "agent:pause"] } = {}) {
      const challenge = auth.createChallenge({ wallet: OWNER, punkIds, scopes });
      return auth.complete({ challengeId: challenge.challengeId, wallet: OWNER,
        signature: DEMO_SIGNATURE });
    } });
}
