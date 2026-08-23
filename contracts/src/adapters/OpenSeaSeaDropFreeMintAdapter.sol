// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghBrokerTypes } from "../GoghBrokerTypes.sol";
import { IGoghMarketplaceAdapter } from "../interfaces/IGoghMarketplaceAdapter.sol";

interface IOpenSeaSeaDrop {
    struct PublicDrop {
        uint80 mintPrice;
        uint48 startTime;
        uint48 endTime;
        uint16 maxTotalMintableByWallet;
        uint16 feeBps;
        bool restrictFeeRecipients;
    }

    function mintPublic(
        address nftContract,
        address feeRecipient,
        address minterIfNotPayer,
        uint256 quantity
    ) external payable;

    function getPublicDrop(address nftContract) external view returns (PublicDrop memory);

    function getFeeRecipientIsAllowed(address nftContract, address feeRecipient)
        external
        view
        returns (bool);
}

interface IOpenSeaSeaDropCollection {
    function getMintStats(address minter)
        external
        view
        returns (uint256 minterNumMinted, uint256 currentTotalMinted, uint256 maxSupply);
}

/// @title OpenSeaSeaDropFreeMintAdapter
/// @notice One-collection, one-account adapter for a zero-value public SeaDrop ERC-721 mint.
/// @dev The deployed instance is permanently bound to one collection and one Punk Account. It
///      accepts no opaque adapter data, no payment, no allowance, and no caller-selected venue or
///      recipient. The next ERC721SeaDropCloneable token ID is derived from `_totalMinted()` in the
///      same transaction in which the account executes the returned call.
contract OpenSeaSeaDropFreeMintAdapter is IGoghMarketplaceAdapter {
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    address public constant SEA_DROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;
    address public constant OPEN_SEA_FEE_RECIPIENT = 0x0000a26b00c1F0DF003000390027140000fAa719;
    address public constant CLONE_IMPLEMENTATION = 0x09a26fC8FCEF18192E267D7A6da9dFb4be81Dd6A;

    address public immutable collection;
    address public immutable boundAccount;
    bytes32 public immutable expectedSeaDropCodeHash;
    bytes32 public immutable expectedCollectionCodeHash;
    bytes32 public immutable expectedImplementationCodeHash;

    error ZeroAddress();
    error InvalidPinnedContract(address target);
    error InvalidCloneRuntime(address target);
    error CodeHashMismatch(address target, bytes32 expected, bytes32 actual);
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
    error AdapterCodeHashMismatch(bytes32 expected, bytes32 actual);
    error PublicDropNotFree(uint256 mintPrice);
    error PublicDropNotActive(uint256 currentTime, uint256 startTime, uint256 endTime);
    error WalletMintLimitReached(uint256 minted, uint256 limit);
    error CollectionSoldOut(uint256 totalMinted, uint256 maxSupply);
    error WrongNextTokenId(uint256 supplied, uint256 expected);
    error FeeRecipientNotAllowed();

    constructor(
        address collection_,
        address boundAccount_,
        bytes32 expectedSeaDropCodeHash_,
        bytes32 expectedCollectionCodeHash_,
        bytes32 expectedImplementationCodeHash_
    ) {
        if (collection_ == address(0) || boundAccount_ == address(0)) revert ZeroAddress();
        if (collection_.code.length == 0) revert InvalidPinnedContract(collection_);
        if (boundAccount_.code.length == 0) revert InvalidPinnedContract(boundAccount_);
        if (SEA_DROP.code.length == 0) revert InvalidPinnedContract(SEA_DROP);
        if (CLONE_IMPLEMENTATION.code.length == 0) {
            revert InvalidPinnedContract(CLONE_IMPLEMENTATION);
        }
        _requireCanonicalClone(collection_);
        _requireCodeHash(SEA_DROP, expectedSeaDropCodeHash_);
        _requireCodeHash(collection_, expectedCollectionCodeHash_);
        _requireCodeHash(CLONE_IMPLEMENTATION, expectedImplementationCodeHash_);

        collection = collection_;
        boundAccount = boundAccount_;
        expectedSeaDropCodeHash = expectedSeaDropCodeHash_;
        expectedCollectionCodeHash = expectedCollectionCodeHash_;
        expectedImplementationCodeHash = expectedImplementationCodeHash_;
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
        _validatePinnedCode();

        IOpenSeaSeaDrop.PublicDrop memory drop = IOpenSeaSeaDrop(SEA_DROP).getPublicDrop(collection);
        if (drop.mintPrice != 0) revert PublicDropNotFree(drop.mintPrice);
        if (block.timestamp < drop.startTime || block.timestamp > drop.endTime) {
            revert PublicDropNotActive(block.timestamp, drop.startTime, drop.endTime);
        }

        (uint256 minterMinted, uint256 currentTotalMinted, uint256 maxSupply) =
            IOpenSeaSeaDropCollection(collection).getMintStats(boundAccount);
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
        if (!IOpenSeaSeaDrop(SEA_DROP).getFeeRecipientIsAllowed(collection, OPEN_SEA_FEE_RECIPIENT))
        {
            revert FeeRecipientNotAllowed();
        }

        execution.target = SEA_DROP;
        execution.callData = abi.encodeCall(
            IOpenSeaSeaDrop.mintPublic, (collection, OPEN_SEA_FEE_RECIPIENT, address(0), uint256(1))
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
        if (intent.collection != collection) revert WrongCollection(intent.collection);
        if (intent.account != boundAccount) revert WrongAccount(intent.account);
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
        if (intent.adapterCodeHash != address(this).codehash) {
            revert AdapterCodeHashMismatch(intent.adapterCodeHash, address(this).codehash);
        }
    }

    function _validatePinnedCode() private view {
        _requireCodeHash(SEA_DROP, expectedSeaDropCodeHash);
        _requireCodeHash(collection, expectedCollectionCodeHash);
        _requireCodeHash(CLONE_IMPLEMENTATION, expectedImplementationCodeHash);
    }

    function _requireCanonicalClone(address target) private view {
        bytes memory expectedRuntime = abi.encodePacked(
            hex"363d3d373d3d3d363d73", CLONE_IMPLEMENTATION, hex"5af43d82803e903d91602b57fd5bf3"
        );
        if (
            target.code.length != expectedRuntime.length
                || target.codehash != keccak256(expectedRuntime)
        ) {
            revert InvalidCloneRuntime(target);
        }
    }

    function _requireCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (expected == bytes32(0) || actual != expected) {
            revert CodeHashMismatch(target, expected, actual);
        }
    }
}
