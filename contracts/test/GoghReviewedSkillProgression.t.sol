// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghReviewedSkillProgression } from "../src/GoghReviewedSkillProgression.sol";
import { GoghRaritySkillProgression } from "../src/GoghRaritySkillProgression.sol";
import { GoghSkillProgression } from "../src/GoghSkillProgression.sol";
import { GoghSkillRegistry } from "../src/GoghSkillRegistry.sol";
import { SkillForgeMockPunks, LocalSkillTrainingSource } from "./GoghSkillForge.t.sol";
import { TestVm } from "./mocks/TestInfrastructure.sol";

contract GoghReviewedSkillProgressionTest {
    TestVm private constant vm = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    bytes32 private constant SNAPSHOT = keccak256("REVIEW_LOCAL_FIXTURE");
    SkillForgeMockPunks private collection;
    LocalSkillTrainingSource private source;
    GoghSkillRegistry private registry;
    GoghReviewedSkillProgression private progression;
    bytes32 private skill;

    function setUp() public {
        vm.chainId(31_337);
        vm.warp(1_800_000_000);
        collection = new SkillForgeMockPunks();
        registry = new GoghSkillRegistry(address(this));
        source = new LocalSkillTrainingSource(collection);
        bytes32 leaf = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        keccak256("GOGH_RARITY_SLOTS_V1"),
                        uint256(31_337),
                        address(collection),
                        SNAPSHOT,
                        uint256(1),
                        uint8(2)
                    )
                )
            )
        );
        progression = new GoghReviewedSkillProgression(
            address(collection), address(registry), address(source), leaf, SNAPSHOT
        );
        source.bind(progression);
        for (uint256 id = 1; id <= 12; ++id) {
            collection.mint(ALICE, id);
        }
        skill = registry.register(
            3, 1, keccak256("fixture manifest"), keccak256("fixture instructions"), bytes32(0), 1, 0
        );
        registry.setStatus(skill, GoghSkillRegistry.Status.TESTING, bytes32(0));
        registry.setStatus(skill, GoghSkillRegistry.Status.READY, keccak256("fixture evidence"));
        _credit(2);
    }

    function _credit(uint256 id) private {
        vm.prank(ALICE);
        collection.approve(address(source), id);
        vm.prank(ALICE);
        source.sacrifice(id, 1);
    }

    function _review(GoghReviewedSkillProgression.Operation op)
        private
        view
        returns (GoghReviewedSkillProgression.TrainingReview memory r)
    {
        r.tokenId = 1;
        r.operation = op;
        r.nonce = progression.trainingReviewNonce(1);
        r.stateHash = progression.trainingReviewStateHash(1);
        r.deadline = uint64(block.timestamp + 60);
        r.rarityProof = new bytes32[](0);
        if (
            op == GoghReviewedSkillProgression.Operation.LEARN
                || op == GoghReviewedSkillProgression.Operation.EQUIP
        ) r.skillKey = skill;
        if (op == GoghReviewedSkillProgression.Operation.CLAIM_RARITY) r.startingSlots = 2;
    }

    function _apply(GoghReviewedSkillProgression.Operation op) private {
        GoghReviewedSkillProgression.TrainingReview memory r = _review(op);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
    }

    function testLearnThenEquipThenUnequipReusesExistingSkillRules() public {
        _apply(GoghReviewedSkillProgression.Operation.LEARN);
        require(progression.learnedLevel(1, skill) == 1 && progression.trainingCredits(1) == 0);
        require(
            progression.effectiveCapabilities(1) == 0 && progression.trainingReviewNonce(1) == 1
        );
        _apply(GoghReviewedSkillProgression.Operation.EQUIP);
        require(progression.effectiveCapabilities(1) == 1);
        _apply(GoghReviewedSkillProgression.Operation.UNEQUIP);
        require(
            progression.learnedLevel(1, skill) == 1 && progression.effectiveCapabilities(1) == 0
        );
        require(progression.trainingReviewNonce(1) == 3);
    }

    function testDirectInheritedOwnerEntrypointsCannotBypassReview() public {
        vm.startPrank(ALICE);
        vm.expectRevert(GoghReviewedSkillProgression.TrainingReviewRequired.selector);
        progression.learnSkill(1, skill);
        vm.expectRevert(GoghReviewedSkillProgression.TrainingReviewRequired.selector);
        progression.unlockSlot(1);
        vm.expectRevert(GoghReviewedSkillProgression.TrainingReviewRequired.selector);
        progression.equipSkill(1, 0, skill);
        vm.expectRevert(GoghReviewedSkillProgression.TrainingReviewRequired.selector);
        progression.unequipSkill(1, 0);
        vm.expectRevert(GoghReviewedSkillProgression.TrainingReviewRequired.selector);
        progression.claimRaritySlots(1, 2, new bytes32[](0));
        vm.stopPrank();
        require(progression.trainingReviewNonce(1) == 0 && progression.trainingCredits(1) == 1);
    }

    function testExpiredWalletConfirmationRevertsWithoutTrainingOrNonceConsumption() public {
        GoghReviewedSkillProgression.TrainingReview memory r =
            _review(GoghReviewedSkillProgression.Operation.LEARN);
        vm.warp(block.timestamp + 61);
        vm.expectRevert(GoghReviewedSkillProgression.ReviewExpired.selector);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
        require(
            progression.trainingCredits(1) == 1 && progression.learnedLevel(1, skill) == 0
                && progression.trainingReviewNonce(1) == 0
        );
    }

    function testDeadlineMaximumAndExactBoundary() public {
        GoghReviewedSkillProgression.TrainingReview memory r =
            _review(GoghReviewedSkillProgression.Operation.LEARN);
        ++r.deadline;
        vm.expectRevert(GoghReviewedSkillProgression.ReviewDeadlineTooFar.selector);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
        --r.deadline;
        vm.warp(r.deadline);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
        require(progression.learnedLevel(1, skill) == 1);
    }

    function testReviewCanBeAppliedOnlyOnceAndOwnerCanCancelPendingReviews() public {
        GoghReviewedSkillProgression.TrainingReview memory r =
            _review(GoghReviewedSkillProgression.Operation.LEARN);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
        vm.expectRevert(GoghReviewedSkillProgression.ReviewNonceChanged.selector);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
        r = _review(GoghReviewedSkillProgression.Operation.EQUIP);
        vm.expectRevert(GoghSkillProgression.NotCurrentOwner.selector);
        vm.prank(BOB);
        progression.invalidateTrainingReviews(1);
        vm.prank(ALICE);
        progression.invalidateTrainingReviews(1);
        vm.expectRevert(GoghReviewedSkillProgression.ReviewNonceChanged.selector);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
        require(progression.learnedLevel(1, skill) == 1 && progression.equipped(1, 0) == bytes32(0));
    }

    function testIncomingCreditInvalidatesOldDisplayedBalanceReview() public {
        GoghReviewedSkillProgression.TrainingReview memory r =
            _review(GoghReviewedSkillProgression.Operation.LEARN);
        _credit(3);
        vm.expectRevert(GoghReviewedSkillProgression.ReviewStateChanged.selector);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
        require(progression.trainingCredits(1) == 2 && progression.trainingReviewNonce(1) == 0);
    }

    function testRarityClaimThenSlotUnlockAndCapAreReviewed() public {
        _apply(GoghReviewedSkillProgression.Operation.CLAIM_RARITY);
        require(progression.unlockedSlots(1) == 2 && progression.trainingCredits(1) == 1);
        _apply(GoghReviewedSkillProgression.Operation.UNLOCK);
        require(progression.unlockedSlots(1) == 3 && progression.trainingCredits(1) == 0);
        for (uint256 i = 3; i <= 7; ++i) {
            _credit(i);
        }
        for (uint256 i; i < 4; ++i) {
            _apply(GoghReviewedSkillProgression.Operation.UNLOCK);
        }
        GoghReviewedSkillProgression.TrainingReview memory r =
            _review(GoghReviewedSkillProgression.Operation.UNLOCK);
        vm.expectRevert(GoghSkillProgression.SlotUnavailable.selector);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
        require(
            progression.unlockedSlots(1) == 7 && progression.trainingCredits(1) == 1
                && progression.trainingReviewNonce(1) == 6
        );
    }

    function testRejectedSkillAndRarityChecksRollBackReviewContextAndNonce() public {
        GoghReviewedSkillProgression.TrainingReview memory r =
            _review(GoghReviewedSkillProgression.Operation.EQUIP);
        vm.expectRevert(GoghSkillProgression.NotLearned.selector);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
        r = _review(GoghReviewedSkillProgression.Operation.CLAIM_RARITY);
        r.startingSlots = 3;
        vm.expectRevert(GoghRaritySkillProgression.InvalidAllocation.selector);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
        require(progression.trainingReviewNonce(1) == 0);
        _apply(GoghReviewedSkillProgression.Operation.LEARN);
        require(progression.trainingReviewNonce(1) == 1);
    }

    function testEmergencyDisableStillBlocksAnAlreadyPreparedLearn() public {
        GoghReviewedSkillProgression.TrainingReview memory r =
            _review(GoghReviewedSkillProgression.Operation.LEARN);
        registry.setDisabled(skill, true);
        vm.expectRevert(GoghSkillProgression.SkillUnavailable.selector);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
        require(progression.trainingCredits(1) == 1 && progression.trainingReviewNonce(1) == 0);
    }

    function testOriginalTransferPreservesProgressionAndRequiresNewOwnerReview() public {
        _apply(GoghReviewedSkillProgression.Operation.LEARN);
        GoghReviewedSkillProgression.TrainingReview memory old =
            _review(GoghReviewedSkillProgression.Operation.EQUIP);
        vm.prank(ALICE);
        collection.safeTransferFrom(ALICE, BOB, 1);
        require(progression.learnedLevel(1, skill) == 1 && progression.trainingReviewNonce(1) == 1);
        vm.expectRevert(GoghSkillProgression.NotCurrentOwner.selector);
        vm.prank(ALICE);
        progression.applyTrainingReview(old);
        vm.expectRevert(GoghReviewedSkillProgression.ReviewStateChanged.selector);
        vm.prank(BOB);
        progression.applyTrainingReview(old);
        GoghReviewedSkillProgression.TrainingReview memory fresh =
            _review(GoghReviewedSkillProgression.Operation.EQUIP);
        vm.prank(BOB);
        progression.applyTrainingReview(fresh);
        require(progression.equipped(1, 0) == skill);
    }

    function testExplicitlyDocumentsNoSynchronousOriginalNftEpoch() public {
        GoghReviewedSkillProgression.TrainingReview memory r =
            _review(GoghReviewedSkillProgression.Operation.LEARN);
        vm.prank(ALICE);
        collection.transferFrom(ALICE, BOB, 1);
        vm.prank(BOB);
        collection.transferFrom(BOB, ALICE, 1);
        // Nonce/deadline are NOT advertised as proof of no ownership round trip.
        // A separate canonical Transfer-history guard must reject before submission.
        require(progression.trainingReviewStateHash(1) == r.stateHash);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
        require(progression.learnedLevel(1, skill) == 1);
    }

    function testFuzzNonOwnerCannotApplyReview(address caller) public {
        if (caller == ALICE) return;
        GoghReviewedSkillProgression.TrainingReview memory r =
            _review(GoghReviewedSkillProgression.Operation.LEARN);
        vm.expectRevert(GoghSkillProgression.NotCurrentOwner.selector);
        vm.prank(caller);
        progression.applyTrainingReview(r);
        require(progression.trainingCredits(1) == 1 && progression.trainingReviewNonce(1) == 0);
    }

    function testInvalidUnusedArgumentsCannotHideAnotherAction() public {
        GoghReviewedSkillProgression.TrainingReview memory r =
            _review(GoghReviewedSkillProgression.Operation.LEARN);
        r.slot = 1;
        vm.expectRevert(GoghReviewedSkillProgression.InvalidReviewArguments.selector);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
        r.slot = 0;
        r.rarityProof = new bytes32[](1);
        vm.expectRevert(GoghReviewedSkillProgression.InvalidReviewArguments.selector);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
    }

    function testStateHashBindsChainContractAndOriginalToken() public {
        GoghReviewedSkillProgression.TrainingReview memory r =
            _review(GoghReviewedSkillProgression.Operation.LEARN);
        vm.chainId(4663);
        vm.expectRevert(GoghReviewedSkillProgression.ReviewStateChanged.selector);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
        vm.chainId(31_337);
        r.tokenId = 3;
        vm.expectRevert(GoghReviewedSkillProgression.ReviewStateChanged.selector);
        vm.prank(ALICE);
        progression.applyTrainingReview(r);
        require(progression.trainingReviewNonce(1) == 0 && progression.trainingCredits(1) == 1);

        LocalSkillTrainingSource secondSource = new LocalSkillTrainingSource(collection);
        GoghReviewedSkillProgression second = new GoghReviewedSkillProgression(
            address(collection),
            address(registry),
            address(secondSource),
            progression.allocationRoot(),
            SNAPSHOT
        );
        secondSource.bind(second);
        vm.prank(ALICE);
        collection.approve(address(secondSource), 4);
        vm.prank(ALICE);
        secondSource.sacrifice(4, 1);
        require(second.trainingCredits(1) == progression.trainingCredits(1));
        r = _review(GoghReviewedSkillProgression.Operation.LEARN);
        vm.expectRevert(GoghReviewedSkillProgression.ReviewStateChanged.selector);
        vm.prank(ALICE);
        second.applyTrainingReview(r);
    }

    function testTrainingCallCannotAcceptEth() public {
        GoghReviewedSkillProgression.TrainingReview memory r =
            _review(GoghReviewedSkillProgression.Operation.LEARN);
        vm.deal(ALICE, 1);
        vm.prank(ALICE);
        (bool success,) = address(progression).call{ value: 1 }(
            abi.encodeCall(GoghReviewedSkillProgression.applyTrainingReview, (r))
        );
        require(!success && address(progression).balance == 0);
        require(progression.trainingCredits(1) == 1 && progression.trainingReviewNonce(1) == 0);
    }
}
