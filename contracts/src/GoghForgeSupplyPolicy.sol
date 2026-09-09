// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface IGoghCirculatingSupply {
    function totalSupply() external view returns (uint256);
}

/// @notice Supply constraint for a future reviewed training source, NOT a burn implementation.
/// @dev Cannot constrain direct burns through the existing collection. No admin override.
library GoghForgeSupplyPolicy {
    uint256 internal constant MINIMUM_SUPPLY = 1111;
    error SupplyFloorReached();
    error UnexpectedSupplyChange();

    function beforeSacrifice(address collection) internal view returns (uint256 supply) {
        // Unavailable/malformed supply reverts; historical minted count is never substituted.
        supply = IGoghCirculatingSupply(collection).totalSupply();
        if (supply <= MINIMUM_SUPPLY) revert SupplyFloorReached();
    }

    function afterSacrifice(address collection, uint256 priorSupply) internal view {
        uint256 supply = IGoghCirculatingSupply(collection).totalSupply();
        if (supply < MINIMUM_SUPPLY) revert SupplyFloorReached();
        if (priorSupply <= MINIMUM_SUPPLY || supply != priorSupply - 1) {
            revert UnexpectedSupplyChange();
        }
    }
}
