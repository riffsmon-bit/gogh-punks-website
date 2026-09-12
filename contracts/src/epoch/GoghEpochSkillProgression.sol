// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghRaritySkillProgression } from "../GoghRaritySkillProgression.sol";
import { GoghPunkSessionWrapper } from "./GoghPunkSessionWrapper.sol";

/// @notice Keeps rarity/credits/skills on the ORIGINAL token ID through wrapping and redemption.
/// @dev New progression deployment only. Existing progression is not implicitly migrated.
contract GoghEpochSkillProgression is GoghRaritySkillProgression {
    GoghPunkSessionWrapper public immutable wrapper;

    constructor(
        address wrapper_,
        address registry_,
        address source_,
        bytes32 root_,
        bytes32 snapshot_
    )
        GoghRaritySkillProgression(
            GoghPunkSessionWrapper(wrapper_).COLLECTION(), registry_, source_, root_, snapshot_
        )
    {
        wrapper = GoghPunkSessionWrapper(wrapper_);
    }

    function _requireOwner(uint256 tokenId) internal view override {
        if (wrapper.resolveOwner(tokenId) != msg.sender) revert NotCurrentOwner();
    }
}
