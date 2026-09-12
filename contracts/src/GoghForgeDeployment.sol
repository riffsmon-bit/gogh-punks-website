// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghSkillRegistry } from "./GoghSkillRegistry.sol";
import { GoghReviewedSkillProgression } from "./GoghReviewedSkillProgression.sol";
import { GoghReviewedBurnSource } from "./GoghReviewedBurnSource.sol";

/// @notice Creates and binds the complete original-NFT Forge in one transaction.
/// @dev Starts paused with no registered skills. The named guardian must accept
/// registry ownership directly. This deployment record has no callable authority.
contract GoghForgeDeployment {
    GoghSkillRegistry public immutable registry;
    GoghReviewedSkillProgression public immutable progression;
    GoghReviewedBurnSource public immutable trainingSource;

    error InvalidDeployment();

    event ForgeDeployed(
        address indexed collection,
        address indexed guardian,
        address registry,
        address progression,
        address trainingSource
    );

    constructor(
        uint256 expectedChainId,
        address collection,
        bytes32 expectedCollectionCodeHash,
        address guardian,
        bytes32 allocationRoot,
        bytes32 snapshotHash
    ) {
        if (
            block.chainid != expectedChainId || collection.code.length == 0
                || collection.codehash != expectedCollectionCodeHash || guardian == address(0)
                || guardian == address(this) || allocationRoot == bytes32(0)
                || snapshotHash == bytes32(0)
        ) revert InvalidDeployment();

        GoghSkillRegistry deployedRegistry = new GoghSkillRegistry(address(this));
        deployedRegistry.setEmergencyControls(true, type(uint256).max);
        GoghReviewedBurnSource deployedSource = new GoghReviewedBurnSource(collection);
        GoghReviewedSkillProgression deployedProgression = new GoghReviewedSkillProgression(
            collection,
            address(deployedRegistry),
            address(deployedSource),
            allocationRoot,
            snapshotHash
        );
        deployedSource.bindProgression(address(deployedProgression));
        deployedRegistry.transferOwnership(guardian);

        registry = deployedRegistry;
        progression = deployedProgression;
        trainingSource = deployedSource;
        emit ForgeDeployed(
            collection,
            guardian,
            address(deployedRegistry),
            address(deployedProgression),
            address(deployedSource)
        );
    }
}
