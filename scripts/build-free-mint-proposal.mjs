import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  buildOwnerReviewFreeMintProposal,
  FreeMintProposalError,
} from "../broker/src/recommendation/owner-approved-free-mint-proposal.mjs";

const VALUE_ARGUMENTS = new Map([
  ["--chain-id", "chainId"],
  ["--punk-collection", "punkCollection"],
  ["--punk-token-id", "punkTokenId"],
  ["--punk-account", "punkAccount"],
  ["--expected-owner", "expectedOwner"],
  ["--opportunity-type", "opportunityType"],
  ["--asset-standard", "assetStandard"],
  ["--adapter", "adapter"],
  ["--venue", "venue"],
  ["--collection", "collection"],
  ["--mint-selector", "mintSelector"],
  ["--token-id", "tokenId"],
  ["--asset-amount", "assetAmount"],
  ["--currency", "currency"],
  ["--expected-price", "expectedPrice"],
  ["--max-price", "maxPrice"],
  ["--max-slippage-bps", "maxSlippageBps"],
  ["--expires-at", "expiresAt"],
  ["--nonce", "nonce"],
  ["--policy-version", "policyVersion"],
  ["--opportunity-id", "opportunityId"],
  ["--reasoning-hash", "reasoningHash"],
  ["--adapter-code-hash", "adapterCodeHash"],
]);

const USAGE = [
  "Usage: node scripts/build-free-mint-proposal.mjs",
  "  --chain-id 4663 --punk-collection 0x... --punk-token-id N",
  "  --punk-account 0x... --expected-owner 0x... --owner-review",
  "  --opportunity-type FREE_MINT --asset-standard ERC721|ERC1155",
  "  --adapter 0x... --venue 0x... --collection 0x... --mint-selector 0x12345678",
  "  --token-id N",
  "  --asset-amount 1 --currency 0x000...000 --expected-price 0 --max-price 0",
  "  --max-slippage-bps 0 --expires-at UNIX_SECONDS --nonce N --policy-version N",
  "  --opportunity-id 0x... --reasoning-hash 0x... --adapter-code-hash 0x...",
].join("\n");

export function parseFreeMintProposalArguments(args) {
  if (!Array.isArray(args)) throw new TypeError("args must be an array");
  const input = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--owner-review") {
      if (Object.hasOwn(input, "ownerReview")) throw new Error("duplicate --owner-review");
      input.ownerReview = true;
      continue;
    }
    const field = VALUE_ARGUMENTS.get(argument);
    if (!field) throw new Error(`unknown argument: ${argument}`);
    if (Object.hasOwn(input, field)) throw new Error(`duplicate argument: ${argument}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for ${argument}`);
    }
    input[field] = value;
    index += 1;
  }
  return input;
}

export function runFreeMintProposalCli(args, { nowSeconds } = {}) {
  const input = parseFreeMintProposalArguments(args);
  return buildOwnerReviewFreeMintProposal(input, { nowSeconds });
}

function isMainModule() {
  return process.argv[1]
    && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  try {
    const result = runFreeMintProposalCli(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const code = error instanceof FreeMintProposalError ? error.code : "INVALID_ARGUMENTS";
    console.error(`FREE MINT PROPOSAL ERROR [${code}]: ${error.message}`);
    console.error(USAGE);
    process.exitCode = 2;
  }
}
