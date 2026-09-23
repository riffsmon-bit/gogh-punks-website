// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { SwarmGasVault, SwarmGasVaultConfig } from "./SwarmGasVault.sol";

/// @notice Permissionless factory for one immutable, owner-controlled Swarm wallet per holder.
/// @dev No administrator and no ability to spend vault ETH. Creation never activates a Punk.
contract SwarmGasVaultFactory is SwarmGasVaultConfig {
    event VaultCreated(address indexed owner, address indexed vault);

    constructor(uint256 chainId_, address collection_, address registry_, address implementation_)
        SwarmGasVaultConfig(chainId_, collection_, registry_, implementation_)
    { }

    function getVault(address owner) public view returns (address) {
        if (owner == address(0)) revert InvalidConfiguration();
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff),
                            address(this),
                            _salt(owner),
                            keccak256(_creationCode(owner))
                        )
                    )
                )
            )
        );
    }

    function isVaultCreated(address owner) external view returns (bool) {
        return getVault(owner).code.length != 0;
    }

    /// @notice Create only the caller's vault. Repeated calls return the same existing vault.
    /// @dev Predicted-address ETH deposits are retained by CREATE2 and recoverable by the owner.
    function createVault() external returns (address vault) {
        _requireDependencies();
        vault = getVault(msg.sender);
        if (vault.code.length != 0) return vault;
        SwarmGasVault created = new SwarmGasVault{ salt: _salt(msg.sender) }(
            msg.sender, chainId, collection, registry, implementation
        );
        if (address(created) != vault) revert InvalidConfiguration();
        emit VaultCreated(msg.sender, vault);
    }

    function _salt(address owner) private pure returns (bytes32) {
        return keccak256(abi.encode(owner));
    }

    function _creationCode(address owner) private view returns (bytes memory) {
        return abi.encodePacked(
            type(SwarmGasVault).creationCode,
            abi.encode(owner, chainId, collection, registry, implementation)
        );
    }
}
