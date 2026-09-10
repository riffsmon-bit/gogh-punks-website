// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghPunkAgentAccount } from "../GoghPunkAgentAccount.sol";
import { GoghBrokerTypes } from "../GoghBrokerTypes.sol";
import { GoghPunkSessionWrapper } from "./GoghPunkSessionWrapper.sol";
import { GoghOwnershipEpochRegistry } from "./GoghOwnershipEpochRegistry.sol";
import { GoghEpochSkillProgression } from "./GoghEpochSkillProgression.sol";

/// @notice New ERC-6551 implementation, still bound to ORIGINAL collection/tokenId.
/// Sessions require a wrapped Punk, an unchanged epoch and equipped Free Mint capability.
contract GoghEpochAgentAccount is GoghPunkAgentAccount {
    bytes32 public constant AUTHORITY_MODEL = keccak256("GOGH_WRAPPED_EPOCH_V1");
    uint256 public constant FREE_MINT_CAPABILITY = 2;
    GoghPunkSessionWrapper public immutable wrapper;
    GoghOwnershipEpochRegistry public immutable epochs;
    GoghEpochSkillProgression public immutable progression;
    uint256 public authorizedEpoch;
    uint256 public authorizedSecurityGeneration;

    error EpochAuthorizationRequired();
    error AuthorityChangedDuringExecution();
    event SessionEpochBound(
        uint64 indexed generation, uint256 indexed epoch, uint256 securityGeneration
    );

    constructor(address entryPoint_, address adapters_, address wrapper_, address progression_)
        GoghPunkAgentAccount(entryPoint_, adapters_)
    {
        wrapper = GoghPunkSessionWrapper(wrapper_);
        epochs = wrapper.epochs();
        progression = GoghEpochSkillProgression(progression_);
        if (
            wrapper.COLLECTION() != GOGH_PUNKS || address(progression.wrapper()) != wrapper_
                || address(progression.collection()) != GOGH_PUNKS || epochs.wrapper() != wrapper_
        ) {
            revert InvalidTarget();
        }
    }

    function owner() public view override returns (address currentOwner) {
        if (!isCanonicalGoghPunkAccount()) return address(0);
        (,, uint256 id) = token();
        currentOwner = wrapper.resolveOwner(id);
        if (_ownershipCycleOrExcessiveDepth(currentOwner)) return address(0);
    }

    function isAutonomousSessionActive() public view override returns (bool) {
        if (!super.isAutonomousSessionActive()) return false;
        (,, uint256 id) = token();
        return
            _epochValid(id) && (progression.effectiveCapabilities(id) & FREE_MINT_CAPABILITY) != 0;
    }

    function configureAutonomousSession(AutonomousSessionConfig calldata config) public override {
        // Base enforces live owner, adapter, price/gas/expiry/mint limits.
        super.configureAutonomousSession(config);
        (,, uint256 id) = token();
        if (
            !wrapper.isWrapped(id) || epochs.executionPaused()
                || (progression.effectiveCapabilities(id) & FREE_MINT_CAPABILITY) == 0
        ) {
            revert EpochAuthorizationRequired();
        }
        authorizedEpoch = epochs.epoch(id);
        authorizedSecurityGeneration = epochs.securityGeneration();
        emit SessionEpochBound(sessionGeneration, authorizedEpoch, authorizedSecurityGeneration);
    }

    function executeSessionAcquisition(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        bytes calldata data
    ) public override returns (bytes memory result) {
        uint64 generation = sessionGeneration;
        result = super.executeSessionAcquisition(intent, data);
        (,, uint256 id) = token();
        // A transfer/reconfiguration during a venue/receiver callback rolls the whole mint back.
        if (
            !_epochValid(id) || generation != sessionGeneration || owner() != intent.expectedOwner
                || (progression.effectiveCapabilities(id) & FREE_MINT_CAPABILITY) == 0
        ) {
            revert AuthorityChangedDuringExecution();
        }
    }

    function _epochValid(uint256 id) private view returns (bool) {
        return authorizedEpoch != 0 && wrapper.isWrapped(id) && !epochs.executionPaused()
            && epochs.epoch(id) == authorizedEpoch
            && epochs.securityGeneration() == authorizedSecurityGeneration;
    }
}
