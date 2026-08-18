import { assetKey, normalizeAddress } from "../config.mjs";

const NOTIFICATION_TYPES = new Set([
  "NEW_RECOMMENDATION",
  "HIGH_CONFIDENCE_RECOMMENDATION",
  "APPROVAL_REQUEST",
  "PURCHASE_SUCCEEDED",
  "PURCHASE_FAILED",
  "BUDGET_THRESHOLD",
  "AGENT_PAUSED",
  "SUSPICIOUS_ACTIVITY",
  "OWNERSHIP_CHANGED",
  "POLICY_VIOLATION",
]);

export class NotificationDispatcher {
  constructor({ resolveCurrentOwner, loadOwnerPrivateSettings, adapters }) {
    if (typeof resolveCurrentOwner !== "function" || typeof loadOwnerPrivateSettings !== "function") {
      throw new TypeError("owner resolver and private settings loader are required");
    }
    if (!(adapters instanceof Map)) throw new TypeError("adapters must be a Map");
    this.resolveCurrentOwner = resolveCurrentOwner;
    this.loadOwnerPrivateSettings = loadOwnerPrivateSettings;
    this.adapters = adapters;
  }

  async dispatch(event) {
    if (!NOTIFICATION_TYPES.has(event.type)) throw new TypeError("unsupported notification type");
    const identity = {
      chainId: Number(event.identity.chainId),
      collection: normalizeAddress(event.identity.collection, "collection"),
      tokenId: BigInt(event.identity.tokenId).toString(),
    };
    const liveOwner = normalizeAddress(await this.resolveCurrentOwner(identity), "owner");
    const privateSettings = await this.loadOwnerPrivateSettings(liveOwner);
    const configuredChannels = Array.isArray(privateSettings?.channels)
      ? privateSettings.channels
      : [];
    const deliveries = [];
    for (const channel of configuredChannels) {
      const adapter = this.adapters.get(channel.type);
      if (!adapter || typeof adapter.send !== "function") continue;
      const receipt = await adapter.send({
        destination: channel.destination,
        type: event.type,
        punk: assetKey(identity.chainId, identity.collection, identity.tokenId),
        publicPayload: Object.freeze({ ...(event.publicPayload ?? {}) }),
      });
      deliveries.push(Object.freeze({ channel: channel.type, receipt: String(receipt) }));
    }
    return Object.freeze({
      owner: liveOwner,
      delivered: deliveries.length,
      deliveries: Object.freeze(deliveries),
      authority: "NOTIFICATION_ONLY",
    });
  }
}
