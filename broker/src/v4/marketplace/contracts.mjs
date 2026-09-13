// These interfaces are deliberately separate from free-mint session authority.
import { parseAbi } from 'viem';
export const MARKETPLACE_REVIEW_SCHEMA = 'GOGH_MARKETPLACE_REVIEW_V1';
export const MARKETPLACE_ACTIONS = Object.freeze(['BUY_LISTINGS', 'CREATE_WETH_BID', 'CANCEL_WETH_BID']);
export const MARKETPLACE_LIMITS = Object.freeze({ chainId: 4663, maxListings: 5, reviewSeconds: 60, maxBidSeconds: 86400 });
export const MARKETPLACE_PINS = Object.freeze({
  chainId: 4663,
  collection: '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6',
  seaport: '0x0000000000000068f116a894984e2db1123eb395',
  seaportCodeHash: '0x95809b70c9659c30188db5fdd87103e24b1a55379af8c851fca393aba0224a00',
  weth: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
  wethCodeHash: '0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353',
  registry: '0x3253adc3bbd5b0010c1bf9ce8def26b7e0db5844',
  registryCodeHash: '0x5a1001edb812b6ec2e233cbba6db4b7c680d0832453927696cf1ef623fff8e22',
  implementation: '0xfdb26c2ec70956227728414ff4ab7a5eda64d13b',
  implementationCodeHash: '0x7d37d360014ce94902655062605b8318581097df100ab2573be52904afa6badc',
});
export const OFFER_ITEM = '(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)';
export const CONSIDERATION_ITEM = '(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)';
export const ORDER_PARAMETERS = `(address offerer,address zone,${OFFER_ITEM}[] offer,${CONSIDERATION_ITEM}[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 totalOriginalConsiderationItems)`;
export const ORDER_COMPONENTS = `(address offerer,address zone,${OFFER_ITEM}[] offer,${CONSIDERATION_ITEM}[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 counter)`;
export const SEAPORT_ABI = parseAbi([
  `function fulfillAdvancedOrder((${ORDER_PARAMETERS} parameters,uint120 numerator,uint120 denominator,bytes signature,bytes extraData) advancedOrder,(uint256 orderIndex,uint8 side,uint256 index,uint256 identifier,bytes32[] criteriaProof)[] criteriaResolvers,bytes32 fulfillerConduitKey,address recipient) payable returns(bool fulfilled)`,
  `function getOrderHash(${ORDER_COMPONENTS} order) view returns(bytes32)`,
  'function getCounter(address offerer) view returns(uint256)',
  'function getOrderStatus(bytes32 orderHash) view returns(bool isValidated,bool isCancelled,uint256 totalFilled,uint256 totalSize)',
  'function information() view returns(string version,bytes32 domainSeparator,address conduitController)',
  `function cancel(${ORDER_COMPONENTS}[] orders) returns(bool cancelled)`,
]);
export const ACCOUNT_ABI = parseAbi([
  'function execute(address to,uint256 value,bytes data,uint8 operation) payable returns(bytes result)',
  'function executeBatch((address to,uint256 value,bytes data)[] calls) payable returns(bytes[] results)',
  'function owner() view returns(address)', 'function token() view returns(uint256,address,uint256)',
  'function state() view returns(uint256)', 'function account(uint256 tokenId) view returns(address)',
  'function ownerOf(uint256 tokenId) view returns(address)',
]);
export const MARKETPLACE_BID_ABI = parseAbi([
  'function createBid(uint256 punkId,address collection,uint256 tokenId,bool anyToken,uint256 priceWei,uint48 deadline,uint256 expectedNonce,bytes32 collectionCodeHash) payable returns(bytes32 orderHash)',
  'function cancelBid(bytes32 orderHash)', 'function settleBid(bytes32 orderHash)',
  'function nonces(address) view returns(uint256)',
  'function bids(bytes32) view returns(address funder,address recipient,address collection,uint256 punkId,uint256 tokenId,uint256 priceWei,uint256 salt,uint256 counter,uint48 createdAt,uint48 deadline,bool anyToken,bytes32 collectionCodeHash,bytes32 recipientCodeHash,uint8 status)',
  'function isValidSignature(bytes32 digest,bytes signature) view returns(bytes4)',
]);

export const MARKETPLACE_GUARD_ABI = parseAbi(['function assertPurchase(uint256 punkId,address expectedOwner,uint256 expectedAccountState,address collection,bytes32 collectionCodeHash,uint256[] tokenIds,uint256 minimumReserveWei,uint256 deadline) view', 'function registry() view returns(address)', 'function registryCodeHash() view returns(bytes32)']);
export const MARKETPLACE_EVENTS_ABI = parseAbi([
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
  'event OrderFulfilled(bytes32 orderHash,address indexed offerer,address indexed zone,address recipient,(uint8 itemType,address token,uint256 identifier,uint256 amount)[] offer,(uint8 itemType,address token,uint256 identifier,uint256 amount,address recipient)[] consideration)',
  'event BidCreated(bytes32 indexed orderHash,uint256 indexed punkId,address indexed funder,address recipient,address collection,uint256 tokenId,bool anyToken,uint256 priceWei,uint48 deadline)',
  'event BidCancelled(bytes32 indexed orderHash,address indexed funder,uint256 refundedWeth)',
  'event BidSettled(bytes32 indexed orderHash)',
]);
