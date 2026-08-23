// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghBrokerTypes } from "../GoghBrokerTypes.sol";
import { IGoghMarketplaceAdapter } from "../interfaces/IGoghMarketplaceAdapter.sol";
import { IOpenSeaSeaDrop, IOpenSeaSeaDropCollection } from "./OpenSeaSeaDropFreeMintAdapter.sol";

/// @title AutomatedSeaDropFreeMintAdapter
/// @notice Reusable adapter for canonical zero-value OpenSea SeaDrop ERC-721 clones.
/// @dev The collection is selected by the typed intent, but it must be the exact canonical
///      EIP-1167 clone runtime pinned here. No opaque data, payment, approval, alternate venue,
///      alternate recipient, or quantity other than one can enter the execution.
contract AutomatedSeaDropFreeMintAdapter is IGoghMarketplaceAdapter {
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    address public constant SEA_DROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;
    address public constant OPEN_SEA_FEE_RECIPIENT = 0x0000a26b00c1F0DF003000390027140000fAa719;
    address public constant CLONE_IMPLEMENTATION = 0x09a26fC8FCEF18192E267D7A6da9dFb4be81Dd6A;

    bytes32 public immutable expectedSeaDropCodeHash;
    bytes32 public immutable expectedCloneImplementationCodeHash;
    bytes32 public immutable expectedCollectionRuntimeCodeHash;

    error InvalidPinnedContract(address target);
    error InvalidPinnedHash(address target, bytes32 expected, bytes32 actual);
    error InvalidCloneRuntime(address target, bytes32 actual);
    error WrongChain(uint256 supplied);
    error WrongAdapter(address supplied);
    error WrongVenue(address supplied);
    error WrongAccount(address supplied);
    error WrongAssetStandard(GoghBrokerTypes.AssetStandard supplied);
    error UnsupportedOpportunityType(GoghBrokerTypes.OpportunityType supplied);
    error InvalidAssetAmount(uint256 supplied);
    error NonNativeCurrency(address supplied);
    error NonZeroIntentPrice(uint256 expectedPrice, uint256 maxPrice);
    error NonZeroSlippage(uint16 supplied);
    error UnsupportedAdapterData(uint256 length);
    error AdapterCodeHashMismatch(bytes32 supplied, bytes32 actual);
    error PublicDropNotFree(uint256 mintPrice);
    error PublicDropNotActive(uint256 currentTime, uint256 startTime, uint256 endTime);
    error WalletMintLimitReached(uint256 minted, uint256 limit);
    error CollectionSoldOut(uint256 totalMinted, uint256 maxSupply);
    error WrongNextTokenId(uint256 supplied, uint256 expected);
    error FeeRecipientNotAllowed();

    constructor(bytes32 seaDropCodeHash_, bytes32 cloneImplementationCodeHash_) {
        if (SEA_DROP.code.length == 0) revert InvalidPinnedContract(SEA_DROP);
        if (CLONE_IMPLEMENTATION.code.length == 0) {
            revert InvalidPinnedContract(CLONE_IMPLEMENTATION);
        }
        _requireCodeHash(SEA_DROP, seaDropCodeHash_);
        _requireCodeHash(CLONE_IMPLEMENTATION, cloneImplementationCodeHash_);
        expectedSeaDropCodeHash = seaDropCodeHash_;
        expectedCloneImplementationCodeHash = cloneImplementationCodeHash_;
        expectedCollectionRuntimeCodeHash = keccak256(_canonicalCloneRuntime());
    }

    function kind() external pure override returns (GoghBrokerTypes.AdapterKind) {
        return GoghBrokerTypes.AdapterKind.MINT;
    }

    function venue() external pure override returns (address) {
        return SEA_DROP;
    }

    function buildExecution(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        bytes calldata adapterData
    ) external view override returns (GoghBrokerTypes.AdapterExecution memory execution) {
        _validateIntent(intent, adapterData);
        _validatePinnedInfrastructure();
        _requireCanonicalCollection(intent.collection);

        IOpenSeaSeaDrop.PublicDrop memory drop =
            IOpenSeaSeaDrop(SEA_DROP).getPublicDrop(intent.collection);
        if (drop.mintPrice != 0) revert PublicDropNotFree(drop.mintPrice);
        if (block.timestamp < drop.startTime || block.timestamp > drop.endTime) {
            revert PublicDropNotActive(block.timestamp, drop.startTime, drop.endTime);
        }

        (uint256 minterMinted, uint256 currentTotalMinted, uint256 maxSupply) =
            IOpenSeaSeaDropCollection(intent.collection).getMintStats(intent.account);
        if (drop.maxTotalMintableByWallet == 0 || minterMinted >= drop.maxTotalMintableByWallet) {
            revert WalletMintLimitReached(minterMinted, drop.maxTotalMintableByWallet);
        }
        if (currentTotalMinted >= maxSupply) {
            revert CollectionSoldOut(currentTotalMinted, maxSupply);
        }

        uint256 expectedTokenId = currentTotalMinted + 1;
        if (intent.tokenId != expectedTokenId) {
            revert WrongNextTokenId(intent.tokenId, expectedTokenId);
        }
        if (
            drop.restrictFeeRecipients
                && !IOpenSeaSeaDrop(SEA_DROP)
                    .getFeeRecipientIsAllowed(intent.collection, OPEN_SEA_FEE_RECIPIENT)
        ) revert FeeRecipientNotAllowed();

        execution.target = SEA_DROP;
        execution.callData = abi.encodeCall(
            IOpenSeaSeaDrop.mintPublic,
            (intent.collection, OPEN_SEA_FEE_RECIPIENT, address(0), uint256(1))
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
        if (intent.venue != SEA_DROP) revert WrongVenue(intent.venue);
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
        _requireCodeHash(SEA_DROP, expectedSeaDropCodeHash);
        _requireCodeHash(CLONE_IMPLEMENTATION, expectedCloneImplementationCodeHash);
    }

    function _requireCanonicalCollection(address collection) private view {
        bytes32 actual = collection.codehash;
        if (collection.code.length != 45 || actual != expectedCollectionRuntimeCodeHash) {
            revert InvalidCloneRuntime(collection, actual);
        }
    }

    function _canonicalCloneRuntime() private pure returns (bytes memory) {
        return abi.encodePacked(
            hex"363d3d373d3d3d363d73", CLONE_IMPLEMENTATION, hex"5af43d82803e903d91602b57fd5bf3"
        );
    }

    function _requireCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (expected == bytes32(0) || actual != expected) {
            revert InvalidPinnedHash(target, expected, actual);
        }
    }
}
