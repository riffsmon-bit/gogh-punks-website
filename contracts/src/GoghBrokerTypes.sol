// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @notice Shared strongly typed data for the Gogh Punks Art Broker protocol.
library GoghBrokerTypes {
    enum BrokerMode {
        DISABLED,
        SCOUT,
        APPROVAL_REQUIRED,
        AUTONOMOUS
    }

    enum OpportunityType {
        MINT,
        SECONDARY_BUY,
        FREE_MINT,
        EDITION,
        ONE_OF_ONE,
        AUCTION,
        ALLOWLIST_MINT,
        COLLECTION_DROP
    }

    enum AdapterKind {
        MARKETPLACE,
        MINT
    }

    enum AssetStandard {
        ERC721,
        ERC1155
    }

    /// @dev All fields are bound into the account's EIP-712 digest.
    struct AcquisitionIntent {
        address account;
        uint256 chainId;
        address expectedOwner;
        uint256 nonce;
        uint64 policyVersion;
        OpportunityType opportunityType;
        AssetStandard assetStandard;
        address adapter;
        address venue;
        address collection;
        uint256 tokenId;
        uint256 assetAmount;
        address currency;
        uint256 expectedPrice;
        uint256 maxPrice;
        uint16 maxSlippageBps;
        uint64 createdAt;
        uint64 expiresAt;
        bytes32 opportunityId;
        bytes32 reasoningHash;
        bytes32 adapterCodeHash;
    }

    /// @dev Returned by a registered deterministic adapter. The account executes exactly this call.
    struct AdapterExecution {
        address target;
        uint256 value;
        address currency;
        address allowanceSpender;
        uint256 allowanceAmount;
        uint256 paymentAmount;
        bytes callData;
    }

    struct PolicyConfig {
        BrokerMode mode;
        uint256 maxSpendPerTransaction;
        uint256 maxSpendPerDay;
        uint256 maxSpendPerWeek;
        uint256 maxMintPrice;
        uint256 maxSecondaryPurchasePrice;
        uint256 minimumNativeReserve;
        uint32 maxAcquisitionsPerDay;
        uint32 maxIntentAge;
        uint16 maxSlippageBps;
        bool requireCollectionAllowlist;
        bool allowUnknownCollections;
    }

    struct FeatureFlags {
        bool scoutMode;
        bool approvalPurchases;
        bool autonomousPurchases;
        bool autonomousMints;
        bool unknownCollectionExecution;
        bool selling;
        bool autonomousSelling;
    }
}
