import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  hashToken,
  parseCookies,
  randomToken,
  safeEqual,
} from "../netlify/functions/_shared/session.mjs";
import {
  buildVerificationMessage,
  normalizeWalletAddress,
} from "../netlify/functions/_shared/verification.mjs";

test("opaque sessions are random and stored as hashes", () => {
  const first = randomToken();
  const second = randomToken();
  assert.notEqual(first, second);
  assert.match(hashToken(first), /^[0-9a-f]{64}$/);
  assert.notEqual(hashToken(first), first);
  assert.equal(safeEqual(first, first), true);
  assert.equal(safeEqual(first, second), false);
});

test("cookie parsing does not confuse neighboring values", () => {
  const request = new Request("https://example.test", {
    headers: { cookie: "one=alpha; gogh_gtd_session=secret-token; two=beta" },
  });
  assert.equal(parseCookies(request).get("gogh_gtd_session"), "secret-token");
});

test("SIWE message binds wallet, Discord identity, chain, expiry, and safety statement", () => {
  process.env.SITE_URL = "https://goghpunks.example";
  process.env.CHAIN_ID = "4663";
  process.env.GTD_CAPTURE_CAP = "200";
  const walletAddress = normalizeWalletAddress(
    "0x1111111111111111111111111111111111111111",
  );
  const { message } = buildVerificationMessage({
    walletAddress,
    discordUserId: "1164591872396775508",
    requestId: "test-request",
  });
  assert.match(message, /goghpunks\.example wants you to sign in/);
  assert.match(message, /Chain ID: 4663/);
  assert.match(message, /https:\/\/discord\.com\/users\/1164591872396775508/);
  assert.match(message, /200 GTD allowlist spots/);
  assert.match(message, /No transaction or approval is requested/);
  assert.match(message, /Expiration Time:/);
});

test("schema and transaction enforce uniqueness and serialize the cap check", async () => {
  const migration = await readFile(
    new URL(
      "../netlify/database/migrations/20260809170000_create_gtd_capture.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const database = await readFile(
    new URL("../netlify/functions/_shared/database.mjs", import.meta.url),
    "utf8",
  );
  assert.match(migration, /wallet_address CHAR\(42\) PRIMARY KEY/);
  assert.match(migration, /discord_user_id VARCHAR\(20\) NOT NULL UNIQUE/);
  assert.match(migration, /allocation_limit = 3/);
  assert.match(migration, /price_eth = 0/);
  assert.match(database, /pg_advisory_xact_lock/);
  assert.match(database, /COUNT\(\*\)::integer AS claimed/);
  assert.match(database, /role_sync_state = \$2::VARCHAR\(20\)/);
  assert.match(database, /WHEN \$2::VARCHAR\(20\) = 'SYNCED'/);
});
