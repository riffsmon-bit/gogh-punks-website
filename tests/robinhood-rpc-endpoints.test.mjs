import assert from "node:assert/strict";
import test from "node:test";

import { resolveRobinhoodRpcPair } from
  "../broker/src/infrastructure/robinhood-rpc-endpoints.mjs";

const PRIMARY = "https://rpc.mainnet.chain.robinhood.com";

test("explicit secondary URL is the only server-side fallback", () => {
  const pair = resolveRobinhoodRpcPair({
    ROBINHOOD_RPC_URL: PRIMARY,
    ROBINHOOD_ALCHEMY_API_KEY: "ignored_legacy_key_1234567890",
    ALCHEMY_API_KEY: "ignored_shared_key_1234567890",
    ROBINHOOD_SECONDARY_RPC_URL: "https://robinhood-rpc.publicnode.com",
  });
  assert.equal(pair.primary, `${PRIMARY}/`);
  assert.equal(pair.secondary, "https://robinhood-rpc.publicnode.com/");
});

test("automation-only endpoint takes precedence without changing the general secondary", () => {
  const pair = resolveRobinhoodRpcPair({
    ROBINHOOD_RPC_URL: PRIMARY,
    ROBINHOOD_AUTOMATION_SECONDARY_RPC_URL: "https://robinhood-rpc.publicnode.com",
    ROBINHOOD_ALCHEMY_API_KEY: "fresh_key_1234567890",
    ROBINHOOD_SECONDARY_RPC_URL: "https://archive.example/rpc",
  });
  assert.equal(pair.secondary, "https://robinhood-rpc.publicnode.com/");
});

test("full secondary URL remains a supported server-side fallback", () => {
  const pair = resolveRobinhoodRpcPair({
    ROBINHOOD_RPC_URL: PRIMARY,
    ROBINHOOD_SECONDARY_RPC_URL: "https://secondary.example/rpc",
  });
  assert.equal(pair.secondary, "https://secondary.example/rpc");
});

test("RPC resolution fails closed on credentials or one provider", () => {
  assert.throws(() => resolveRobinhoodRpcPair({
    ROBINHOOD_RPC_URL: PRIMARY,
    ROBINHOOD_ALCHEMY_API_KEY: "legacy-but-ignored",
  }), /ROBINHOOD_SECONDARY_RPC_URL is unavailable/);
  assert.throws(() => resolveRobinhoodRpcPair({
    ROBINHOOD_RPC_URL: PRIMARY,
    ROBINHOOD_SECONDARY_RPC_URL: "https://user:secret@secondary.example/rpc",
  }), /credential-free HTTPS/);
  assert.throws(() => resolveRobinhoodRpcPair({
    ROBINHOOD_RPC_URL: PRIMARY,
    ROBINHOOD_SECONDARY_RPC_URL: `${PRIMARY}/other`,
  }), /distinct RPC hosts/);
});
