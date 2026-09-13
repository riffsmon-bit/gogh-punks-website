import test from 'node:test';
import assert from 'node:assert/strict';
import { linkFindings } from '../site/broker-v2-link-findings.js';
const contract = '0xb73f1d1aee57410d537d87b656e98b9d3df5b213';
const sample = () => ({ link: { kind: 'ROBINHOOD_CONTRACT', identity: contract }, evidence: {
  chainId: 4663, source: 'ROBINHOOD_MAINNET_RPC', contract,
  anchor: { canonicalRechecked: true, blockNumber: '100', blockHash: '0x' + 'a'.repeat(64) },
  contractInspection: { codeHash: '0x' + 'b'.repeat(64), codeBytes: 45, chainId: 4663, contract,
    blockNumber: '100', blockHash: '0x' + 'a'.repeat(64) },
  walletAuthority: 'NONE', executionAuthorized: false,
  mint: { status: 'OBSERVED', standard: 'SEADROP_PUBLIC', priceWei: '1', publicWindow: 'OPEN',
    walletLimit: '1', totalMinted: '1599', maxSupply: '2000' },
} });
test('link card preserves a one-wei mint price and never calls an observation safe or simulated', () => {
  const card = linkFindings(sample());
  assert.ok(card.rows.some(([key, value]) => key === 'Mint price' && value === '0.000000000000000001 ETH'));
  assert.deepEqual(card.rows.slice(-2), [['Security', 'Full review still needed'], ['Simulation', 'Not run']]);
  assert.match(card.summary, /fresh safety review, simulation and your approval/);
  assert.equal(card.contractUrl, `https://robinhoodchain.blockscout.com/address/${contract}`);
});
test('missing, wrong-chain, stale and mismatched contract evidence cannot produce an observed card', () => {
  assert.equal(linkFindings({ link: sample().link }), null);
  for (const edit of [s => s.evidence.chainId = 1, s => s.evidence.contract = '0x' + 'f'.repeat(40),
    s => s.evidence.contract = 3, s => s.evidence.contract = {}, s => s.status = 'BLOCKED',
    s => s.evidence.contractInspection = null, s => s.evidence.contractInspection.codeBytes = 0,
    s => s.evidence.anchor.canonicalRechecked = false, s => s.evidence.anchor.blockHash = 'bad',
    s => s.evidence.walletAuthority = 'SIGN', s => s.evidence.executionAuthorized = true,
    s => s.link.identity = 'javascript:alert(1)']) {
    const value = sample(); edit(value); assert.equal(linkFindings(value), null);
  }
});
test('unknown and invalid prices never look free; only exact verified zero is free', () => {
  for (const price of [null, 0, 1e20, '01', '-1', 'not known', (1n << 256n).toString()]) {
    const value = sample(); value.evidence.mint.priceWei = price;
    const card = linkFindings(value); assert.ok(!card.rows.some(([key]) => key === 'Mint price'));
    assert.match(card.rows.find(([key]) => key === 'Mint details')[1], /Not available/);
  }
  const value = sample(); value.evidence.mint.priceWei = '0';
  assert.deepEqual(linkFindings(value).rows.find(([key]) => key === 'Mint price'), ['Mint price', 'Free']);
});
