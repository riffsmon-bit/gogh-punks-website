import { keccak256 } from 'viem';

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const DESIGNATION = /^0xef0100[0-9a-f]{40}$/i;
const CODE = /^0x(?:[0-9a-f]{2})*$/i;
const EMPTY = Object.freeze({ kind: 'EOA', codeHash: keccak256('0x'), delegation: null, delegationCodeHash: null });
const valid = value => { if (!value) throw Error('FORGE_TRAINING_STATE_UNVERIFIED'); };

// Existing EIP-7702 designation observation, matching registry/deployment review.
// This does not install or audit a delegate. Training still submits only its exact
// EIP-1559 direct call, without an authorization list or wallet-module execution.
export async function readTrainingOwnerOrigination({ client, owner, blockNumber }) {
  valid(ADDRESS.test(owner) && !/^0x0{40}$/i.test(owner) && typeof blockNumber === 'bigint' && blockNumber >= 0n);
  const code = await client.getCode({ address: owner, blockNumber });
  if (code === undefined || code === '0x') return EMPTY;
  valid(typeof code === 'string' && DESIGNATION.test(code));
  const delegation = `0x${code.slice(8)}`.toLowerCase();
  valid(!/^0x0{40}$/.test(delegation) && delegation !== owner.toLowerCase());
  const target = await client.getCode({ address: delegation, blockNumber });
  valid(typeof target === 'string' && CODE.test(target) && target !== '0x' && !/^0xef0100/i.test(target));
  return Object.freeze({ kind: 'EIP7702_DELEGATED_EOA', codeHash: keccak256(code), delegation,
    delegationCodeHash: keccak256(target) });
}

export function sameTrainingOwnerOrigination(before, after) {
  return ['kind', 'codeHash', 'delegation', 'delegationCodeHash'].every(key => before[key] === after[key]);
}
