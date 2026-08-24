// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghPunkAccountRegistry } from "./GoghPunkAccountRegistry.sol";

/// @title GoghPunkAccountRegistryV3
/// @notice Separate activation facade for the V3 OpenSea Studio account implementation.
contract GoghPunkAccountRegistryV3 is GoghPunkAccountRegistry {
    uint256 public constant V3_IMPLEMENTATION_VERSION = 3;

    constructor(address implementation_, bytes32 accountSalt_)
        GoghPunkAccountRegistry(implementation_, accountSalt_)
    { }

    function _implementationVersion() internal pure override returns (uint256) {
        return V3_IMPLEMENTATION_VERSION;
    }
}
