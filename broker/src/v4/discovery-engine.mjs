import { normalizeV2Opportunity } from "./opportunity.mjs";

export class SharedV2DiscoveryEngine {
  #opportunities = new Map();
  #analyses = new Map();
  #sources = new Map();

  ingest(raw, { sourceKind, sourceIdentity, now = new Date() }) {
    if (typeof sourceKind !== "string" || !/^[A-Z0-9_]{2,48}$/.test(sourceKind)
      || typeof sourceIdentity !== "string" || !sourceIdentity || sourceIdentity.length > 512) {
      throw new TypeError("opportunity source is invalid");
    }
    const opportunity = normalizeV2Opportunity(raw, now);
    const existing = this.#opportunities.get(opportunity.dedupeKey);
    this.#opportunities.set(opportunity.dedupeKey, existing
      ? Object.freeze({ ...opportunity, opportunityId: existing.opportunityId,
        createdAt: existing.createdAt }) : opportunity);
    const sources = this.#sources.get(opportunity.dedupeKey) ?? new Map();
    sources.set(`${sourceKind}:${sourceIdentity}`, Object.freeze({ sourceKind, sourceIdentity,
      discoveredAt: new Date(now).toISOString() }));
    this.#sources.set(opportunity.dedupeKey, sources);
    return Object.freeze({ opportunity: this.#opportunities.get(opportunity.dedupeKey),
      sourceCount: sources.size, deduplicated: Boolean(existing) });
  }

  async analyzeOnce(dedupeKey, inputHash, analyze) {
    if (!/^[0-9a-f]{64}$/.test(dedupeKey) || !/^[0-9a-f]{64}$/.test(inputHash)
      || typeof analyze !== "function") throw new TypeError("analysis request is invalid");
    const key = `${dedupeKey}:${inputHash}`;
    if (this.#analyses.has(key)) {
      return Object.freeze({ cacheHit: true, analysis: await this.#analyses.get(key) });
    }
    const pending = Promise.resolve().then(analyze);
    this.#analyses.set(key, pending);
    try {
      const analysis = await pending;
      if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
        throw new TypeError("analysis result is invalid");
      }
      const frozen = Object.freeze({ ...analysis });
      this.#analyses.set(key, frozen);
      return Object.freeze({ cacheHit: false, analysis: frozen });
    } catch (error) {
      this.#analyses.delete(key);
      throw error;
    }
  }

  get(dedupeKey) { return this.#opportunities.get(dedupeKey) ?? null; }
  sources(dedupeKey) { return Object.freeze([...(this.#sources.get(dedupeKey)?.values() ?? [])]); }
}
