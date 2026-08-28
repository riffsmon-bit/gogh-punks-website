import { randomUUID } from "node:crypto";

export class ConnectorStoreError extends Error {
  constructor(code, message) { super(message); this.name = "ConnectorStoreError"; this.code = code; }
}
export class InMemoryConnectorStore {
  #clock;
  #intents = new Map();
  #idempotency = new Map();
  #audit = [];
  #requests = new Map();
  #schedules = new Map();

  constructor({ clock = () => Date.now() } = {}) {
    if (typeof clock !== "function") throw new TypeError("store clock is invalid");
    this.#clock = clock;
  }

  rateLimit(key, maximum = 20, windowMs = 60_000) {
    const now = this.#clock();
    const previous = (this.#requests.get(key) ?? []).filter((at) => at > now - windowMs);
    if (previous.length >= maximum) {
      throw new ConnectorStoreError("RATE_LIMITED", "Too many connector commands. Try again shortly.");
    }
    previous.push(now);
    this.#requests.set(key, previous);
  }

  idempotent(key, operation) {
    if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
      throw new ConnectorStoreError("IDEMPOTENCY_REQUIRED", "A valid idempotency key is required.");
    }
    const existing = this.#idempotency.get(key);
    if (existing) return existing;
    const pending = Promise.resolve().then(operation);
    this.#idempotency.set(key, pending);
    pending.catch(() => this.#idempotency.delete(key));
    return pending;
  }

  createIntent(value, ttlMs = 5 * 60_000) {
    const intentId = `mint_${randomUUID()}`;
    const record = Object.freeze({ ...value, intentId,
      expiresAt: new Date(this.#clock() + ttlMs).toISOString(), consumedAt: null });
    this.#intents.set(intentId, record);
    return record;
  }

  consumeIntent(intentId) {
    const record = this.#intents.get(intentId);
    if (!record || Date.parse(record.expiresAt) <= this.#clock()) {
      throw new ConnectorStoreError("INTENT_EXPIRED", "Mint intent expired. Prepare it again.");
    }
    if (record.consumedAt) throw new ConnectorStoreError("INTENT_CONSUMED", "Mint intent was already used.");
    const consumed = Object.freeze({ ...record, consumedAt: new Date(this.#clock()).toISOString() });
    this.#intents.set(intentId, consumed);
    return consumed;
  }

  setSchedule(tokenId, schedule) { this.#schedules.set(String(tokenId), schedule); return schedule; }
  getSchedule(tokenId) { return this.#schedules.get(String(tokenId)) ?? null; }

  recordAudit(entry) {
    const record = Object.freeze({ id: randomUUID(), timestamp: new Date(this.#clock()).toISOString(),
      ...entry });
    this.#audit.unshift(record);
    this.#audit = this.#audit.slice(0, 1_000);
    return record;
  }

  auditFor(tokenId) {
    return Object.freeze(this.#audit.filter((entry) => entry.tokenId === String(tokenId)));
  }
}
