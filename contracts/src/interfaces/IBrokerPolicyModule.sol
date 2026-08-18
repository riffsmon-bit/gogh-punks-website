// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghBrokerTypes } from "../GoghBrokerTypes.sol";

interface IBrokerPolicyModule {
    function policyVersion(address account) external view returns (uint64);

    function validateAndConsume(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        GoghBrokerTypes.AdapterExecution calldata execution,
        bool ownerApproved
    ) external;
}
