// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghBrokerTypes } from "../GoghBrokerTypes.sol";

/// @notice Adapter implementations convert typed intent data into one deterministic venue call.
/// @dev An adapter must validate NFT recipient, collection, token, price, and venue-specific fields.
interface IGoghMarketplaceAdapter {
    function kind() external view returns (GoghBrokerTypes.AdapterKind);
    function venue() external view returns (address);

    function buildExecution(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        bytes calldata adapterData
    ) external view returns (GoghBrokerTypes.AdapterExecution memory execution);
}
