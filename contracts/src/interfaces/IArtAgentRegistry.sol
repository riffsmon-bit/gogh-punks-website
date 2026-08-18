// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface IArtAgentRegistry {
    function isAuthorized(address account, address agent) external view returns (bool);
}
