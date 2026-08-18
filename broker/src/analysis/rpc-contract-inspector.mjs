import { keccak256 } from "viem";
import { ROBINHOOD, normalizeAddress } from "../config.mjs";

export const EIP1967_SLOTS = Object.freeze({
  implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  admin: "0xb53127684a568b3173ae13b9f8a6016e019b13b6bcbc3e8e9a7d6a717850b5d6103",
  beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
});

const OPCODES = Object.freeze({
  CALL: 0xf1,
  CALLCODE: 0xf2,
  DELEGATECALL: 0xf4,
  CREATE: 0xf0,
  CREATE2: 0xf5,
  SELFDESTRUCT: 0xff,
});

function bytecodeBytes(bytecode) {
  if (typeof bytecode !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(bytecode)) {
    throw new TypeError("eth_getCode returned invalid bytecode");
  }
  return bytecode.slice(2).toLowerCase();
}

export function scanRuntimeOpcodes(bytecode) {
  const bytes = bytecodeBytes(bytecode);
  const counts = new Map();
  for (let cursor = 0; cursor < bytes.length;) {
    const opcode = Number.parseInt(bytes.slice(cursor, cursor + 2), 16);
    counts.set(opcode, (counts.get(opcode) ?? 0) + 1);
    cursor += 2;
    if (opcode >= 0x60 && opcode <= 0x7f) cursor += (opcode - 0x5f) * 2;
  }
  const count = (opcode) => counts.get(opcode) ?? 0;
  return Object.freeze({
    callCount: count(OPCODES.CALL),
    callcodeCount: count(OPCODES.CALLCODE),
    delegatecallCount: count(OPCODES.DELEGATECALL),
    createCount: count(OPCODES.CREATE),
    create2Count: count(OPCODES.CREATE2),
    selfdestructCount: count(OPCODES.SELFDESTRUCT),
  });
}

function storageAddress(word) {
  if (typeof word !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(word)) return null;
  const address = `0x${word.slice(-40)}`.toLowerCase();
  return /^0x0{40}$/.test(address) ? null : address;
}

function supportsInterfaceData(interfaceId) {
  return `0x01ffc9a7${interfaceId.replace(/^0x/, "").padStart(64, "0")}`;
}

function boolResult(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) return null;
  return BigInt(value) === 1n;
}

function blockTag(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function observedDate(clock) {
  const value = new Date(clock());
  if (Number.isNaN(value.getTime())) throw new TypeError("clock returned an invalid date");
  return value.toISOString();
}

function blockEvidence(block, expectedNumber) {
  if (!block || !/^0x[0-9a-fA-F]{64}$/.test(block.hash ?? "")) {
    throw new TypeError("eth_getBlockByNumber returned an invalid block hash");
  }
  const number = BigInt(block.number);
  if (number !== expectedNumber) throw new TypeError("RPC returned the wrong evidence block");
  const timestamp = BigInt(block.timestamp);
  if (timestamp < 0n) throw new TypeError("RPC returned an invalid block timestamp");
  return Object.freeze({
    observedBlock: number.toString(),
    observedBlockHash: block.hash.toLowerCase(),
    observedBlockTimestamp: timestamp.toString(),
  });
}

export class RpcContractInspector {
  constructor({
    rpc,
    chainId = ROBINHOOD.chainId,
    confirmations = 20,
    clock = () => new Date(),
  }) {
    if (typeof rpc !== "function") throw new TypeError("rpc must be a function");
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    this.rpc = rpc;
    this.chainId = Number(chainId);
    this.confirmations = BigInt(confirmations);
    if (this.confirmations < 0n) throw new RangeError("confirmations cannot be negative");
    this.clock = clock;
  }

  async inspect(contractAddress, { blockNumber } = {}) {
    const address = normalizeAddress(contractAddress, "contractAddress");
    const remoteChainId = Number(BigInt(await this.rpc("eth_chainId", [])));
    if (remoteChainId !== this.chainId || remoteChainId !== ROBINHOOD.chainId) {
      throw new Error(`RPC chain mismatch: expected ${this.chainId}, received ${remoteChainId}`);
    }
    const head = BigInt(await this.rpc("eth_blockNumber", []));
    const safeHead = head > this.confirmations ? head - this.confirmations : 0n;
    const evidenceBlock = blockNumber === undefined ? safeHead : BigInt(blockNumber);
    if (evidenceBlock < 0n || evidenceBlock > safeHead) {
      throw new RangeError("evidence block must be non-negative and confirmed");
    }
    const evidenceTag = blockTag(evidenceBlock);
    const provenance = blockEvidence(
      await this.rpc("eth_getBlockByNumber", [evidenceTag, false]),
      evidenceBlock,
    );
    const bytecode = String(await this.rpc("eth_getCode", [address, evidenceTag])).toLowerCase();
    const bytes = bytecodeBytes(bytecode);
    if (bytes.length === 0) {
      return Object.freeze({
        chainId: this.chainId,
        address,
        observedAt: observedDate(this.clock),
        ...provenance,
        bytecodePresent: false,
        sourceVerified: false,
        proxyDetected: false,
        erc721: null,
        erc1155: null,
        findings: Object.freeze(["NO_RUNTIME_BYTECODE"]),
      });
    }

    const probeFailures = [];
    const storage = {};
    const storageResults = await Promise.all(
      Object.entries(EIP1967_SLOTS).map(async ([name, slot]) => {
        try {
          return [name, storageAddress(
            await this.rpc("eth_getStorageAt", [address, slot, evidenceTag]),
          ), null];
        } catch {
          return [name, null, `EIP1967_${name.toUpperCase()}_UNAVAILABLE`];
        }
      }),
    );
    for (const [name, value, failure] of storageResults) {
      storage[name] = value;
      if (failure) probeFailures.push(failure);
    }

    const interfaces = {};
    const interfaceResults = await Promise.all(
      Object.entries({ erc721: "0x80ac58cd", erc1155: "0xd9b67a26" })
        .map(async ([name, interfaceId]) => {
          try {
            const result = boolResult(await this.rpc(
              "eth_call",
              [{ to: address, data: supportsInterfaceData(interfaceId) }, evidenceTag],
            ));
            return [
              name,
              result,
              result === null ? `${name.toUpperCase()}_INTERFACE_INVALID_RESULT` : null,
            ];
          } catch {
            return [name, null, `${name.toUpperCase()}_INTERFACE_UNAVAILABLE`];
          }
        }),
    );
    for (const [name, value, failure] of interfaceResults) {
      interfaces[name] = value;
      if (failure) probeFailures.push(failure);
    }

    const opcodes = scanRuntimeOpcodes(bytecode);
    const proxyDetected = Boolean(storage.implementation || storage.beacon || opcodes.delegatecallCount);
    return Object.freeze({
      chainId: this.chainId,
      address,
      observedAt: observedDate(this.clock),
      ...provenance,
      bytecodePresent: true,
      bytecodeSize: bytes.length / 2,
      runtimeBytecodeHash: keccak256(bytecode),
      sourceVerified: false,
      proxyDetected,
      implementation: storage.implementation,
      proxyAdmin: storage.admin,
      beacon: storage.beacon,
      unverifiedImplementation: proxyDetected,
      delegatecallDetected: opcodes.delegatecallCount > 0,
      unusualExternalCalls: opcodes.callcodeCount > 0,
      callbackSurface: opcodes.callCount > 0,
      createDetected: opcodes.createCount > 0,
      create2Detected: opcodes.create2Count > 0,
      selfdestructDetected: opcodes.selfdestructCount > 0,
      opcodeCounts: opcodes,
      erc721: interfaces.erc721,
      erc1155: interfaces.erc1155,
      ownershipPrivileges: "UNVERIFIED",
      mintPrivileges: "UNVERIFIED",
      pausePrivileges: "UNVERIFIED",
      metadataMutability: "UNVERIFIED",
      transferRestrictions: "UNVERIFIED",
      royaltyConfiguration: "UNVERIFIED",
      probeFailures: Object.freeze(probeFailures),
      caveat: "Bytecode and interface signals are evidence, not a contract-safety guarantee.",
    });
  }
}
