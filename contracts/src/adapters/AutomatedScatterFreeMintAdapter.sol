// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghBrokerTypes } from "../GoghBrokerTypes.sol";
import { IGoghMarketplaceAdapter } from "../interfaces/IGoghMarketplaceAdapter.sol";

interface IScatterArchetypeErc721A {
    struct Auth {
        bytes32 key;
        bytes32[] proof;
    }

    struct ArchetypeAddresses {
        address platform;
        address payouts;
        address batch;
    }

    function archetypeAddresses() external view returns (ArchetypeAddresses memory);

    function config()
        external
        view
        returns (
            string memory baseUri,
            address affiliateSigner,
            uint32 maxSupply,
            uint32 maxBatchSize,
            uint16 affiliateFee,
            uint16 affiliateDiscount,
            uint16 defaultRoyalty
        );

    function invites(bytes32 key)
        external
        view
        returns (
            uint128 price,
            uint128 reservePrice,
            uint128 delta,
            uint32 start,
            uint32 end,
            uint32 limit,
            uint32 maxSupply,
            uint32 interval,
            uint32 unitSize,
            address tokenAddress,
            bool isBlacklist
        );

    function listSupply(bytes32 key) external view returns (uint256);
    function minted(address minter, bytes32 key) external view returns (uint256);
    function packedBonusDiscounts(bytes32 key) external view returns (uint256);
    function totalSupply() external view returns (uint256);

    function mint(Auth calldata auth, uint256 quantity, address affiliate, bytes calldata signature)
        external
        payable;
}

/// @title AutomatedScatterFreeMintAdapter
/// @notice One-collection, one-public-list adapter for a zero-value Scatter ERC-721 mint.
/// @dev The adapter deliberately does not consume Scatter API transaction calldata. It rebuilds
///      the only accepted call from immutable collection/list bindings and current on-chain state.
///      The bound collection must be the exact EIP-1167 clone of the reviewed Archetype ERC-721A
///      implementation. Only Scatter's public invite keys (0 through 255), an empty proof,
///      quantity one, zero affiliate, empty signature, and native price zero are supported.
contract AutomatedScatterFreeMintAdapter is IGoghMarketplaceAdapter {
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    address public constant ARCHETYPE_IMPLEMENTATION = 0xb195891c61c68bd518cbE66f176bed204A222b54;
    bytes32 public constant EXPECTED_IMPLEMENTATION_CODE_HASH =
        0x51f009ed661c60923fea65913c59ee3271ada196bd60a64f2c3f1dda9485e40a;

    address public immutable collection;
    bytes32 public immutable publicInviteKey;
    bytes32 public immutable expectedImplementationCodeHash;
    bytes32 public immutable expectedCollectionRuntimeCodeHash;

    error InvalidPinnedContract(address target);
    error InvalidPinnedHash(address target, bytes32 expected, bytes32 actual);
    error UnexpectedProductionImplementationHash(bytes32 supplied);
    error InvalidCloneRuntime(address target, bytes32 actual);
    error InviteKeyNotPublic(bytes32 key);
    error WrongChain(uint256 supplied);
    error WrongAdapter(address supplied);
    error WrongVenue(address supplied);
    error WrongCollection(address supplied);
    error WrongAccount(address supplied);
    error WrongAssetStandard(GoghBrokerTypes.AssetStandard supplied);
    error UnsupportedOpportunityType(GoghBrokerTypes.OpportunityType supplied);
    error InvalidAssetAmount(uint256 supplied);
    error NonNativeCurrency(address supplied);
    error NonZeroIntentPrice(uint256 expectedPrice, uint256 maxPrice);
    error NonZeroSlippage(uint16 supplied);
    error UnsupportedAdapterData(uint256 length);
    error AdapterCodeHashMismatch(bytes32 supplied, bytes32 actual);
    error InviteNotFree(uint256 price, uint256 reservePrice, uint256 delta, uint256 interval);
    error InviteNotActive(uint256 currentTime, uint256 startTime, uint256 endTime);
    error InvitePaused();
    error InviteNotPlainPublic(address tokenAddress, bool isBlacklist);
    error BonusMintsUnsupported(uint256 packedBonusDiscounts);
    error UnitSizeUnsupported(uint256 unitSize);
    error WalletMintLimitReached(uint256 minted, uint256 limit);
    error ListMaxSupplyReached(uint256 minted, uint256 limit);
    error CollectionSoldOut(uint256 totalSupply, uint256 maxSupply);
    error InvalidCollectionConfiguration(uint256 maxBatchSize);
    error WrongNextTokenId(uint256 supplied, uint256 expected);
    error BatchSenderCollision(address account);

    constructor(address collection_, bytes32 publicInviteKey_, bytes32 implementationCodeHash_) {
        if (collection_ == address(0) || collection_.code.length == 0) {
            revert InvalidPinnedContract(collection_);
        }
        if (ARCHETYPE_IMPLEMENTATION.code.length == 0) {
            revert InvalidPinnedContract(ARCHETYPE_IMPLEMENTATION);
        }
        if (uint256(publicInviteKey_) > 0xff) revert InviteKeyNotPublic(publicInviteKey_);
        if (
            block.chainid == ROBINHOOD_CHAIN_ID
                && implementationCodeHash_ != EXPECTED_IMPLEMENTATION_CODE_HASH
        ) revert UnexpectedProductionImplementationHash(implementationCodeHash_);
        _requireCodeHash(ARCHETYPE_IMPLEMENTATION, implementationCodeHash_);
        bytes32 cloneHash = keccak256(_canonicalCloneRuntime());
        bytes32 actualCollectionHash = collection_.codehash;
        if (collection_.code.length != 45 || actualCollectionHash != cloneHash) {
            revert InvalidCloneRuntime(collection_, actualCollectionHash);
        }
        collection = collection_;
        publicInviteKey = publicInviteKey_;
        expectedImplementationCodeHash = implementationCodeHash_;
        expectedCollectionRuntimeCodeHash = cloneHash;
    }

    function kind() external pure override returns (GoghBrokerTypes.AdapterKind) {
        return GoghBrokerTypes.AdapterKind.MINT;
    }

    function venue() external view override returns (address) {
        return collection;
    }

    function buildExecution(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        bytes calldata adapterData
    ) external view override returns (GoghBrokerTypes.AdapterExecution memory execution) {
        _validateIntent(intent, adapterData);
        _validatePinnedInfrastructure();

        IScatterArchetypeErc721A target = IScatterArchetypeErc721A(collection);
        IScatterArchetypeErc721A.ArchetypeAddresses memory addresses = target.archetypeAddresses();
        if (addresses.batch == intent.account) revert BatchSenderCollision(intent.account);

        (
            uint128 price,
            uint128 reservePrice,
            uint128 delta,
            uint32 start,
            uint32 end,
            uint32 limit,
            uint32 listMaximum,
            uint32 interval,
            uint32 unitSize,
            address tokenAddress,
            bool isBlacklist
        ) = target.invites(publicInviteKey);
        if (price != 0 || reservePrice != 0 || delta != 0 || interval != 0) {
            revert InviteNotFree(price, reservePrice, delta, interval);
        }
        if (limit == 0) revert InvitePaused();
        if (block.timestamp < start || (end > start && block.timestamp > end)) {
            revert InviteNotActive(block.timestamp, start, end);
        }
        if (tokenAddress != address(0) || isBlacklist) {
            revert InviteNotPlainPublic(tokenAddress, isBlacklist);
        }
        if (unitSize != 1) revert UnitSizeUnsupported(unitSize);
        uint256 packedBonus = target.packedBonusDiscounts(publicInviteKey);
        if (packedBonus != 0) revert BonusMintsUnsupported(packedBonus);

        uint256 accountMints = target.minted(intent.account, publicInviteKey);
        if (accountMints >= limit) revert WalletMintLimitReached(accountMints, limit);
        uint256 currentListSupply = target.listSupply(publicInviteKey);
        if (currentListSupply >= listMaximum) {
            revert ListMaxSupplyReached(currentListSupply, listMaximum);
        }

        (,, uint32 collectionMaximum, uint32 maxBatchSize,,,) = target.config();
        if (maxBatchSize == 0) revert InvalidCollectionConfiguration(maxBatchSize);
        uint256 currentTotalSupply = target.totalSupply();
        if (currentTotalSupply >= collectionMaximum) {
            revert CollectionSoldOut(currentTotalSupply, collectionMaximum);
        }
        uint256 expectedTokenId = currentTotalSupply + 1;
        if (intent.tokenId != expectedTokenId) {
            revert WrongNextTokenId(intent.tokenId, expectedTokenId);
        }

        bytes32[] memory emptyProof = new bytes32[](0);
        execution.target = collection;
        execution.callData = abi.encodeCall(
            IScatterArchetypeErc721A.mint,
            (
                IScatterArchetypeErc721A.Auth({ key: publicInviteKey, proof: emptyProof }),
                uint256(1),
                address(0),
                bytes("")
            )
        );
    }

    function _validateIntent(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        bytes calldata adapterData
    ) private view {
        if (intent.chainId != ROBINHOOD_CHAIN_ID) {
            revert WrongChain(intent.chainId);
        }
        if (intent.adapter != address(this)) revert WrongAdapter(intent.adapter);
        if (intent.venue != collection) revert WrongVenue(intent.venue);
        if (intent.collection != collection) revert WrongCollection(intent.collection);
        if (intent.account == address(0) || intent.account.code.length == 0) {
            revert WrongAccount(intent.account);
        }
        if (intent.assetStandard != GoghBrokerTypes.AssetStandard.ERC721) {
            revert WrongAssetStandard(intent.assetStandard);
        }
        if (intent.opportunityType != GoghBrokerTypes.OpportunityType.FREE_MINT) {
            revert UnsupportedOpportunityType(intent.opportunityType);
        }
        if (intent.assetAmount != 1) revert InvalidAssetAmount(intent.assetAmount);
        if (intent.currency != address(0)) revert NonNativeCurrency(intent.currency);
        if (intent.expectedPrice != 0 || intent.maxPrice != 0) {
            revert NonZeroIntentPrice(intent.expectedPrice, intent.maxPrice);
        }
        if (intent.maxSlippageBps != 0) revert NonZeroSlippage(intent.maxSlippageBps);
        if (adapterData.length != 0) revert UnsupportedAdapterData(adapterData.length);
        bytes32 actualAdapterHash = address(this).codehash;
        if (intent.adapterCodeHash != actualAdapterHash) {
            revert AdapterCodeHashMismatch(intent.adapterCodeHash, actualAdapterHash);
        }
    }

    function _validatePinnedInfrastructure() private view {
        _requireCodeHash(ARCHETYPE_IMPLEMENTATION, expectedImplementationCodeHash);
        bytes32 actualCollectionHash = collection.codehash;
        if (
            collection.code.length != 45
                || actualCollectionHash != expectedCollectionRuntimeCodeHash
        ) {
            revert InvalidCloneRuntime(collection, actualCollectionHash);
        }
    }

    function _canonicalCloneRuntime() private pure returns (bytes memory) {
        return abi.encodePacked(
            hex"363d3d373d3d3d363d73", ARCHETYPE_IMPLEMENTATION, hex"5af43d82803e903d91602b57fd5bf3"
        );
    }

    function _requireCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (expected == bytes32(0) || actual != expected) {
            revert InvalidPinnedHash(target, expected, actual);
        }
    }
}
