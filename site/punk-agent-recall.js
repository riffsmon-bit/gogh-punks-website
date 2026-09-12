// The caller supplies authenticated reads and the owner's wallet. A chat command
// requests revocation; only the wallet can authorize the on-chain transaction.
const REVOKE_SESSION = "0xc64b51e8";
const address = value => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
const same = (a, b) => address(a) && address(b) && a.toLowerCase() === b.toLowerCase();

export function createPunkRecall() {
  let busy = false;
  return {
    get busy() { return busy; },
    async run({ owner, tokenId, isCurrent, readStatus, request, provider, waitForReceipt,
      onWallet = () => {}, onSubmitted = () => {} }) {
      if (busy) return { status: "BUSY" };
      busy = true;
      let transactionHash = null;
      const assertCurrent = () => {
        if (!address(owner) || !/^(?:0|[1-9]\d{0,3})$/.test(tokenId) || !isCurrent()) {
          throw new Error("Punk, owner or network changed. Select the Punk again to recall it.");
        }
      };
      try {
        assertCurrent();
        const status = await readStatus();
        assertCurrent();
        if (status?.ok !== true || status.tokenId !== tokenId || !same(status.owner, owner)
          || status.readiness?.databaseReady !== true
          || typeof status.runtime?.accountCreated !== "boolean"
          || (status.runtime.accountCreated && typeof status.runtime.sessionActive !== "boolean")) {
          throw new Error("I couldn’t verify the live mission. Recall is not confirmed; check status and retry.");
        }
        const needsRevocation = status.runtime.sessionActive === true
          || ["ACTIVE", "PAUSED", "INACTIVE", "EXPIRED"].includes(status.mission?.status);
        if (!needsRevocation) {
          const paused = await request(`/api/v2/punks/${tokenId}/strategy`, { action: "pause" });
          assertCurrent();
          if (paused?.ok !== true || paused.strategy?.state !== "PAUSED") {
            throw new Error("Strategy pause was not confirmed.");
          }
          return { status: "PAUSED", tokenId, transactionHash: null };
        }
        const prepared = await request("/api/v2/agent-account/recall", { action: "prepare", owner, tokenId });
        assertCurrent();
        const transaction = prepared?.transaction;
        if (prepared?.ok !== true || prepared.tokenId !== tokenId
          || !same(transaction?.from, owner) || !same(transaction?.to, status.runtime.account)
          || transaction.value !== "0x0" || transaction.data?.toLowerCase() !== REVOKE_SESSION
          || (status.mission?.sessionId && prepared.sessionId !== status.mission.sessionId)) {
          throw new Error("The recall review does not match this Punk’s live mission.");
        }
        if (!provider?.request) throw new Error("Wallet provider unavailable.");
        const chainId = await provider.request({ method: "eth_chainId" });
        const accounts = await provider.request({ method: "eth_accounts" });
        assertCurrent();
        if (BigInt(chainId) !== 4663n || !same(accounts?.[0], owner)) {
          throw new Error("Connect the Punk owner on Robinhood Chain to recall this mission.");
        }
        onWallet();
        transactionHash = await provider.request({ method: "eth_sendTransaction", params: [{
          from: owner, to: transaction.to, value: "0x0", data: REVOKE_SESSION,
        }] });
        if (!/^0x[0-9a-f]{64}$/i.test(transactionHash)) throw new Error("The wallet did not return a valid recall transaction hash.");
        onSubmitted(transactionHash);
        await waitForReceipt(provider, transactionHash);
        assertCurrent();
        const confirmed = await request("/api/v2/agent-account/recall", {
          action: "confirm", owner, tokenId, transactionHash,
        });
        assertCurrent();
        if (confirmed?.ok !== true || confirmed.tokenId !== tokenId
          || confirmed.sessionId !== prepared.sessionId || confirmed.status !== "REVOKED"
          || confirmed.strategyPaused !== true
          || confirmed.transactionHash?.toLowerCase() !== transactionHash.toLowerCase()) {
          throw new Error("The recall receipt and mission state are not confirmed yet.");
        }
        return { status: "REVOKED", tokenId, transactionHash };
      } catch (error) {
        if (transactionHash && /^0x[0-9a-f]{64}$/i.test(transactionHash)) error.transactionHash = transactionHash;
        throw error;
      } finally { busy = false; }
    },
  };
}
