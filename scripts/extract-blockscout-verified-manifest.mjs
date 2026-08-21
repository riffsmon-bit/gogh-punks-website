import { pathToFileURL } from "node:url";
import { canonicalJson } from "../broker/src/scout/canonical-json.mjs";
import {
  extractBlockscoutVerifiedManifest,
  readSourceVerificationJsonFile,
  SourceVerificationGateError,
} from "./adopt-blockscout-verified-manifest.mjs";

export function parseVerifiedManifestExtractorArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== "--verified-proposal"
    || typeof argv[1] !== "string" || argv[1].length === 0 || argv[1].startsWith("--")) {
    throw new SourceVerificationGateError(
      "INVALID_ARGUMENTS",
      "required exactly once: --verified-proposal PATH",
    );
  }
  return { verifiedProposalPath: argv[1] };
}

export function renderExtractedVerifiedManifest(manifest) {
  return `${canonicalJson(manifest)}\n`;
}

async function main() {
  const { verifiedProposalPath } = parseVerifiedManifestExtractorArguments(
    process.argv.slice(2),
  );
  const verifiedProposal = await readSourceVerificationJsonFile(
    verifiedProposalPath,
    16 * 1024 * 1024,
    "verified manifest proposal",
  );
  const manifest = extractBlockscoutVerifiedManifest(verifiedProposal);
  process.stdout.write(renderExtractedVerifiedManifest(manifest));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    const message = error instanceof SourceVerificationGateError
      ? error.message
      : "VERIFIED_MANIFEST_EXTRACTION_FAILED: unexpected read-only extraction failure";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
