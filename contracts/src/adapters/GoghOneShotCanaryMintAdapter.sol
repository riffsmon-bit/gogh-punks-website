// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghOneShotCanaryArt } from "../canary/GoghOneShotCanaryArt.sol";
import { GoghBrokerTypes } from "../GoghBrokerTypes.sol";
import { ZeroCostMintAdapterBase } from "./ZeroCostMintAdapterBase.sol";

/// @title GoghOneShotCanaryMintAdapter
/// @notice Test-only adapter for one exact GoghOneShotCanaryArt deployment.
/// @dev The venue and collection are the same immutable ERC-721 target. The adapter additionally
///      binds the typed account and token ID to the target's immutable configuration before the
///      base validates the exact `mint(address,uint256)` calldata. No opaque adapter data is used.
///      This is not a production venue adapter and must not be registered without deployment,
///      bytecode, registry, policy, and end-to-end canary review.
contract GoghOneShotCanaryMintAdapter is ZeroCostMintAdapterBase {
    GoghOneShotCanaryArt public immutable canaryCollection;
    address public immutable boundAccount;
    uint256 public immutable boundTokenId;

    error WrongCanaryAccount(address supplied, address expected);
    error WrongCanaryTokenId(uint256 supplied, uint256 expected);

    constructor(GoghOneShotCanaryArt canaryCollection_)
        ZeroCostMintAdapterBase(
            address(canaryCollection_),
            address(canaryCollection_),
            GoghOneShotCanaryArt.mint.selector,
            GoghBrokerTypes.AssetStandard.ERC721
        )
    {
        canaryCollection = canaryCollection_;
        boundAccount = canaryCollection_.punkAccount();
        boundTokenId = canaryCollection_.canaryTokenId();
    }

    function _buildFreeMintExecution(GoghBrokerTypes.AcquisitionIntent calldata intent)
        internal
        view
        override
        returns (GoghBrokerTypes.AdapterExecution memory execution)
    {
        if (intent.account != boundAccount) {
            revert WrongCanaryAccount(intent.account, boundAccount);
        }
        if (intent.tokenId != boundTokenId) {
            revert WrongCanaryTokenId(intent.tokenId, boundTokenId);
        }

        execution.target = venue;
        execution.callData =
            abi.encodeCall(GoghOneShotCanaryArt.mint, (intent.account, intent.tokenId));
    }
}
