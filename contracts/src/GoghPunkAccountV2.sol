// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghPunkAccountV1 } from "./GoghPunkAccountV1.sol";

/// @title GoghPunkAccountV2
/// @notice A separately activated Punk Account wired to the automated-mint V2 policy module.
/// @dev It intentionally inherits the V1 execution envelope; agents still cannot access general
///      owner execution and can submit only typed acquisitions through registered adapters.
contract GoghPunkAccountV2 is GoghPunkAccountV1 {
    constructor(address policyModule_, address agentRegistry_, address adapterRegistry_)
        GoghPunkAccountV1(policyModule_, agentRegistry_, adapterRegistry_)
    { }
}
