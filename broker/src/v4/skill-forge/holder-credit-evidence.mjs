import { keccak256, parseAbi } from 'viem';
import { paidCanonicalState } from './paid-canonical.mjs';

const ABI = parseAbi(['function trainingCredits(uint256) view returns(uint256)']);
// Credits are attached to tokenId, not its four wallets. A zero wallet balance
// does not make either credit ledger expendable. A paused paid release remains
// readable; an unavailable deployed extension must fail closed.
export async function readHolderCreditEvidence({ clients, release, source, now = Date.now,
  paidReader = paidCanonicalState }) {
  if (clients?.length !== 2 || clients[0] === clients[1]) throw Error('HOLDER_TWO_PROVIDERS_REQUIRED');
  const blockNumber = BigInt(source.anchor.number);
  const observations = await Promise.all(clients.map(async client => {
    if (keccak256(await client.getCode({ address: release.progression, blockNumber }) ?? '0x') !== release.progressionCodeHash)
      throw Error('HOLDER_CREDIT_RUNTIME_CHANGED');
    const burnCredits = await client.readContract({ address: release.progression, abi: ABI,
      functionName: 'trainingCredits', args: [BigInt(source.selection.sourceTokenId)], blockNumber });
    if (typeof burnCredits !== 'bigint' || burnCredits < 0n) throw Error('HOLDER_CREDITS_UNKNOWN');
    const paid = await paidReader({ client, release, owner: source.selection.owner,
      tokenId: source.selection.sourceTokenId, anchor: source.anchor, now });
    if (paid && (typeof paid.purchasedCredits !== 'string' || !/^(0|[1-9][0-9]*)$/.test(paid.purchasedCredits)))
      throw Error('HOLDER_CREDITS_UNKNOWN');
    if ((await client.getBlock({ blockNumber })).hash !== source.anchor.hash) throw Error('HOLDER_SOURCE_REORG');
    return { burnCredits: String(burnCredits), purchasedCredits: paid?.purchasedCredits ?? '0',
      paidLedger: paid ? 'VERIFIED' : 'UNDEPLOYED' };
  }));
  if (JSON.stringify(observations[0]) !== JSON.stringify(observations[1])) throw Error('HOLDER_CREDIT_PROVIDERS_DISAGREE');
  return { ...observations[0], status: 'VERIFIED', anchor: source.anchor,
    clear: observations[0].burnCredits === '0' && observations[0].purchasedCredits === '0' };
}
