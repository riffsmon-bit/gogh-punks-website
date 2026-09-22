// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghReviewedBurnSource } from "../src/GoghReviewedBurnSource.sol";
import { GoghReviewedSkillProgression } from "../src/GoghReviewedSkillProgression.sol";
import { GoghSkillRegistry } from "../src/GoghSkillRegistry.sol";
import { LocalBurnPunks, LocalBurnWallet } from "./mocks/LocalReviewedBurn.sol";
import { TestVm } from "./mocks/TestInfrastructure.sol";

/// @dev Regression evidence for a release BLOCKER, not a deployable safety fix.
/// Reproduces the production contract boundary with disposable chain state.
contract GoghHolderBurnBoundaryTest {
    TestVm private constant VM = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ALICE = address(0xA11CE);
    LocalBurnPunks private punks;
    GoghReviewedBurnSource private source;
    GoghReviewedSkillProgression private progression;

    function setUp() public {
        VM.chainId(31_337);
        VM.warp(1_800_000_000);
        punks = new LocalBurnPunks();
        source = new GoghReviewedBurnSource(address(punks));
        GoghSkillRegistry registry = new GoghSkillRegistry(address(this));
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
            nonce: 0,
            stateHash: source.burnReviewStateHash(7, 44),
            deadline: uint64(block.timestamp + 60)
        });
    }

    function testPendingNativeDepositDoesNotInvalidateExistingBurnAndBecomesStranded() public {
        LocalBurnWallet wallet = new LocalBurnWallet(punks, 7);
        GoghReviewedBurnSource.BurnReview memory review = _review();
        require(address(wallet).balance == 0);
        VM.deal(address(wallet), 1 ether);
        require(review.stateHash == source.burnReviewStateHash(7, 44));
        VM.prank(ALICE);
        source.applyBurnReview(review);
        require(progression.trainingCredits(44) == 1 && wallet.owner() == address(0));
        VM.expectRevert();
        VM.prank(ALICE);
        wallet.withdraw();
        require(address(wallet).balance == 1 ether);
    }

    function testUndeployedWalletCanAlreadyHaveAssetsAndCannotSupplySafeHistoryStart() public {
        address counterfactualWallet = address(0x771);
        GoghReviewedBurnSource.BurnReview memory review = _review();
        VM.deal(counterfactualWallet, 1 ether);
        require(counterfactualWallet.code.length == 0);
        require(review.stateHash == source.burnReviewStateHash(7, 44));
    }

    function testOrdinaryGuardWrapperCannotCallExistingBurnOnBehalfOfOwner() public {
        GoghReviewedBurnSource.BurnReview memory review = _review();
        VM.expectRevert(GoghReviewedBurnSource.NotCurrentOwner.selector);
        source.applyBurnReview(review);
        require(punks.ownerOf(7) == ALICE && progression.trainingCredits(44) == 0);
    }

    function testDifferentProtectedIssuerCannotGrantExistingImmutableCreditLedger() public {
        VM.expectRevert();
        progression.awardTrainingCredit(7, 44);
        require(
            progression.trainingSource() == address(source) && progression.trainingCredits(44) == 0
        );
    }
}
