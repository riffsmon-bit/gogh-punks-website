import { normalizeV2Opportunity } from '../../broker/src/v4/opportunity.mjs';
export const OWNER = `0x${'1'.repeat(40)}`, OTHER = `0x${'2'.repeat(40)}`;
export const COLLECTION = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6';
export const NOW = Date.parse('2026-09-14T00:00:01Z');
export const hash = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
export const watchConfig = (overrides = {}) => ({ schema: 'GOGH_PERSISTENT_WATCH_CONFIG_V1', likes: ['pixel'], dislikes: ['anime'],
  maximumSupply: 2000, requireWebsite: true, requireX: true, freeOnly: true, maxMintPriceWei: '0',
  maxGasWei: '100', reserveWei: '1000', dailySpendWei: '1000', dailyCollectionLimit: 3, expiresAt: null, ...overrides });
export const anchor = (overrides = {}) => ({ tokenId: '93', owner: OWNER, blockNumber: '100', blockHash: hash(100), checkedAt: NOW, ...overrides });
export const watch = (overrides = {}) => ({ tokenId: '93', owner: OWNER, version: 1, state: 'ACTIVE', config: watchConfig(), anchor: anchor(), ...overrides });
export const economics = (overrides = {}) => ({ verified: true, balanceWei: '10000', reserveWei: '1000', sessionActive: true,
  sessionExpiresAt: NOW + 60000, remainingMints: 2, skillVerified: true, mintHunterEquipped: true,
  globalExecutionPaused: false, usageVerified: true, pendingSpendWei: '0', utcDay: '2026-09-14', spentTodayWei: '0', collectedToday: 0, ...overrides });
export const opportunity = (overrides = {}) => normalizeV2Opportunity({ schema: 'GOGH_NORMALIZED_OPPORTUNITY_V2', version: 2,
  chainId: 4663, opportunityId: 'opportunity_123', collectionContract: `0x${'3'.repeat(40)}`,
  mintContract: `0x${'4'.repeat(40)}`, adapter: `0x${'5'.repeat(40)}`, mintStage: 'PUBLIC', mintMethod: 'mint(uint256)',
  priceWei: '0', estimatedGasCostWei: '10', supply: 777, walletLimit: 1, startTime: null, endTime: null,
  website: 'https://example.com/', socialUrls: { x: 'https://x.com/example', discord: null, farcaster: null },
  sourceUrls: ['https://example.com/mint'], artStyles: ['pixel'], imageReference: null, collectionName: 'Pixel Test',
  contractCodeHash: hash(200), adapterCodeHash: hash(201), screeningStatus: 'PASSED', simulationStatus: 'UNAVAILABLE',
  riskLevel: 'LOW', riskScore: 5, expectedNftReceiver: null, unexpectedApprovals: false, unexpectedTransfers: false,
  createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(), ...overrides });
export const browserIdentity = (overrides = {}) => ({ chainId: 4663, context: 'PRODUCTION', tokenId: '93', owner: OWNER, sessionVersion: 1, ...overrides });
