import { normalizeOpportunity } from "../opportunity.mjs";

export class DiscoveryEngine {
  constructor({ sources, clock = () => new Date() }) {
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new TypeError("at least one discovery source is required");
    }
    this.sources = sources;
    this.clock = clock;
  }

  async scout(context = {}) {
    const discovered = [];
    const failures = [];
    for (const source of this.sources) {
      try {
        const candidates = await source.discover({ ...context, now: this.clock() });
        if (!Array.isArray(candidates)) throw new TypeError("source result must be an array");
        for (const candidate of candidates) {
          const normalized = normalizeOpportunity(
            { ...candidate, source: candidate.source ?? source.name },
            this.clock(),
          );
          discovered.push({
            ...normalized,
            scoutable: true,
            autonomousExecutionEligible: false,
          });
        }
      } catch (error) {
        failures.push({ source: source.name ?? "UNNAMED", error: error?.name ?? "Error" });
      }
    }
    const unique = new Map();
    for (const opportunity of discovered) {
      const previous = unique.get(opportunity.id);
      if (!previous || opportunity.discoveredAt < previous.discoveredAt) {
        unique.set(opportunity.id, opportunity);
      }
    }
    return Object.freeze({
      opportunities: Object.freeze([...unique.values()]),
      failures: Object.freeze(failures),
      scannedSources: this.sources.length,
    });
  }
}

export class AllowlistedFeedSource {
  constructor({ name = "ALLOWLISTED_FEED", load }) {
    if (typeof load !== "function") throw new TypeError("load must be a function");
    this.name = name;
    this.load = load;
  }

  async discover(context) {
    return this.load(context);
  }
}
