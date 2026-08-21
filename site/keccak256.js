// Minimal Keccak-256 for local browser verification of EVM runtime bytecode.
// The implementation follows Keccak-f[1600] with the Ethereum 0x01 domain suffix.
const MASK_64 = (1n << 64n) - 1n;
const RATE_BYTES = 136;
const ROTATION = Object.freeze([
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
]);
const ROUND_CONSTANTS = Object.freeze([
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
]);

function rotateLeft(value, shift) {
  if (shift === 0) return value & MASK_64;
  const bits = BigInt(shift);
  return ((value << bits) | (value >> (64n - bits))) & MASK_64;
}

function permutation(state) {
  const column = new Array(5).fill(0n);
  const transformed = new Array(25).fill(0n);
  for (const roundConstant of ROUND_CONSTANTS) {
    for (let x = 0; x < 5; x += 1) {
      column[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      const delta = column[(x + 4) % 5] ^ rotateLeft(column[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y += 1) state[x + 5 * y] ^= delta;
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const destinationX = y;
        const destinationY = (2 * x + 3 * y) % 5;
        transformed[destinationX + 5 * destinationY] = rotateLeft(
          state[x + 5 * y],
          ROTATION[x + 5 * y],
        );
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const index = x + 5 * y;
        state[index] = (transformed[index]
          ^ ((~transformed[(x + 1) % 5 + 5 * y])
            & transformed[(x + 2) % 5 + 5 * y])) & MASK_64;
      }
    }
    state[0] ^= roundConstant;
  }
}

function bytesFromHex(value) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new TypeError("Keccak input must be canonical even-length hex bytes");
  }
  const bytes = new Uint8Array((value.length - 2) / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return bytes;
}

export function keccak256Hex(value) {
  const input = bytesFromHex(value);
  const paddedLength = Math.ceil((input.length + 1) / RATE_BYTES) * RATE_BYTES;
  const padded = new Uint8Array(paddedLength || RATE_BYTES);
  padded.set(input);
  padded[input.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const state = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += RATE_BYTES) {
    for (let lane = 0; lane < RATE_BYTES / 8; lane += 1) {
      let value64 = 0n;
      for (let byte = 0; byte < 8; byte += 1) {
        value64 |= BigInt(padded[offset + lane * 8 + byte]) << BigInt(byte * 8);
      }
      state[lane] ^= value64;
    }
    permutation(state);
  }
  const output = new Uint8Array(32);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number((state[Math.floor(index / 8)] >> BigInt((index % 8) * 8)) & 0xffn);
  }
  return `0x${[...output].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
