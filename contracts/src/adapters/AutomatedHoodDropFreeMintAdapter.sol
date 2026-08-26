// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghBrokerTypes } from "../GoghBrokerTypes.sol";
import { IGoghMarketplaceAdapter } from "../interfaces/IGoghMarketplaceAdapter.sol";

interface IHoodDropControllerV2 {
    function currentRoundId(address token) external view returns (uint256);

    function rounds(address token, uint256 roundId)
        external
        view
        returns (
            uint256 maxTokenSupplyForRound,
            address payoutAddress,
            uint32 stageCount,
            bool exists,
            bool active,
            bool paused
        );

    function stages(address token, uint256 roundId, uint32 stageId)
        external
        view
        returns (
            uint64 startTime,
            uint64 endTime,
            uint32 maxPerWallet,
            uint96 mintPrice,
            bytes32 merkleRoot,
            bool allowlist,
            bool exists
        );

    function mintedByWallet(address token, uint256 roundId, address minter)
        external
        view
        returns (uint256);

    function mint(
        address token,
        uint256 roundId,
        uint32 stageId,
        uint256 quantity,
        bytes32[] calldata proof
    ) external payable;
}

interface IHoodDropCollection {
    function getMintStats(address minter)
        external
        view
        returns (uint256 minterNumMinted, uint256 currentTotalSupply, uint256 maxSupply);
}

/// @title AutomatedHoodDropFreeMintAdapter
/// @notice One-collection, one-round, one-stage free-mint adapter for HoodMarket HoodDrop V2.
/// @dev The adapter binds the verified non-upgradeable HoodDrop V2 controller, the exact target
///      collection runtime, and one reviewed public stage. It reconstructs the only supported call
///      and never accepts marketplace calldata, Merkle proofs, payment, approvals, or quantity > 1.
contract AutomatedHoodDropFreeMintAdapter is IGoghMarketplaceAdapter {
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    address public constant HOOD_DROP_CONTROLLER = 0x26B10b0c7C0f794375593f00222Fd960faC22F16;
    bytes32 public constant EXPECTED_CONTROLLER_CODE_HASH =
        0x722dc2f13ebf38431d43e12e0b1994060ec3ab14ecf45af5617d5d1ca2ca4fce;

    address public immutable collection;
    uint256 public immutable roundId;
    uint32 public immutable stageId;
    bytes32 public immutable expectedControllerRuntimeCodeHash;
    bytes32 public immutable expectedCollectionRuntimeCodeHash;

    error InvalidPinnedContract(address target);
    error InvalidPinnedHash(address target, bytes32 expected, bytes32 actual);
    error UnexpectedProductionControllerHash(bytes32 supplied);
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
    error RoundNotActive(uint256 currentRoundId, uint256 expectedRoundId);
    error RoundPaused();
    error StageNotPublic();
    error StageNotFree(uint256 mintPrice);
    error StageNotActive(uint256 currentTime, uint256 startTime, uint256 endTime);
    error WalletMintLimitReached(uint256 minted, uint256 limit);
    error RoundSoldOut(uint256 totalSupply, uint256 roundMaximum);
    error CollectionSoldOut(uint256 totalSupply, uint256 collectionMaximum);
    error InvalidCollectionState(uint256 minterMinted, uint256 totalSupply, uint256 maximum);
    error WrongNextTokenId(uint256 supplied, uint256 expected);

    constructor(
        address collection_,
        uint256 roundId_,
        uint32 stageId_,
        bytes32 controllerCodeHash_,
        bytes32 collectionRuntimeCodeHash_
    ) {
        if (collection_ == address(0) || collection_.code.length == 0) {
            revert InvalidPinnedContract(collection_);
        }
        if (HOOD_DROP_CONTROLLER.code.length == 0) {
            revert InvalidPinnedContract(HOOD_DROP_CONTROLLER);
        }
        if (
            block.chainid == ROBINHOOD_CHAIN_ID
                && controllerCodeHash_ != EXPECTED_CONTROLLER_CODE_HASH
        ) revert UnexpectedProductionControllerHash(controllerCodeHash_);
        _requireCodeHash(HOOD_DROP_CONTROLLER, controllerCodeHash_);
        _requireCodeHash(collection_, collectionRuntimeCodeHash_);
        collection = collection_;
        roundId = roundId_;
        stageId = stageId_;
        expectedControllerRuntimeCodeHash = controllerCodeHash_;
        expectedCollectionRuntimeCodeHash = collectionRuntimeCodeHash_;
    }

    function kind() external pure override returns (GoghBrokerTypes.AdapterKind) {
        return GoghBrokerTypes.AdapterKind.MINT;
    }

    function venue() external pure override returns (address) {
        return HOOD_DROP_CONTROLLER;
    }

    function buildExecution(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        bytes calldata adapterData
    ) external view override returns (GoghBrokerTypes.AdapterExecution memory execution) {
        _validateIntent(intent, adapterData);
        _validatePinnedInfrastructure();

        IHoodDropControllerV2 controller = IHoodDropControllerV2(HOOD_DROP_CONTROLLER);
        uint256 activeRoundId = controller.currentRoundId(collection);
        (uint256 roundMaximum,,, bool roundExists, bool roundActive, bool roundPaused) =
            controller.rounds(collection, roundId);
        if (!roundExists || !roundActive || activeRoundId != roundId) {
            revert RoundNotActive(activeRoundId, roundId);
        }
        if (roundPaused) revert RoundPaused();

        (
            uint64 startTime,
            uint64 endTime,
            uint32 maxPerWallet,
            uint96 mintPrice,
            bytes32 merkleRoot,
            bool allowlist,
            bool stageExists
        ) = controller.stages(collection, roundId, stageId);
        if (!stageExists || allowlist || merkleRoot != bytes32(0)) revert StageNotPublic();
        if (mintPrice != 0) revert StageNotFree(mintPrice);
        if (block.timestamp < startTime || (endTime != 0 && block.timestamp >= endTime)) {
            revert StageNotActive(block.timestamp, startTime, endTime);
        }

        uint256 accountMints = controller.mintedByWallet(collection, roundId, intent.account);
        if (maxPerWallet != 0 && accountMints >= maxPerWallet) {
            revert WalletMintLimitReached(accountMints, maxPerWallet);
        }

        (uint256 minterMinted, uint256 currentSupply, uint256 collectionMaximum) =
            IHoodDropCollection(collection).getMintStats(intent.account);
        if (minterMinted > currentSupply || currentSupply > collectionMaximum) {
            revert InvalidCollectionState(minterMinted, currentSupply, collectionMaximum);
        }
        if (currentSupply >= roundMaximum) revert RoundSoldOut(currentSupply, roundMaximum);
        if (currentSupply >= collectionMaximum) {
            revert CollectionSoldOut(currentSupply, collectionMaximum);
        }
        uint256 expectedTokenId = currentSupply + 1;
        if (intent.tokenId != expectedTokenId) {
            revert WrongNextTokenId(intent.tokenId, expectedTokenId);
        }

        bytes32[] memory emptyProof = new bytes32[](0);
        execution.target = HOOD_DROP_CONTROLLER;
        execution.callData = abi.encodeCall(
            IHoodDropControllerV2.mint, (collection, roundId, stageId, uint256(1), emptyProof)
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
        if (intent.venue != HOOD_DROP_CONTROLLER) revert WrongVenue(intent.venue);
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
        _requireCodeHash(HOOD_DROP_CONTROLLER, expectedControllerRuntimeCodeHash);
        _requireCodeHash(collection, expectedCollectionRuntimeCodeHash);
    }

    function _requireCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (expected == bytes32(0) || actual != expected) {
            revert InvalidPinnedHash(target, expected, actual);
        }
    }
}
