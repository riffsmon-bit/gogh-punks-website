// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { TestVm } from "./mocks/TestInfrastructure.sol";
import { GoghForgeDeployment } from "../src/GoghForgeDeployment.sol";
import { GoghReviewedBurnSource } from "../src/GoghReviewedBurnSource.sol";
import { GoghReviewedSkillProgression } from "../src/GoghReviewedSkillProgression.sol";
import { GoghSkillRegistry } from "../src/GoghSkillRegistry.sol";
import { LocalBurnPunks } from "./mocks/LocalReviewedBurn.sol";

contract GoghForgeDeploymentTest {
    TestVm private constant vm = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertEq(address a, address b) private pure {
        require(a == b);
    }

    function assertEq(uint256 a, uint256 b) private pure {
        require(a == b);
    }

    function assertEq(bytes32 a, bytes32 b) private pure {
        require(a == b);
    }

    function assertTrue(bool a) private pure {
        require(a);
    }

    function assertFalse(bool a) private pure {
        require(!a);
    }
    LocalBurnPunks private punks;
    address private guardian = address(0xa11ce);
    bytes32 private constant ROOT = keccak256("allocation");
    bytes32 private constant SNAPSHOT = keccak256("snapshot");

    function setUp() public {
        vm.chainId(31_337);
        punks = new LocalBurnPunks();
    }

    function _deploy() private returns (GoghForgeDeployment) {
        return new GoghForgeDeployment(
            block.chainid, address(punks), address(punks).codehash, guardian, ROOT, SNAPSHOT
        );
    }

    function testAtomicBindingStartsPausedAndGuardianAccepts() public {
        GoghForgeDeployment stack = _deploy();
        GoghSkillRegistry registry = stack.registry();
        GoghReviewedBurnSource source = stack.trainingSource();
        GoghReviewedSkillProgression progression = stack.progression();
        assertEq(registry.owner(), address(stack));
        assertEq(registry.pendingOwner(), guardian);
        assertTrue(registry.globallyDisabled());
        assertEq(registry.disabledCapabilities(), type(uint256).max);
        assertEq(registry.skillCount(), 0);
        assertEq(address(source.progression()), address(progression));
        assertEq(progression.trainingSource(), address(source));
        assertEq(address(progression.registry()), address(registry));
        assertEq(address(progression.collection()), address(punks));
        assertEq(source.collectionCodeHash(), address(punks).codehash);
        assertEq(source.registryCodeHash(), address(registry).codehash);
        assertEq(source.progressionCodeHash(), address(progression).codehash);
        vm.prank(guardian);
        registry.acceptOwnership();
        assertEq(registry.owner(), guardian);
        assertEq(registry.pendingOwner(), address(0));
        assertTrue(registry.globallyDisabled());
    }

    function testNoDeployerOrOutsiderAuthority() public {
        GoghForgeDeployment stack = _deploy();
        GoghSkillRegistry registry = stack.registry();
        vm.expectRevert();
        registry.acceptOwnership();
        vm.expectRevert();
        registry.setEmergencyControls(false, 0);
        GoghReviewedBurnSource source = stack.trainingSource();
        address progression = address(stack.progression());
        vm.expectRevert(GoghReviewedBurnSource.NotCurrentOwner.selector);
        source.bindProgression(progression);
        vm.prank(address(stack));
        vm.expectRevert(GoghReviewedBurnSource.AlreadyBound.selector);
        source.bindProgression(progression);
        (bool ok,) = address(stack)
            .call(abi.encodeWithSignature("setEmergencyControls(bool,uint256)", false, 0));
        assertFalse(ok);
    }

    function testPauseBlocksBurnEvenWithExactApproval() public {
        GoghForgeDeployment stack = _deploy();
        for (uint256 first = 1; first < 1114; first += 100) {
            uint256 count = 1114 - first;
            punks.mintReserve(guardian, first, count > 100 ? 100 : count);
        }
        GoghReviewedBurnSource source = stack.trainingSource();
        vm.prank(guardian);
        punks.approve(address(source), 7);
        GoghReviewedBurnSource.BurnReview memory review = GoghReviewedBurnSource.BurnReview(
            7, 44, 0, source.burnReviewStateHash(7, 44), uint64(block.timestamp + 60)
        );
        vm.prank(guardian);
        vm.expectRevert(GoghReviewedBurnSource.TrainingPaused.selector);
        source.applyBurnReview(review);
        assertEq(punks.ownerOf(7), guardian);
        assertEq(stack.progression().trainingCredits(44), 0);
    }

    function testWrongChainRejected() public {
        bytes32 codeHash = address(punks).codehash;
        vm.expectRevert(GoghForgeDeployment.InvalidDeployment.selector);
        new GoghForgeDeployment(4663, address(punks), codeHash, guardian, ROOT, SNAPSHOT);
    }

    function testChangedCollectionRejected() public {
        vm.expectRevert(GoghForgeDeployment.InvalidDeployment.selector);
        new GoghForgeDeployment(
            block.chainid, address(punks), bytes32(uint256(1)), guardian, ROOT, SNAPSHOT
        );
    }

    function testEmptyCollectionRejected() public {
        address absent = address(0xbad);
        vm.expectRevert(GoghForgeDeployment.InvalidDeployment.selector);
        new GoghForgeDeployment(block.chainid, absent, absent.codehash, guardian, ROOT, SNAPSHOT);
    }

    function testZeroGuardianAndRarityPinsRejected() public {
        bytes32 codeHash = address(punks).codehash;
        vm.expectRevert(GoghForgeDeployment.InvalidDeployment.selector);
        new GoghForgeDeployment(block.chainid, address(punks), codeHash, address(0), ROOT, SNAPSHOT);
        vm.expectRevert(GoghForgeDeployment.InvalidDeployment.selector);
        new GoghForgeDeployment(
            block.chainid, address(punks), codeHash, guardian, bytes32(0), SNAPSHOT
        );
        vm.expectRevert(GoghForgeDeployment.InvalidDeployment.selector);
        new GoghForgeDeployment(block.chainid, address(punks), codeHash, guardian, ROOT, bytes32(0));
    }
}
