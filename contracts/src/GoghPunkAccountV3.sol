// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghPunkAccountV1 } from "./GoghPunkAccountV1.sol";

/// @title GoghPunkAccountV3
/// @notice Separately activated Punk Account wired to the V3 free-only SeaDrop policy.
contract GoghPunkAccountV3 is GoghPunkAccountV1 {
    constructor(address policyModule_, address agentRegistry_, address adapterRegistry_)
        GoghPunkAccountV1(policyModule_, agentRegistry_, adapterRegistry_)
    { }
}
