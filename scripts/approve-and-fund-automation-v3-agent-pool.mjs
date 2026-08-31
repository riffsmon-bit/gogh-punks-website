#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { Contract, Interface, JsonRpcProvider, Wallet, concat, getAddress, parseEther } from "ethers";

const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const CHAIN_ID = 4663n;
const SAFE = getAddress("0x2b05E3BB4895A00d52894B98839Ae421d4139Ec8");
const REGISTRY = getAddress("0xbffbccd20E796e0f3E745B274De60EF17a485Dde");
const OWNER_KEYSTORE = "/Users/brandonduke/.foundry/keystores/gogh-punks-deployer";
const GUARDIAN_KEYSTORE = "/Users/brandonduke/.foundry/keystores/gogh-art-broker-guardian-signer-2-20260821";
const ZERO = "0x0000000000000000000000000000000000000000";
const TARGET_BALANCE = parseEther("0.002");
const LEGACY_AGENT = getAddress("0x3bb2ebf6b3c4d7f5e5781cdf2091428f7750af7d");
const NEW_AGENTS = [
  "0x12f0ffc4f108658f15b2b7e474744b43271bb2a7",
  "0xc1f910d8af370f8f4be957a7381e078b468dae1c",
  "0x02517f9851101459a7d0ac2faf962a93ed15c0ac",
  "0xaa354417ef5b62cd0cb6541f93e0534e4e4fa12b",
  "0x34c0d209fea3381b32169b1c6919751f203fc6c4",
].map(getAddress);
const ALL_AGENTS = [LEGACY_AGENT, ...NEW_AGENTS];

const SAFE_ABI = [
  "function nonce() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce) view returns (bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool)",
];
const REGISTRY_ABI = [
  "function owner() view returns (address)",
  "function globalAgent(address agent) view returns (bool approved,uint64 validAfter,uint64 validUntil,bytes32 versionHash,bytes32 metadataHash)",
  "function configureGlobalAgent(address agent,bool approved,uint64 validAfter,uint64 validUntil,bytes32 versionHash,bytes32 metadataHash)",
];

async function hiddenQuestion(message) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("A real Terminal is required for hidden password input.");
  }
  process.stdout.write(message);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let answer = "";
    const finish = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (buffer) => {
      for (const character of buffer.toString("utf8")) {
        if (character === "\u0003") {
          finish();
          reject(new Error("Cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          resolve(answer);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (answer.length > 0) {
            answer = answer.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (character >= " ") {
          answer += character;
          process.stdout.write("•");
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeSignatures(digest, wallets) {
  return concat([...wallets]
    .sort((left, right) => left.address.toLowerCase().localeCompare(right.address.toLowerCase()))
    .map((wallet) => wallet.signingKey.sign(digest).serialized));
}

async function main() {
  console.log("Gogh Art Broker — approve and fund six isolated automation lanes");
  console.log("Target: 0.002 ETH per signer. Existing authorized Punks remain on lane 1.");
  const ownerPassword = await hiddenQuestion("Punk-owner keystore password: ");
  const guardianPassword = await hiddenQuestion("Guardian signer 2 keystore password: ");
  const [ownerJson, guardianJson] = await Promise.all([
    readFile(OWNER_KEYSTORE, "utf8"), readFile(GUARDIAN_KEYSTORE, "utf8"),
  ]);
  const provider = new JsonRpcProvider(RPC_URL, Number(CHAIN_ID), { staticNetwork: true });
  const [ownerWallet, guardianWallet] = await Promise.all([
    Wallet.fromEncryptedJson(ownerJson, ownerPassword),
    Wallet.fromEncryptedJson(guardianJson, guardianPassword),
  ]);
  ownerPassword.fill?.(0);
  guardianPassword.fill?.(0);
  const signer = ownerWallet.connect(provider);
  const safe = new Contract(SAFE, SAFE_ABI, signer);
  const registry = new Contract(REGISTRY, REGISTRY_ABI, provider);
  const network = await provider.getNetwork();
  assert(network.chainId === CHAIN_ID, `Wrong chain: ${network.chainId}`);
  assert(getAddress(await registry.owner()) === SAFE, "Registry is not owned by the reviewed Guardian Safe.");
  const owners = (await safe.getOwners()).map(getAddress);
  assert(await safe.getThreshold() === 2n, "Guardian Safe threshold is not 2.");
  assert(owners.includes(ownerWallet.address), "Owner keystore is not a Guardian Safe owner.");
  assert(owners.includes(guardianWallet.address), "Guardian keystore is not a Guardian Safe owner.");
  assert(ownerWallet.address !== guardianWallet.address, "Guardian signatures are not independent.");
  const template = await registry.globalAgent(LEGACY_AGENT);
  const now = BigInt(Math.floor(Date.now() / 1000));
  assert(template.approved === true && template.validUntil > now + 86_400n,
    "Legacy agent approval is unavailable or too close to expiry.");
  const registryInterface = new Interface(REGISTRY_ABI);
  console.log(`Safe nonce: ${await safe.nonce()}`);
  console.log(`Approval window ends: ${new Date(Number(template.validUntil) * 1000).toISOString()}`);

  for (const agent of NEW_AGENTS) {
    const current = await registry.globalAgent(agent);
    if (current.approved && current.validUntil === template.validUntil
      && current.versionHash === template.versionHash && current.metadataHash === template.metadataHash) {
      console.log(`${agent} already has the exact reviewed global approval.`);
      continue;
    }
    const nonce = await safe.nonce();
    const data = registryInterface.encodeFunctionData("configureGlobalAgent", [
      agent, true, template.validAfter, template.validUntil, template.versionHash, template.metadataHash,
    ]);
    const digest = await safe.getTransactionHash(
      REGISTRY, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, nonce,
    );
    const signatures = safeSignatures(digest, [ownerWallet, guardianWallet]);
    console.log(`Approving ${agent} with Safe nonce ${nonce}...`);
    const transaction = await safe.execTransaction(
      REGISTRY, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, signatures,
    );
    console.log(`Submitted ${transaction.hash}`);
    const receipt = await transaction.wait();
    assert(receipt?.status === 1, `Approval failed for ${agent}.`);
    const confirmed = await registry.globalAgent(agent);
    assert(confirmed.approved && confirmed.validUntil === template.validUntil
      && confirmed.versionHash === template.versionHash && confirmed.metadataHash === template.metadataHash,
    `Approval verification failed for ${agent}.`);
    console.log(`Confirmed ${agent}`);
  }

  const ownerBalance = await provider.getBalance(ownerWallet.address);
  let required = 0n;
  const balances = [];
  for (const agent of ALL_AGENTS) {
    const balance = await provider.getBalance(agent);
    const topUp = balance < TARGET_BALANCE ? TARGET_BALANCE - balance : 0n;
    balances.push({ agent, balance, topUp });
    required += topUp;
  }
  assert(ownerBalance > required + parseEther("0.001"),
    "Owner wallet does not have the required funding plus a 0.001 ETH gas reserve.");
  for (const { agent, topUp } of balances) {
    if (topUp === 0n) {
      console.log(`${agent} already holds at least 0.002 ETH.`);
      continue;
    }
    console.log(`Funding ${agent} to 0.002 ETH...`);
    const transaction = await signer.sendTransaction({ to: agent, value: topUp });
    console.log(`Submitted ${transaction.hash}`);
    const receipt = await transaction.wait();
    assert(receipt?.status === 1, `Funding failed for ${agent}.`);
    assert(await provider.getBalance(agent) >= TARGET_BALANCE, `Funding verification failed for ${agent}.`);
  }
  console.log("\nALL SIX SIGNERS APPROVED AND FUNDED.");
  console.log("No worker flags were enabled by this script. Run the post-approval canary before cutover.");
}

main().catch((error) => {
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch {}
  console.error(`STOPPED FAIL-CLOSED: ${error instanceof Error ? error.message : "Unknown failure"}`);
  process.exitCode = 1;
});
