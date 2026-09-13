// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface IMarketplaceGuardRegistry {
    function account(uint256 punkId) external view returns (address);
}

interface IMarketplaceGuardPunk {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IMarketplaceGuardAccount {
    function state() external view returns (uint256);
    function owner() external view returns (address);
}

/// @notice Last call in one current-owner Punk Wallet purchase batch.
/// @dev No custody, configuration mutation or authority. A failure reverts the
///      entire account batch, including earlier Seaport transfers and payment.
contract GoghPunkMarketplaceGuard {
    address public constant PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    IMarketplaceGuardRegistry public immutable registry;
    bytes32 public immutable registryCodeHash;
    error InvalidPurchasePostcondition();

    constructor(address registry_) {
        if (block.chainid != 4663 || registry_.code.length == 0) {
            revert InvalidPurchasePostcondition();
        }
        registry = IMarketplaceGuardRegistry(registry_);
        registryCodeHash = registry_.codehash;
    }

    function assertPurchase(
        uint256 punkId,
        address expectedOwner,
        uint256 expectedAccountState,
        address collection,
        bytes32 collectionCodeHash,
        uint256[] calldata tokenIds,
        uint256 minimumReserveWei,
        uint256 deadline
    ) external view {
        if (
            block.chainid != 4663 || block.timestamp > deadline
                || address(registry).codehash != registryCodeHash
                || msg.sender != registry.account(punkId) || expectedOwner == address(0)
                || IMarketplaceGuardPunk(PUNKS).ownerOf(punkId) != expectedOwner
                || IMarketplaceGuardAccount(msg.sender).owner() != expectedOwner
                || IMarketplaceGuardAccount(msg.sender).state() != expectedAccountState
                || msg.sender.balance < minimumReserveWei || tokenIds.length == 0
                || tokenIds.length > 5 || collection == PUNKS || collection.code.length == 0
                || collection.codehash != collectionCodeHash
        ) revert InvalidPurchasePostcondition();
        for (uint256 i; i < tokenIds.length; ++i) {
            if (IMarketplaceGuardPunk(collection).ownerOf(tokenIds[i]) != msg.sender) {
                revert InvalidPurchasePostcondition();
            }
            for (uint256 j; j < i; ++j) {
                if (tokenIds[i] == tokenIds[j]) revert InvalidPurchasePostcondition();
            }
        }
    }
}
