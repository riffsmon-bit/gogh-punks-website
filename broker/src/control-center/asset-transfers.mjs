import { encodeFunctionData, getAddress, isAddress } from "viem";
import { snapshotExactRecord, snapshotRecord } from "./strict-record.mjs";

const ERC20 = [{ type: "function", name: "transfer", stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }] }];
const ERC721 = [{ type: "function", name: "safeTransferFrom", stateMutability: "nonpayable",
  inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" },
    { name: "tokenId", type: "uint256" }], outputs: [] }];
const ERC1155 = [{ type: "function", name: "safeTransferFrom", stateMutability: "nonpayable",
  inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" },
    { name: "id", type: "uint256" }, { name: "amount", type: "uint256" },
    { name: "data", type: "bytes" }], outputs: [] }];

function address(value, label) {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    throw new TypeError(`${label} must be an exact address`);
  }
  return getAddress(value);
}

function uint(value, label, { positive = false } = {}) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError(`${label} must be a canonical integer string`);
  }
  const parsed = BigInt(value);
  if (positive && parsed === 0n) throw new RangeError(`${label} must be positive`);
  if (parsed >= 2n ** 256n) throw new RangeError(`${label} is too large`);
  return parsed;
}

export function buildNativeDeposit(input) {
  const { punkWallet, amountWei } = snapshotExactRecord(input, ["punkWallet", "amountWei"],
    "native deposit");
  return Object.freeze({ to: address(punkWallet, "Punk Wallet"),
    value: uint(amountWei, "amountWei", { positive: true }), data: "0x" });
}

export function buildAssetDeposit(input) {
  input = snapshotRecord(input, "deposit input");
  const fields = input.standard === "ERC20"
    ? ["standard", "currentOwner", "punkWallet", "contract", "amount"]
    : input.standard === "ERC721"
      ? ["standard", "currentOwner", "punkWallet", "contract", "tokenId"]
      : ["standard", "currentOwner", "punkWallet", "contract", "tokenId", "amount"];
  input = snapshotExactRecord(input, fields, "deposit input");
  const owner = address(input.currentOwner, "current owner");
  const punk = address(input.punkWallet, "Punk Wallet");
  const collection = address(input.contract, "asset contract");
  if (input.standard === "ERC20") {
    return Object.freeze({ to: collection, value: 0n, data: encodeFunctionData({ abi: ERC20,
      functionName: "transfer", args: [punk, uint(input.amount, "amount", { positive: true })] }) });
  }
  if (input.standard === "ERC721") {
    return Object.freeze({ to: collection, value: 0n, data: encodeFunctionData({ abi: ERC721,
      functionName: "safeTransferFrom", args: [owner, punk, uint(input.tokenId, "tokenId")] }) });
  }
  if (input.standard === "ERC1155") {
    return Object.freeze({ to: collection, value: 0n, data: encodeFunctionData({ abi: ERC1155,
      functionName: "safeTransferFrom", args: [owner, punk, uint(input.tokenId, "tokenId"),
        uint(input.amount, "amount", { positive: true }), "0x"] }) });
  }
  throw new TypeError("unsupported deposit standard");
}

export function buildFixedOwnerWithdrawal(rawInput) {
  let input = snapshotRecord(rawInput, "withdrawal input");
  const fields = input.standard === "ERC20"
    ? ["standard", "punkWallet", "currentOwner", "contract", "amount"]
    : input.standard === "ERC721"
      ? ["standard", "punkWallet", "currentOwner", "contract", "tokenId"]
      : ["standard", "punkWallet", "currentOwner", "contract", "tokenId", "amount"];
  input = snapshotExactRecord(input, fields, "withdrawal input");
  const { standard, punkWallet, currentOwner, contract, tokenId, amount } = input;
  const punk = address(punkWallet, "Punk Wallet");
  const owner = address(currentOwner, "current owner");
  const collection = address(contract, "asset contract");
  if (standard === "ERC20") {
    return Object.freeze({ callTarget: collection, callValue: 0n,
      callData: encodeFunctionData({ abi: ERC20, functionName: "transfer",
        args: [owner, uint(amount, "amount", { positive: true })] }), fixedDestination: owner });
  }
  if (standard === "ERC721") {
    return Object.freeze({ callTarget: collection, callValue: 0n,
      callData: encodeFunctionData({ abi: ERC721, functionName: "safeTransferFrom",
        args: [punk, owner, uint(tokenId, "tokenId")] }), fixedDestination: owner });
  }
  if (standard === "ERC1155") {
    return Object.freeze({ callTarget: collection, callValue: 0n,
      callData: encodeFunctionData({ abi: ERC1155, functionName: "safeTransferFrom",
        args: [punk, owner, uint(tokenId, "tokenId"),
          uint(amount, "amount", { positive: true }), "0x"] }), fixedDestination: owner });
  }
  throw new TypeError("unsupported withdrawal standard");
}
