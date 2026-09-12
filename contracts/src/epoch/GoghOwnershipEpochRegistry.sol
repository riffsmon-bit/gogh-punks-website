// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @notice Transfer history written synchronously by one immutable receipt wrapper.
/// @dev No NFT custody, executor, approval, epoch reset or writer rotation.
contract GoghOwnershipEpochRegistry {
    address public immutable wrapper;
    address public immutable guardian;
    mapping(uint256 => uint256) public epoch;
    bool public executionPaused;
    uint256 public securityGeneration;

    error NotWrapper();
    error NotGuardian();
    error InvalidConfiguration();
    event OwnershipEpochAdvanced(uint256 indexed tokenId, uint256 epoch, address from, address to);
    event ExecutionPauseChanged(bool paused, uint256 securityGeneration);

    constructor(address wrapper_, address guardian_) {
        if (wrapper_ == address(0) || guardian_ == address(0)) revert InvalidConfiguration();
        wrapper = wrapper_;
        guardian = guardian_;
    }

    function advance(uint256 tokenId, address from, address to) external {
        if (msg.sender != wrapper) revert NotWrapper();
        emit OwnershipEpochAdvanced(tokenId, ++epoch[tokenId], from, to);
    }

    /// @dev Pausing never prevents transfer or redemption. Resume requires fresh sessions.
    function setExecutionPaused(bool paused) external {
        if (msg.sender != guardian) revert NotGuardian();
        if (executionPaused != paused) {
            executionPaused = paused;
            emit ExecutionPauseChanged(paused, ++securityGeneration);
        }
    }
}
