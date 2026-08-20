const METADATA_STATUSES = new Set(["AVAILABLE", "NOT_FOUND", "ERROR"]);
const TOKEN_STANDARDS = new Set(["ERC721", "ERC1155", "UNKNOWN"]);
const OPENSEA_IMAGE_HOSTS = new Set(["i.seadn.io", "raw2.seadn.io"]);
const MAX_TRAITS = 64;

function nullableText(value, maximum) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, maximum) : null;
}

function allowlistedUrl(value, { hostname, hostnames, pathnamePrefix = "/" }) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const allowedHostname = hostnames instanceof Set
      ? hostnames.has(url.hostname)
      : url.hostname === hostname;
    if (
      url.protocol !== "https:"
      || !allowedHostname
      || url.port
      || url.username
      || url.password
      || url.hash
      || !url.pathname.startsWith(pathnamePrefix)
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function displayTraits(value) {
  if (!Array.isArray(value)) return null;
  return value.slice(0, MAX_TRAITS).flatMap((trait) => {
    if (!trait || typeof trait !== "object" || Array.isArray(trait)) return [];
    const traitType = nullableText(trait.traitType ?? trait.trait_type, 96);
    const traitValue = nullableText(trait.value, 160);
    return traitType && traitValue ? [{ traitType, value: traitValue }] : [];
  });
}

export function nftDisplayMetadata(row = {}) {
  return {
    status: METADATA_STATUSES.has(row.nft_metadata_status)
      ? row.nft_metadata_status
      : null,
    name: nullableText(row.nft_metadata_name, 200),
    description: nullableText(row.nft_metadata_description, 2_000),
    imageUrl: allowlistedUrl(row.nft_metadata_image_url, {
      hostnames: OPENSEA_IMAGE_HOSTS,
    }),
    collectionSlug: nullableText(row.nft_metadata_collection_slug, 160),
    tokenStandard: TOKEN_STANDARDS.has(row.nft_metadata_token_standard)
      ? row.nft_metadata_token_standard
      : null,
    traits: displayTraits(row.nft_metadata_traits),
    openSeaUrl: allowlistedUrl(row.nft_metadata_opensea_url, {
      hostname: "opensea.io",
      pathnamePrefix: "/assets/robinhood/",
    }),
    fetchedAt: row.nft_metadata_fetched_at ?? null,
  };
}

export function attachNftDisplayMetadata(row) {
  if (!row) return null;
  const {
    nft_metadata_status: _status,
    nft_metadata_name: _name,
    nft_metadata_description: _description,
    nft_metadata_image_url: _imageUrl,
    nft_metadata_collection_slug: _collectionSlug,
    nft_metadata_token_standard: _tokenStandard,
    nft_metadata_traits: _traits,
    nft_metadata_opensea_url: _openSeaUrl,
    nft_metadata_fetched_at: _fetchedAt,
    ...record
  } = row;
  return { ...record, nftMetadata: nftDisplayMetadata(row) };
}

export const NFT_DISPLAY_METADATA_SELECT = `
  nft_metadata.metadata_status AS nft_metadata_status,
  nft_metadata.name AS nft_metadata_name,
  nft_metadata.description AS nft_metadata_description,
  nft_metadata.display_image_url AS nft_metadata_image_url,
  nft_metadata.collection_slug AS nft_metadata_collection_slug,
  nft_metadata.token_standard AS nft_metadata_token_standard,
  nft_metadata.traits AS nft_metadata_traits,
  nft_metadata.opensea_url AS nft_metadata_opensea_url,
  nft_metadata.fetched_at AS nft_metadata_fetched_at`;
