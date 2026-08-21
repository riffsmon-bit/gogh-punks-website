export const ROBINHOOD = Object.freeze({
  name: "Robinhood Chain",
  chainId: 4663,
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorerUrl: "https://robinhoodchain.blockscout.com",
  nativeCurrency: Object.freeze({ name: "Ether", symbol: "ETH", decimals: 18 }),
  canonicalCollection: "0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6",
  canonicalERC6551Registry: "0x000000006551c19487814612e58fe06813775758",
  canonicalERC6551RegistryRuntimeCodeHash:
    "0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735",
});

export const FEATURE_DEFAULTS = Object.freeze({
  ENABLE_SCOUT_MODE: true,
  ENABLE_APPROVAL_PURCHASES: false,
  ENABLE_AUTONOMOUS_PURCHASES: false,
  ENABLE_AUTONOMOUS_MINTS: false,
  ENABLE_UNKNOWN_COLLECTION_EXECUTION: false,
  ENABLE_SELLING: false,
  ENABLE_AUTONOMOUS_SELLING: false,
});

export const BROKER_MODES = Object.freeze([
  "DISABLED",
  "SCOUT",
  "APPROVAL_REQUIRED",
  "AUTONOMOUS",
]);

export const OPPORTUNITY_TYPES = Object.freeze([
  "MINT",
  "SECONDARY_BUY",
  "FREE_MINT",
  "EDITION",
  "ONE_OF_ONE",
  "AUCTION",
  "ALLOWLIST_MINT",
  "COLLECTION_DROP",
]);

export function assetKey(chainId, collection, tokenId) {
  return `${Number(chainId)}:${normalizeAddress(collection)}:${BigInt(tokenId).toString()}`;
}

export function punkKey(tokenId) {
  return assetKey(ROBINHOOD.chainId, ROBINHOOD.canonicalCollection, tokenId);
}

export function normalizeAddress(value, field = "address") {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError(`${field} must be a 20-byte EVM address`);
  }
  return value.toLowerCase();
}

export function readFeatureFlags(environment = process.env) {
  const parsed = { ...FEATURE_DEFAULTS };
  for (const key of Object.keys(parsed)) {
    const value = environment[key];
    if (value === undefined || value === "") continue;
    if (value !== "true" && value !== "false") {
      throw new TypeError(`${key} must be exactly true or false`);
    }
    parsed[key] = value === "true";
  }
  if (parsed.ENABLE_AUTONOMOUS_MINTS && !parsed.ENABLE_AUTONOMOUS_PURCHASES) {
    throw new TypeError("Autonomous mints require autonomous purchases");
  }
  if (
    parsed.ENABLE_UNKNOWN_COLLECTION_EXECUTION &&
    !parsed.ENABLE_AUTONOMOUS_PURCHASES
  ) {
    throw new TypeError("Unknown collection execution requires autonomous purchases");
  }
  if (parsed.ENABLE_AUTONOMOUS_SELLING && !parsed.ENABLE_SELLING) {
    throw new TypeError("Autonomous selling requires selling");
  }
  return Object.freeze(parsed);
}
