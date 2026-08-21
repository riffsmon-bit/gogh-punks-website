#!/bin/sh
set -eu

# Dummy addresses and nonce only. Replace all four values for a real review.
# This prints a deterministic, non-authorizing review artifact to stdout only;
# a real public nonce must be generated externally with a CSPRNG.
exec node scripts/build-guardian-safe-deployment-review.mjs \
  --owner 0x1111111111111111111111111111111111111111 \
  --owner 0x2222222222222222222222222222222222222222 \
  --owner 0x3333333333333333333333333333333333333333 \
  --threshold 2 \
  --salt-nonce 0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
