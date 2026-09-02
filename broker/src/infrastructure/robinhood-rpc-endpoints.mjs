function requiredHttps(name, value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new TypeError(`${name} is unavailable`);
  }
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hash || url.username || url.password) {
    throw new TypeError(`${name} must use credential-free HTTPS URL syntax`);
  }
  return url.href;
}

export function resolveRobinhoodRpcPair(environment = process.env) {
  const primary = requiredHttps(
    "ROBINHOOD_RPC_URL",
    environment.ROBINHOOD_RPC_URL ?? environment.RPC_URL,
  );
  const automationOverride = environment.ROBINHOOD_AUTOMATION_SECONDARY_RPC_URL?.trim() || null;
  const secondary = automationOverride !== null
    ? requiredHttps(
      "ROBINHOOD_AUTOMATION_SECONDARY_RPC_URL",
      automationOverride,
    )
    : requiredHttps(
      "ROBINHOOD_SECONDARY_RPC_URL",
      environment.ROBINHOOD_SECONDARY_RPC_URL,
    );
  if (new URL(primary).hostname === new URL(secondary).hostname) {
    throw new TypeError("Robinhood live checks require two distinct RPC hosts");
  }
  return Object.freeze({ primary, secondary });
}
