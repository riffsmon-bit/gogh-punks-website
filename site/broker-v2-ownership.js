const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const AGGREGATE3 = "0x82ad56cb";
const OWNER_OF = "0x6352211e";
const BALANCE_OF = "0x70a08231";
const MAX_SUPPLY = "0xd5abeb01";
const MAX_PUNKS = 5_017;
const CHUNK_SIZE = 200;
const CONCURRENCY = 4;

function normalizedAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase() : null;
}

function tokenId(value) {
  const text = String(value);
  if (!/^(0|[1-9]\d{0,3})$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 9_999 ? text : null;
}

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function byteLength(value) {
  return (value.length - 2) / 2;
}

function abiWordAt(value, byteOffset) {
  const start = 2 + byteOffset * 2;
  const output = value.slice(start, start + 64);
  if (output.length !== 64) throw new TypeError("Ownership response is truncated.");
  return BigInt(`0x${output}`);
}

function encodeOwnerCalls(collection, tokenIds) {
  const target = normalizedAddress(collection);
  if (!target || !Array.isArray(tokenIds) || tokenIds.length < 1
    || tokenIds.length > 250 || tokenIds.some((value) => tokenId(value) === null)) {
    throw new TypeError("Ownership call input is invalid.");
  }
  const bodies = tokenIds.map((value) => [
    target.slice(2).padStart(64, "0"),
    word(1),
    word(96),
    word(36),
    `${OWNER_OF.slice(2)}${word(value)}`.padEnd(128, "0"),
  ].join(""));
  let offset = tokenIds.length * 32;
  const offsets = bodies.map((body) => {
    const current = word(offset);
    offset += body.length / 2;
    return current;
  });
  return `${AGGREGATE3}${word(32)}${word(tokenIds.length)}${offsets.join("")}${bodies.join("")}`;
}

function decodeOwners(value, tokenIds, expectedOwner) {
  const owner = normalizedAddress(expectedOwner);
  if (!owner || !Array.isArray(tokenIds) || tokenIds.length < 1 || tokenIds.length > 250
    || typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value)
    || byteLength(value) > 100_000 || abiWordAt(value, 0) !== 32n) {
    throw new TypeError("Ownership response is invalid.");
  }
  const arrayStart = 32;
  if (abiWordAt(value, arrayStart) !== BigInt(tokenIds.length)) {
    throw new TypeError("Ownership response count changed.");
  }
  const output = [];
  for (let index = 0; index < tokenIds.length; index += 1) {
    const relative = abiWordAt(value, arrayStart + 32 + index * 32);
    if (relative > BigInt(byteLength(value))) throw new TypeError("Ownership offset is invalid.");
    const tupleStart = arrayStart + 32 + Number(relative);
    const success = abiWordAt(value, tupleStart);
    const bytesOffset = abiWordAt(value, tupleStart + 32);
    if (success > 1n || bytesOffset !== 64n) throw new TypeError("Ownership tuple is invalid.");
    if (success === 0n) continue;
    if (abiWordAt(value, tupleStart + Number(bytesOffset)) !== 32n) {
      throw new TypeError("ownerOf returned an invalid word.");
    }
    const dataStart = tupleStart + Number(bytesOffset) + 32;
    const result = value.slice(2 + dataStart * 2, 2 + (dataStart + 32) * 2);
    if (!/^0{24}[0-9a-fA-F]{40}$/.test(result)) {
      throw new TypeError("ownerOf returned a noncanonical address.");
    }
    if (`0x${result.slice(-40)}`.toLowerCase() === owner) output.push(String(tokenIds[index]));
  }
  return output;
}

async function ethCall(provider, to, data, blockTag) {
  const output = await provider.request({ method: "eth_call", params: [{ to, data }, blockTag] });
  if (typeof output !== "string" || !/^0x[0-9a-fA-F]+$/.test(output)) {
    throw new TypeError("Robinhood ownership read failed.");
  }
  return output;
}

async function verifiedFrom(provider, collection, owner, values, blockTag) {
  const output = [];
  for (let offset = 0; offset < values.length; offset += CHUNK_SIZE) {
    const chunk = values.slice(offset, offset + CHUNK_SIZE);
    const response = await ethCall(provider, MULTICALL3, encodeOwnerCalls(collection, chunk), blockTag);
    output.push(...decodeOwners(response, chunk, owner));
  }
  return output;
}

async function fullCollectionScan(provider, collection, owner, maximum, blockTag) {
  const chunks = [];
  for (let first = 0; first <= maximum; first += CHUNK_SIZE) {
    chunks.push(Array.from({ length: Math.min(CHUNK_SIZE, maximum - first + 1) },
      (_, index) => String(first + index)));
  }
  const output = [];
  let cursor = 0;
  const scan = async () => {
    while (cursor < chunks.length) {
      const chunk = chunks[cursor++];
      const response = await ethCall(
        provider, MULTICALL3, encodeOwnerCalls(collection, chunk), blockTag,
      );
      output.push(...decodeOwners(response, chunk, owner));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, scan));
  return output;
}

export async function verifyOwnedPunkIds(provider, collection, owner, candidateTokenIds = []) {
  const target = normalizedAddress(collection);
  const expectedOwner = normalizedAddress(owner);
  const candidates = [...new Set(candidateTokenIds.map(tokenId))];
  if (!provider?.request || !target || !expectedOwner || candidates.includes(null)
    || candidates.length > MAX_PUNKS) throw new TypeError("Ownership verification is unavailable.");

  const blockTag = await provider.request({ method: "eth_blockNumber" });
  if (typeof blockTag !== "string" || !/^0x[0-9a-fA-F]+$/.test(blockTag)) {
    throw new TypeError("Robinhood block number is unavailable.");
  }
  const balanceRaw = await ethCall(
    provider, target, `${BALANCE_OF}${expectedOwner.slice(2).padStart(64, "0")}`, blockTag,
  );
  if (!/^0x[0-9a-fA-F]{64}$/.test(balanceRaw)) {
    throw new TypeError("Punk balance response is invalid.");
  }
  const balance = Number(BigInt(balanceRaw));
  if (!Number.isSafeInteger(balance) || balance < 0 || balance > MAX_PUNKS) {
    throw new RangeError("Punk balance is outside the collection bound.");
  }
  if (balance === 0) return Object.freeze({ tokenIds: Object.freeze([]), balance, blockTag });

  let owned = candidates.length
    ? await verifiedFrom(provider, target, expectedOwner, candidates, blockTag) : [];
  if (owned.length !== balance) {
    const maximumRaw = await ethCall(provider, target, MAX_SUPPLY, blockTag);
    if (!/^0x[0-9a-fA-F]{64}$/.test(maximumRaw)) {
      throw new TypeError("Collection maximum supply is unavailable.");
    }
    const maximum = Number(BigInt(maximumRaw));
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum >= MAX_PUNKS) {
      throw new RangeError("Collection maximum supply is outside the expected bound.");
    }
    owned = await fullCollectionScan(provider, target, expectedOwner, maximum, blockTag);
  }
  owned.sort((left, right) => Number(left) - Number(right));
  if (owned.length !== balance || new Set(owned).size !== owned.length) {
    throw new TypeError("Live ownership did not reconcile with balanceOf.");
  }
  return Object.freeze({ tokenIds: Object.freeze(owned), balance, blockTag });
}
