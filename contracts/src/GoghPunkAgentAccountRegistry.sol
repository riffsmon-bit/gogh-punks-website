// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghPunkAccountRegistry } from "./GoghPunkAccountRegistry.sol";

/// @title GoghPunkAgentAccountRegistry
/// @notice Separate activation facade for the ERC-4337 Punk Agent Account.
contract GoghPunkAgentAccountRegistry is GoghPunkAccountRegistry {
    uint256 public constant AGENT_ACCOUNT_IMPLEMENTATION_VERSION = 4;

    constructor(address implementation_, bytes32 accountSalt_)
        GoghPunkAccountRegistry(implementation_, accountSalt_)
    { }

    function _implementationVersion() internal pure override returns (uint256) {
        return AGENT_ACCOUNT_IMPLEMENTATION_VERSION;
    }
}
