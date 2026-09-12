// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC6551Registry } from "../interfaces/IERC6551Registry.sol";
import { GoghEpochAgentAccount } from "./GoghEpochAgentAccount.sol";
import { GoghPunkSessionWrapper } from "./GoghPunkSessionWrapper.sol";

/// @notice Immutable facade for new accounts; existing factories and addresses are untouched.
contract GoghEpochAccountRegistry {
    IERC6551Registry public constant canonicalRegistry =
        IERC6551Registry(0x000000006551c19487814612e58FE06813775758);
    GoghEpochAgentAccount public immutable implementation;
    GoghPunkSessionWrapper public immutable wrapper;
    bytes32 public immutable accountSalt;
    error InvalidConfiguration();
    error NotCurrentOwner();
    event EpochAccountCreated(
        uint256 indexed tokenId, address indexed account, address indexed owner
    );

    constructor(address implementation_, bytes32 salt_) {
        if (implementation_.code.length == 0 || address(canonicalRegistry).code.length == 0) {
            revert InvalidConfiguration();
        }
        implementation = GoghEpochAgentAccount(payable(implementation_));
        wrapper = implementation.wrapper();
        if (
            block.chainid != wrapper.CHAIN_ID()
                || implementation.AUTHORITY_MODEL() != keccak256("GOGH_WRAPPED_EPOCH_V1")
        ) revert InvalidConfiguration();
        accountSalt = salt_;
    }

    function account(uint256 id) public view returns (address) {
        return canonicalRegistry.account(
            address(implementation), accountSalt, wrapper.CHAIN_ID(), wrapper.COLLECTION(), id
        );
    }

    function createAccount(uint256 id) external returns (address created) {
        if (!wrapper.isWrapped(id) || wrapper.resolveOwner(id) != msg.sender) {
            revert NotCurrentOwner();
        }
        created = canonicalRegistry.createAccount(
            address(implementation), accountSalt, wrapper.CHAIN_ID(), wrapper.COLLECTION(), id
        );
        if (created != account(id) || created.code.length == 0) revert InvalidConfiguration();
        emit EpochAccountCreated(id, created, msg.sender);
    }
}
