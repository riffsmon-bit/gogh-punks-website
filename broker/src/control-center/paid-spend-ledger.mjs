import { canonicalUint } from "./paid-mint-policy.mjs";
import { snapshotExactRecord } from "./strict-record.mjs";

function canonicalJobId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9:_-]{8,160}$/.test(value)) {
    throw new TypeError("job ID is invalid");
  }
  return value;
}

function canonicalDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new TypeError("UTC day is invalid");
  }
  return value;
}

function canonicalPunk(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,3})$/.test(value)) {
    throw new TypeError("Punk token ID is invalid");
  }
  return value;
}

export class InMemoryPaidSpendLedger {
  #rows = new Map();
  #jobs = new Map();
  #tail = Promise.resolve();

  async #locked(operation) {
    const prior = this.#tail;
    let release;
    this.#tail = new Promise((resolve) => { release = resolve; });
    await prior;
    try { return operation(); } finally { release(); }
  }

  async reserve(input) {
    const { jobId, punkTokenId, utcDay, priceWei, dailyLimitWei, dailyMintLimit }
      = snapshotExactRecord(input, ["jobId", "punkTokenId", "utcDay", "priceWei",
        "dailyLimitWei", "dailyMintLimit"], "reservation");
    const id = canonicalJobId(jobId);
    const punk = canonicalPunk(punkTokenId);
    const day = canonicalDay(utcDay);
    const price = canonicalUint(priceWei, "price");
    const limit = canonicalUint(dailyLimitWei, "daily limit");
    if (price === 0n || !Number.isSafeInteger(dailyMintLimit)
      || dailyMintLimit < 1 || dailyMintLimit > 100) throw new TypeError("reservation is invalid");
    return this.#locked(() => {
      const existing = this.#jobs.get(id);
      if (existing) {
        if (existing.punkTokenId !== punk || existing.utcDay !== day
          || existing.priceWei !== price.toString()) throw new Error("JOB_ID_CONFLICT");
        return existing;
      }
      const key = `${punk}:${day}`;
      const row = this.#rows.get(key) ?? { reservedWei: 0n, confirmedWei: 0n,
        reservedMints: 0, confirmedMints: 0 };
      const committed = row.reservedWei + row.confirmedWei;
      const count = row.reservedMints + row.confirmedMints;
      if (committed > limit || price > limit - committed) throw new Error("DAILY_SPEND_LIMIT");
      if (count >= dailyMintLimit) throw new Error("DAILY_MINT_LIMIT");
      row.reservedWei += price;
      row.reservedMints += 1;
      this.#rows.set(key, row);
      const reservation = Object.freeze({ jobId: id, punkTokenId: punk, utcDay: day,
        priceWei: price.toString(), status: "RESERVED", transactionHash: null });
      this.#jobs.set(id, reservation);
      return reservation;
    });
  }

  async confirm(jobId, transactionHash) {
    const id = canonicalJobId(jobId);
    if (typeof transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
      throw new TypeError("transaction hash is invalid");
    }
    return this.#locked(() => {
      const job = this.#jobs.get(id);
      if (!job) throw new Error("UNKNOWN_JOB");
      if (job.status === "CONFIRMED") return job;
      if (job.status !== "RESERVED") throw new Error("JOB_NOT_RESERVED");
      const row = this.#rows.get(`${job.punkTokenId}:${job.utcDay}`);
      const price = BigInt(job.priceWei);
      row.reservedWei -= price;
      row.reservedMints -= 1;
      row.confirmedWei += price;
      row.confirmedMints += 1;
      const confirmed = Object.freeze({ ...job, status: "CONFIRMED",
        transactionHash: transactionHash.toLowerCase() });
      this.#jobs.set(id, confirmed);
      return confirmed;
    });
  }

  async release(jobId) {
    const id = canonicalJobId(jobId);
    return this.#locked(() => {
      const job = this.#jobs.get(id);
      if (!job || job.status === "RELEASED") return job ?? null;
      if (job.status === "CONFIRMED") throw new Error("CONFIRMED_JOB_IMMUTABLE");
      const row = this.#rows.get(`${job.punkTokenId}:${job.utcDay}`);
      row.reservedWei -= BigInt(job.priceWei);
      row.reservedMints -= 1;
      const released = Object.freeze({ ...job, status: "RELEASED" });
      this.#jobs.set(id, released);
      return released;
    });
  }

  async usage(punkTokenId, utcDay) {
    const punk = canonicalPunk(punkTokenId);
    const day = canonicalDay(utcDay);
    return this.#locked(() => {
      const row = this.#rows.get(`${punk}:${day}`) ?? { reservedWei: 0n, confirmedWei: 0n,
        reservedMints: 0, confirmedMints: 0 };
      return Object.freeze({ punkTokenId: punk, utcDay: day,
        reservedWei: row.reservedWei.toString(), confirmedWei: row.confirmedWei.toString(),
        reservedMints: row.reservedMints, confirmedMints: row.confirmedMints });
    });
  }
}
