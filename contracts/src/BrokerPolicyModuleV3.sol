// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { BrokerPolicyModuleV2 } from "./BrokerPolicyModuleV2.sol";

/// @title BrokerPolicyModuleV3
/// @notice Free-only automated SeaDrop policy for the reviewed V3 Studio adapter.
/// @dev It inherits V2's zero-spend policy, bounded daily caps, one immutable adapter route,
///      explicit-denial precedence, and one-call containment behavior. Paid mints remain disabled.
contract BrokerPolicyModuleV3 is BrokerPolicyModuleV2 {
    constructor(address guardian, address adapterRegistry_, address automatedSeaDropAdapter_)
        BrokerPolicyModuleV2(guardian, adapterRegistry_, automatedSeaDropAdapter_)
    { }
}
