// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghReviewedBurnSource } from "../src/GoghReviewedBurnSource.sol";
import { GoghReviewedSkillProgression } from "../src/GoghReviewedSkillProgression.sol";
import { GoghSkillRegistry } from "../src/GoghSkillRegistry.sol";
import { GoghForgeSupplyPolicy } from "../src/GoghForgeSupplyPolicy.sol";
import { LocalBurnPunks } from "./mocks/LocalReviewedBurn.sol";
import { TestVm } from "./mocks/TestInfrastructure.sol";

contract GoghReviewedBurnSourceTest {
    TestVm private constant VM = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant OPERATOR = address(0x0F);
    LocalBurnPunks private punks;
    GoghReviewedBurnSource private source;
    GoghReviewedSkillProgression private progression;
    GoghSkillRegistry private registry;

    function setUp() public {
        VM.chainId(31_337);
        VM.warp(1_800_000_000);
        punks = new LocalBurnPunks();
        source = new GoghReviewedBurnSource(address(punks));
        registry = new GoghSkillRegistry(address(this));
        progression = new GoghReviewedSkillProgression(
            address(punks),
            address(registry),
            address(source),
            keccak256("root"),
            keccak256("snapshot")
        );
        source.bindProgression(address(progression));
        for (uint256 start = 1; start < 1121; start += 100) {
            uint256 count = 1121 - start;
            punks.mintReserve(ALICE, start, count > 100 ? 100 : count);
        }
        VM.prank(ALICE);
        punks.approve(address(source), 7);
    }

    function _review() private view returns (GoghReviewedBurnSource.BurnReview memory) {
        return GoghReviewedBurnSource.BurnReview({
            sourceTokenId: 7,
            targetTokenId: 44,
            nonce: source.burnReviewNonce(7),
            stateHash: source.burnReviewStateHash(7, 44),
            deadline: uint64(block.timestamp + 60)
        });
    }

    function _apply(GoghReviewedBurnSource.BurnReview memory review) private {
        VM.prank(ALICE);
        source.applyBurnReview(review);
    }

    function _unburned() private view {
        require(punks.ownerOf(7) == ALICE && progression.trainingCredits(44) == 0);
        require(source.burnReviewNonce(7) == 0 && !progression.sacrificeCredited(7));
    }

    function testOwnerBurnAwardsOneCreditAndCannotReplay() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        _apply(r);
        require(punks.totalSupply() == 1119 && punks.ownerOf(44) == ALICE);
        require(progression.trainingCredits(44) == 1 && progression.sacrificeCredited(7));
        require(source.burnReviewNonce(7) == 1 && progression.learnedCount(44) == 0);
        VM.expectRevert();
        punks.ownerOf(7);
        VM.expectRevert();
        _apply(r);
        require(progression.trainingCredits(44) == 1);
    }

    function testApprovalAloneAndAnApprovedOperatorCannotBurn() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        VM.prank(ALICE);
        punks.setApprovalForAll(OPERATOR, true);
        VM.expectRevert(GoghReviewedBurnSource.NotCurrentOwner.selector);
        VM.prank(OPERATOR);
        source.applyBurnReview(r);
        _unburned();
    }

    function testOperatorWideApprovalIsRejectedEvenAlongsideExactApproval() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        VM.prank(ALICE);
        punks.setApprovalForAll(address(source), true);
        VM.expectRevert(GoghReviewedBurnSource.TokenSpecificApprovalRequired.selector);
        _apply(r);
        _unburned();
    }

    function testRevokedApprovalRollsBackEverything() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        VM.prank(ALICE);
        punks.approve(address(0), 7);
        VM.expectRevert(GoghReviewedBurnSource.TokenSpecificApprovalRequired.selector);
        _apply(r);
        _unburned();
    }

    function testSourceTransferRoundTripClearsApproval() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        VM.prank(ALICE);
        punks.transferFrom(ALICE, BOB, 7);
        VM.prank(BOB);
        punks.transferFrom(BOB, ALICE, 7);
        VM.expectRevert(GoghReviewedBurnSource.TokenSpecificApprovalRequired.selector);
        _apply(r);
        _unburned();
    }

    function testRecipientTransferRequiresFreshCurrentOwner() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        VM.prank(ALICE);
        punks.transferFrom(ALICE, BOB, 44);
        VM.expectRevert(GoghReviewedBurnSource.NotCurrentOwner.selector);
        _apply(r);
        _unburned();
    }

    function testDocumentsOriginalRecipientRoundTripRequiresTransferLogGuard() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        VM.prank(ALICE);
        punks.transferFrom(ALICE, BOB, 44);
        VM.prank(BOB);
        punks.transferFrom(BOB, ALICE, 44);
        // Production has no ownershipEpoch method. Do not claim the mock's epoch as a safeguard.
        require(source.burnReviewStateHash(7, 44) == r.stateHash);
        _apply(r);
        require(progression.trainingCredits(44) == 1);
    }

    function testExpiredAndOverlongReviewsFailWithoutConsumption() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        ++r.deadline;
        VM.expectRevert(GoghReviewedBurnSource.ReviewDeadlineTooFar.selector);
        _apply(r);
        --r.deadline;
        VM.warp(r.deadline + 1);
        VM.expectRevert(GoghReviewedBurnSource.ReviewExpired.selector);
        _apply(r);
        _unburned();
    }

    function testExactDeadlineAndFloorBoundarySucceed() public {
        for (uint256 id = 1000; id < 1008; ++id) {
            VM.prank(ALICE);
            punks.burn(id);
        }
        require(punks.totalSupply() == 1112);
        GoghReviewedBurnSource.BurnReview memory r = _review();
        VM.warp(r.deadline);
        _apply(r);
        require(punks.totalSupply() == 1111 && progression.trainingCredits(44) == 1);
    }

    function testFloorCannotBeOverriddenByReview() public {
        for (uint256 id = 1000; id < 1009; ++id) {
            VM.prank(ALICE);
            punks.burn(id);
        }
        GoghReviewedBurnSource.BurnReview memory r = _review();
        VM.expectRevert(GoghForgeSupplyPolicy.SupplyFloorReached.selector);
        _apply(r);
        _unburned();
    }

    function testCurrentOwnerCanInvalidateButOthersCannot() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        VM.expectRevert(GoghReviewedBurnSource.NotCurrentOwner.selector);
        VM.prank(BOB);
        source.invalidateBurnReviews(7);
        VM.prank(ALICE);
        source.invalidateBurnReviews(7);
        VM.expectRevert(GoghReviewedBurnSource.ReviewNonceChanged.selector);
        _apply(r);
        require(punks.ownerOf(7) == ALICE && progression.trainingCredits(44) == 0);
        _apply(_review());
        require(progression.trainingCredits(44) == 1);
    }

    function testSourceAndTargetTrainingChangesInvalidateBurnReview() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        VM.prank(ALICE);
        progression.invalidateTrainingReviews(7);
        VM.expectRevert(GoghReviewedBurnSource.ReviewStateChanged.selector);
        _apply(r);
        r = _review();
        VM.prank(ALICE);
        progression.invalidateTrainingReviews(44);
        VM.expectRevert(GoghReviewedBurnSource.ReviewStateChanged.selector);
        _apply(r);
        _unburned();
    }

    function testReviewBindsPairChainAndSupply() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        r.targetTokenId = 45;
        VM.expectRevert(GoghReviewedBurnSource.ReviewStateChanged.selector);
        _apply(r);
        r = _review();
        VM.chainId(4663);
        VM.expectRevert(GoghReviewedBurnSource.ReviewStateChanged.selector);
        _apply(r);
        VM.chainId(31_337);
        VM.prank(ALICE);
        punks.burn(1000);
        VM.expectRevert(GoghReviewedBurnSource.ReviewStateChanged.selector);
        _apply(r);
        _unburned();
    }

    function testSelfSacrificeAndUnmintedSourceFail() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        r.targetTokenId = 7;
        VM.expectRevert(GoghReviewedBurnSource.DistinctPunksRequired.selector);
        _apply(r);
        r = _review();
        r.sourceTokenId = 9999;
        VM.expectRevert();
        _apply(r);
        _unburned();
    }

    function testGlobalTrainingPauseStopsBurnAndPreservesCancellation() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        registry.setEmergencyControls(true, 0);
        VM.expectRevert(GoghReviewedBurnSource.TrainingPaused.selector);
        _apply(r);
        _unburned();
        VM.prank(ALICE);
        source.invalidateBurnReviews(7);
        require(source.burnReviewNonce(7) == 1);
    }

    function testPinnedCollectionRuntimeChangeRejectsBurn() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        VM.etch(address(punks), hex"00");
        VM.expectRevert(GoghReviewedBurnSource.RuntimeChanged.selector);
        _apply(r);
    }

    function testBindingRequiresCreatorMatchingSourceAndCanHappenOnlyOnce() public {
        GoghReviewedBurnSource other = new GoghReviewedBurnSource(address(punks));
        VM.expectRevert(GoghReviewedBurnSource.NotCurrentOwner.selector);
        VM.prank(BOB);
        other.bindProgression(address(progression));
        VM.expectRevert(GoghReviewedBurnSource.InvalidConfiguration.selector);
        other.bindProgression(address(progression));
        VM.expectRevert(GoghReviewedBurnSource.AlreadyBound.selector);
        source.bindProgression(address(progression));
    }

    function testBurnCannotAcceptEth() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        VM.deal(ALICE, 1);
        VM.prank(ALICE);
        (bool ok,) = address(source).call{ value: 1 }(abi.encodeCall(source.applyBurnReview, (r)));
        require(!ok && address(source).balance == 0);
        _unburned();
    }

    function testFuzzOnlyCurrentOwnerCanBurn(address caller) public {
        if (caller == ALICE) return;
        GoghReviewedBurnSource.BurnReview memory r = _review();
        VM.expectRevert(GoghReviewedBurnSource.NotCurrentOwner.selector);
        VM.prank(caller);
        source.applyBurnReview(r);
        _unburned();
    }
}
