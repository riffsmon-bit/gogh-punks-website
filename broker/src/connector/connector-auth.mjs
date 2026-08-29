import { createHash, randomBytes, randomUUID } from "node:crypto";
import { snapshotDenseArray, snapshotExactRecord } from "../control-center/strict-record.mjs";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TOKEN_ID = /^(?:0|[1-9][0-9]{0,3})$/;
const SCOPES = new Set(["punk:read", "agent:read", "agent:scout", "mint:inspect",
  "mint:directed", "agent:pause"]);

export class ConnectorAuthError extends Error {
  constructor(code, message) { super(message); this.name = "ConnectorAuthError"; this.code = code; }
}

function fail(code, message) { throw new ConnectorAuthError(code, message); }
function address(value) {
  if (typeof value !== "string" || !ADDRESS.test(value)) fail("INVALID_WALLET", "wallet is invalid");
  return value.toLowerCase();
}
function tokenIds(value) {
  let entries;
  try { entries = snapshotDenseArray(value, "allowed Punk IDs"); }
  catch { fail("INVALID_PUNKS", "allowed Punk IDs are invalid"); }
  if (entries.length < 1 || entries.length > 100 || entries.some((entry) =>
    typeof entry !== "string" || !TOKEN_ID.test(entry)) || new Set(entries).size !== entries.length) {
    fail("INVALID_PUNKS", "allowed Punk IDs are invalid");
  }
  return Object.freeze([...entries]);
}
function scopes(value) {
  let entries;
  try { entries = snapshotDenseArray(value, "connector scopes"); }
  catch { fail("INVALID_SCOPES", "connector scopes are invalid"); }
  if (entries.length < 1 || entries.length > SCOPES.size || entries.some((entry) => !SCOPES.has(entry))
    || new Set(entries).size !== entries.length) fail("INVALID_SCOPES", "connector scopes are invalid");
  return Object.freeze([...entries].sort());
}
function digest(value) { return createHash("sha256").update(value).digest("hex"); }

export class InMemoryConnectorAuth {
  #challenges = new Map();
  #sessions = new Map();
  #clock;
  #verifySignature;
  #readOwner;

  constructor({ clock = () => Date.now(), verifySignature, readOwner } = {}) {
    if (typeof clock !== "function" || typeof verifySignature !== "function"
      || typeof readOwner !== "function") throw new TypeError("connector auth dependencies are invalid");
    this.#clock = clock;
    this.#verifySignature = verifySignature;
    this.#readOwner = readOwner;
  }

  createChallenge(raw) {
    let input;
    try { input = snapshotExactRecord(raw, ["wallet", "punkIds", "scopes"], "challenge request"); }
    catch { fail("INVALID_REQUEST", "challenge request is invalid"); }
    const wallet = address(input.wallet);
    const punkIds = tokenIds(input.punkIds);
    const selectedScopes = scopes(input.scopes);
    const challengeId = randomUUID();
    const issuedAt = new Date(this.#clock());
    const expiresAt = new Date(issuedAt.getTime() + 10 * 60_000);
    const nonce = randomBytes(16).toString("hex");
    const message = ["Gogh Punks Agent Connector", "", "Authorize bounded connector commands.",
      "This is not a transaction, approval, or permission to spend from your main wallet.", "",
      `Wallet: ${wallet}`, "Chain ID: 4663", "Collection: 0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6",
      `Punks: ${punkIds.join(",")}`, `Scopes: ${selectedScopes.join(",")}`,
      `Nonce: ${nonce}`, `Issued At: ${issuedAt.toISOString()}`,
      `Expiration Time: ${expiresAt.toISOString()}`].join("\n");
    this.#challenges.set(challengeId, { wallet, punkIds, scopes: selectedScopes,
      message, expiresAt: expiresAt.getTime(), used: false });
    return Object.freeze({ challengeId, message, expiresAt: expiresAt.toISOString() });
  }

  async complete(raw) {
    let input;
    try { input = snapshotExactRecord(raw, ["challengeId", "wallet", "signature"], "session request"); }
    catch { fail("INVALID_REQUEST", "session request is invalid"); }
    const wallet = address(input.wallet);
    if (typeof input.challengeId !== "string" || typeof input.signature !== "string"
      || !/^0x[0-9a-fA-F]{2,9998}$/.test(input.signature)) fail("INVALID_SIGNATURE", "signature is invalid");
    const challenge = this.#challenges.get(input.challengeId);
    if (!challenge || challenge.used || challenge.wallet !== wallet || challenge.expiresAt <= this.#clock()) {
      fail("CHALLENGE_EXPIRED", "connector authorization request expired");
    }
    const valid = await this.#verifySignature({ wallet, message: challenge.message,
      signature: input.signature });
    if (valid !== true) fail("INVALID_SIGNATURE", "signature does not match the wallet");
    for (const punkId of challenge.punkIds) {
      if (address(await this.#readOwner(punkId)) !== wallet) {
        fail("OWNERSHIP_CHANGED", `Wallet no longer controls Punk #${punkId}`);
      }
    }
    challenge.used = true;
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = digest(rawToken);
    const expiresAt = this.#clock() + 60 * 60_000;
    this.#sessions.set(tokenHash, Object.freeze({ wallet, punkIds: challenge.punkIds,
      scopes: challenge.scopes, expiresAt }));
    return Object.freeze({ accessToken: rawToken, tokenType: "Bearer",
      expiresAt: new Date(expiresAt).toISOString(), wallet, punkIds: challenge.punkIds,
      scopes: challenge.scopes });
  }

  require(rawToken, requiredScope, punkId = null) {
    if (typeof rawToken !== "string" || rawToken.length < 32 || rawToken.length > 128) {
      fail("UNAUTHORIZED", "connector session is missing or invalid");
    }
    const session = this.#sessions.get(digest(rawToken));
    if (!session || session.expiresAt <= this.#clock()) fail("SESSION_EXPIRED", "connector session expired");
    if (!SCOPES.has(requiredScope) || !session.scopes.includes(requiredScope)) {
      fail("SCOPE_REQUIRED", `connector scope ${requiredScope} is required`);
    }
    if (punkId !== null && !session.punkIds.includes(String(punkId))) {
      fail("PUNK_NOT_AUTHORIZED", "this connector session cannot control that Punk");
    }
    return session;
  }
}

export { SCOPES as CONNECTOR_SCOPES };
