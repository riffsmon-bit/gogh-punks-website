// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghBrokerTypes } from "../GoghBrokerTypes.sol";
import { IGoghMarketplaceAdapter } from "../interfaces/IGoghMarketplaceAdapter.sol";

/// @title ZeroCostMintAdapterBase
/// @notice Shared fail-closed validation for an exact `mint(address,uint256)`-shaped free mint.
/// @dev A target-specific subclass must construct calldata from compiled, deterministic rules in
///      `_buildFreeMintExecution`. No caller-provided adapter data is accepted by this base. The
///      supported ABI shape is exactly `selector(address recipient,uint256 tokenId)`: 4 selector
///      bytes followed by two canonical 32-byte words. The base requires the recipient to be the
///      Punk Account and the token ID to equal the typed intent.
///
///      This base is intentionally unsuitable for mints that need dynamic Merkle proofs, creator
///      signatures, caller-selected phases, arbitrary multicalls, a recipient in another ABI
///      position, any additional mint argument, an unknown output token ID, more than one token,
///      ERC-20 payment, or native value. A venue with any other signature needs a separate
///      target-specific adapter and security review; it must not weaken this base by forwarding
///      opaque bytes. A subclass must also independently establish that the pinned venue mints the
///      typed token ID and standard from the pinned collection.
///      Registry code-hash checks and proxy implementation monitoring remain separate controls.
///      "Zero cost" describes venue payment only; the transaction submitter still pays gas.
abstract contract ZeroCostMintAdapterBase is IGoghMarketplaceAdapter {
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;

    address public immutable override venue;
    address public immutable collection;
    bytes4 public immutable mintSelector;
    GoghBrokerTypes.AssetStandard public immutable assetStandard;

    error ZeroAddress();
    error InvalidPinnedContract(address target);
    error InvalidPinnedSelector();
    error WrongChain(uint256 supplied);
    error WrongAdapter(address supplied);
    error WrongVenue(address supplied);
    error WrongCollection(address supplied);
    error WrongAssetStandard(GoghBrokerTypes.AssetStandard supplied);
    error UnsupportedOpportunityType(GoghBrokerTypes.OpportunityType supplied);
    error ZeroAccount();
    error InvalidAssetAmount(uint256 supplied);
    error NonNativeCurrency(address supplied);
    error NonZeroIntentPrice(uint256 expectedPrice, uint256 maxPrice);
    error NonZeroSlippage(uint16 supplied);
    error UnsupportedAdapterData(uint256 length);
    error AdapterCodeHashMismatch(bytes32 expected, bytes32 actual);
    error UnsafeExecutionTarget(address supplied);
    error UnsafeExecutionFunds(
        uint256 value,
        address currency,
        address allowanceSpender,
        uint256 allowanceAmount,
        uint256 paymentAmount
    );
    error MalformedMintCalldata(uint256 length);
    error WrongMintSelector(bytes4 supplied);
    error NonCanonicalRecipientEncoding(bytes32 supplied);
    error WrongMintRecipient(address supplied, address expected);
    error WrongMintTokenId(uint256 supplied, uint256 expected);

    constructor(
        address venue_,
        address collection_,
        bytes4 mintSelector_,
        GoghBrokerTypes.AssetStandard assetStandard_
    ) {
        if (venue_ == address(0) || collection_ == address(0)) {
            revert ZeroAddress();
        }
        if (venue_.code.length == 0) revert InvalidPinnedContract(venue_);
        if (collection_.code.length == 0) revert InvalidPinnedContract(collection_);
        if (mintSelector_ == bytes4(0)) revert InvalidPinnedSelector();
        venue = venue_;
        collection = collection_;
        mintSelector = mintSelector_;
        assetStandard = assetStandard_;
    }

    function kind() external pure override returns (GoghBrokerTypes.AdapterKind) {
        return GoghBrokerTypes.AdapterKind.MINT;
    }

    /// @notice Validates one typed free-mint intent and returns only a pinned, zero-value call.
    /// @dev The subclass output is treated as untrusted and revalidated before it is returned.
    function buildExecution(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        bytes calldata adapterData
    ) external view override returns (GoghBrokerTypes.AdapterExecution memory execution) {
        _validateIntent(intent, adapterData);
        execution = _buildFreeMintExecution(intent);
        _validateExecution(intent.account, intent.tokenId, execution);
    }

    /// @dev Must construct exactly `selector(intent.account,intent.tokenId)` for the pinned ABI
    ///      without accepting arbitrary calldata or appending any other argument.
    function _buildFreeMintExecution(GoghBrokerTypes.AcquisitionIntent calldata intent)
        internal
        view
        virtual
        returns (GoghBrokerTypes.AdapterExecution memory execution);

    function _validateIntent(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        bytes calldata adapterData
    ) private view {
        if (intent.chainId != ROBINHOOD_CHAIN_ID) {
            revert WrongChain(intent.chainId);
        }
        if (intent.adapter != address(this)) revert WrongAdapter(intent.adapter);
        if (intent.venue != venue) revert WrongVenue(intent.venue);
        if (intent.collection != collection) revert WrongCollection(intent.collection);
        if (intent.assetStandard != assetStandard) {
            revert WrongAssetStandard(intent.assetStandard);
        }
        if (intent.opportunityType != GoghBrokerTypes.OpportunityType.FREE_MINT) {
            revert UnsupportedOpportunityType(intent.opportunityType);
        }
        if (intent.account == address(0)) revert ZeroAccount();
        if (intent.assetAmount != 1) revert InvalidAssetAmount(intent.assetAmount);
        if (intent.currency != address(0)) revert NonNativeCurrency(intent.currency);
        if (intent.expectedPrice != 0 || intent.maxPrice != 0) {
            revert NonZeroIntentPrice(intent.expectedPrice, intent.maxPrice);
        }
        if (intent.maxSlippageBps != 0) revert NonZeroSlippage(intent.maxSlippageBps);
        if (adapterData.length != 0) revert UnsupportedAdapterData(adapterData.length);

        bytes32 actualCodeHash = address(this).codehash;
        if (intent.adapterCodeHash != actualCodeHash) {
            revert AdapterCodeHashMismatch(intent.adapterCodeHash, actualCodeHash);
        }
    }

    function _validateExecution(
        address expectedRecipient,
        uint256 intentTokenId,
        GoghBrokerTypes.AdapterExecution memory execution
    ) private view {
        if (execution.target != venue) {
            revert UnsafeExecutionTarget(execution.target);
        }
        if (
            execution.value != 0 || execution.currency != address(0)
                || execution.allowanceSpender != address(0) || execution.allowanceAmount != 0
                || execution.paymentAmount != 0
        ) {
            revert UnsafeExecutionFunds(
                execution.value,
                execution.currency,
                execution.allowanceSpender,
                execution.allowanceAmount,
                execution.paymentAmount
            );
        }

        bytes memory callData = execution.callData;
        if (callData.length != 68) revert MalformedMintCalldata(callData.length);

        bytes4 suppliedSelector;
        bytes32 recipientWord;
        uint256 suppliedTokenId;
        assembly ("memory-safe") {
            suppliedSelector := mload(add(callData, 0x20))
            recipientWord := mload(add(callData, 0x24))
            suppliedTokenId := mload(add(callData, 0x44))
        }
        if (suppliedSelector != mintSelector) revert WrongMintSelector(suppliedSelector);
        if (uint256(recipientWord) >> 160 != 0) {
            revert NonCanonicalRecipientEncoding(recipientWord);
        }
        address suppliedRecipient = address(uint160(uint256(recipientWord)));
        if (suppliedRecipient != expectedRecipient) {
            revert WrongMintRecipient(suppliedRecipient, expectedRecipient);
        }
        if (suppliedTokenId != intentTokenId) {
            revert WrongMintTokenId(suppliedTokenId, intentTokenId);
        }
    }
}
