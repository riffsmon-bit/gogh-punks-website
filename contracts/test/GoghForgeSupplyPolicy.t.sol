// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;
import { GoghForgeSupplyPolicy } from "../src/GoghForgeSupplyPolicy.sol";

contract MockForgeSupply {
    uint256 public totalSupply;

    constructor(uint256 supply) {
        totalSupply = supply;
    }

    function reduce(uint256 quantity) external {
        totalSupply -= quantity;
    }
}

contract LocalSupplyPolicyHarness {
    function sacrifice(MockForgeSupply collection, uint256 quantity) external {
        uint256 prior = GoghForgeSupplyPolicy.beforeSacrifice(address(collection));
        collection.reduce(quantity);
        GoghForgeSupplyPolicy.afterSacrifice(address(collection), prior);
    }
}

contract GoghForgeSupplyPolicyTest {
    function testLastPermittedSacrificeAndNextDenied() public {
        MockForgeSupply collection = new MockForgeSupply(1112);
        LocalSupplyPolicyHarness harness = new LocalSupplyPolicyHarness();
        harness.sacrifice(collection, 1);
        require(collection.totalSupply() == 1111);
        try harness.sacrifice(collection, 1) {
            revert("FLOOR_BYPASS");
        } catch { }
        require(collection.totalSupply() == 1111);
    }

    function testMultipleBurnAndNoBurnRevertAtomically() public {
        MockForgeSupply collection = new MockForgeSupply(1112);
        LocalSupplyPolicyHarness harness = new LocalSupplyPolicyHarness();
        try harness.sacrifice(collection, 2) {
            revert("MULTIPLE_BURN");
        } catch { }
        require(collection.totalSupply() == 1112);
        try harness.sacrifice(collection, 0) {
            revert("NO_BURN");
        } catch { }
        require(collection.totalSupply() == 1112);
    }

    function testUnavailableSupplyFailsClosed() public {
        LocalSupplyPolicyHarness harness = new LocalSupplyPolicyHarness();
        try harness.sacrifice(MockForgeSupply(address(0x1234)), 1) {
            revert("UNKNOWN_SUPPLY");
        } catch { }
    }

    function testFreshSupplyAndExactSingleBurnAreRequired() public {
        LocalSupplyPolicyHarness harness = new LocalSupplyPolicyHarness();
        MockForgeSupply aboveFloor = new MockForgeSupply(1120);
        try harness.sacrifice(aboveFloor, 2) {
            revert("EXACT_ONE_REQUIRED");
        } catch { }
        require(aboveFloor.totalSupply() == 1120);
        MockForgeSupply lastAvailable = new MockForgeSupply(1112);
        // Another transaction consumes the last available burn after a UI preflight.
        lastAvailable.reduce(1);
        try harness.sacrifice(lastAvailable, 1) {
            revert("STALE_PREFLIGHT_ACCEPTED");
        } catch { }
        require(lastAvailable.totalSupply() == 1111);
    }

    function testDirectBurnOutsideForgeIsNotPrevented() public {
        MockForgeSupply collection = new MockForgeSupply(1111);
        collection.reduce(1);
        require(collection.totalSupply() == 1110);
    }
}
