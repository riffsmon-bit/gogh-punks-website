// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghBrokerTypes } from "../GoghBrokerTypes.sol";

interface IArtAdapterRegistry {
    function validateAdapter(
        address adapter,
        GoghBrokerTypes.AdapterKind expectedKind,
        address expectedVenue,
        bytes32 expectedCodeHash
    ) external view returns (bool);
}
