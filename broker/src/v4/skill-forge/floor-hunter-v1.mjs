import { createHash } from 'node:crypto';
import { createMarketReaderV2 } from './market-reader-v2.mjs';

// This skill ranks observed orders. The name does not establish a collection floor.
export function createFloorHunterV1(options) {
  const market = createMarketReaderV2(options);
  return Object.freeze({
    async rankObservedListings({ slug, contract, limit = 20 }) {
      const observation = await market.getListings({ slug, contract, limit });
      const groups = new Map();
      for (const listing of observation.listings) {
        const asset = listing.paymentToken;
        const key = `${asset.chainId}:${asset.address}:${asset.decimals}`;
        if (!groups.has(key)) groups.set(key, { paymentToken: asset, listings: [] });
        groups.get(key).listings.push(listing);
      }
      const rankedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => {
        group.listings.sort((a, b) => {
          const left = BigInt(a.price.totalAmount), right = BigInt(b.price.totalAmount);
          return left < right ? -1 : left > right ? 1 : a.orderHash.localeCompare(b.orderHash);
        });
        const minimum = group.listings[0].price.totalAmount;
        return { paymentToken: group.paymentToken, observedMinimumTotalAmount: minimum,
          listings: group.listings.map((listing, index) => ({ ...listing, observedRank: index + 1,
            premiumOverObservedMinimumAmount: (BigInt(listing.price.totalAmount) - BigInt(minimum)).toString() })) };
      });
      const report = { schema: 'GOGH_OBSERVED_LISTING_RANKS_V1', chainId: observation.chainId,
        slug: observation.slug, contract: observation.contract, name: observation.name,
        identityVerified: observation.identityVerified, source: observation.source,
        observationStartedAt: observation.observationStartedAt, observedAt: observation.observedAt,
        coverage: observation.coverage, rankedGroups,
        rankingBasis: 'EXACT_TOTAL_AMOUNT_WITHIN_IDENTICAL_PAYMENT_ASSET',
        referenceBasis: 'MINIMUM_OF_RETURNED_SUPPORTED_ORDERS_ONLY',
        collectionFloorVerified: false, collectionFloor: null, currencyConversionApplied: false,
        walletAuthority: 'NONE', executable: false,
        limitations: [...observation.limitations, 'NO_CROSS_CURRENCY_COMPARISON',
          'MULTIPLE_ORDERS_FOR_ONE_TOKEN_MAY_APPEAR', 'NO_LIQUIDITY_OR_FAIR_VALUE_ESTIMATE'],
        warning: 'A bounded sample minimum is not a collection floor or an executable quote. No purchase is authorized.' };
      return { ...report, evidenceHash: createHash('sha256').update(JSON.stringify(report)).digest('hex') };
    },
  });
}
