// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghPunkAccountRegistry } from "./GoghPunkAccountRegistry.sol";

/// @title GoghPunkAccountRegistryV2
/// @notice Separate activation facade for the V2 automated-mint account implementation.
contract GoghPunkAccountRegistryV2 is GoghPunkAccountRegistry {
    uint256 public constant V2_IMPLEMENTATION_VERSION = 2;

    constructor(address implementation_, bytes32 accountSalt_)
        GoghPunkAccountRegistry(implementation_, accountSalt_)
    { }

    function _implementationVersion() internal pure override returns (uint256) {
        return V2_IMPLEMENTATION_VERSION;
    }
}
