// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghReviewedBurnSource } from "../src/GoghReviewedBurnSource.sol";
import { GoghReviewedSkillProgression } from "../src/GoghReviewedSkillProgression.sol";
import { GoghSkillRegistry } from "../src/GoghSkillRegistry.sol";
import { GoghForgeSupplyPolicy } from "../src/GoghForgeSupplyPolicy.sol";
import { LocalBurnPunks } from "./mocks/LocalReviewedBurn.sol";
import { TestVm } from "./mocks/TestInfrastructure.sol";

contract AdversarialBurnPunks is LocalBurnPunks {
    uint256 public mode;
    address public callback;
    bytes public payload;
    bytes4 public rejectedSelector;

    function configure(uint256 mode_, address callback_, bytes calldata payload_) external {
        mode = mode_;
        callback = callback_;
        payload = payload_;
    }

    function burn(uint256 tokenId) public override {
        if (mode == 1) return;
        if (mode == 2) {
            (bool ok, bytes memory result) = callback.call(payload);
            require(!ok && result.length >= 4, "CALLBACK_MUST_FAIL");
            rejectedSelector = bytes4(result);
        }
        super.burn(tokenId);
        if (mode == 3) _burn(1000);
    }
}

contract GoghReviewedBurnAdversarialTest {
    TestVm private constant VM = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ALICE = address(0xA11CE);
    AdversarialBurnPunks private punks;
    GoghReviewedBurnSource private source;
    GoghReviewedSkillProgression private progression;
    GoghSkillRegistry private registry;

    function setUp() public {
        VM.chainId(31_337);
        VM.warp(1_800_000_000);
        punks = new AdversarialBurnPunks();
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
        for (uint256 first = 1; first < 1121; first += 100) {
            uint256 count = 1121 - first;
            punks.mintReserve(ALICE, first, count > 100 ? 100 : count);
        }
        VM.prank(ALICE);
        punks.approve(address(source), 7);
    }

    function _review() private view returns (GoghReviewedBurnSource.BurnReview memory) {
        return GoghReviewedBurnSource.BurnReview(
            7, 44, 0, source.burnReviewStateHash(7, 44), uint64(block.timestamp + 60)
        );
    }

    function testReentrantBurnCannotIssueAnotherCredit() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        punks.configure(2, address(source), abi.encodeCall(source.applyBurnReview, (r)));
        VM.prank(ALICE);
        source.applyBurnReview(r);
        require(punks.rejectedSelector() == GoghReviewedBurnSource.BurnReentrancy.selector);
        require(progression.trainingCredits(44) == 1 && source.burnReviewNonce(7) == 1);
    }

    function testReentrantCancellationCannotMutateTheActiveReview() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        punks.configure(2, address(source), abi.encodeCall(source.invalidateBurnReviews, (7)));
        VM.prank(ALICE);
        source.applyBurnReview(r);
        require(punks.rejectedSelector() == GoghReviewedBurnSource.BurnReentrancy.selector);
        require(source.burnReviewNonce(7) == 1);
    }

    function testNoOpBurnNeverCreatesCredit() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        punks.configure(1, address(0), "");
        VM.expectRevert(GoghForgeSupplyPolicy.UnexpectedSupplyChange.selector);
        VM.prank(ALICE);
        source.applyBurnReview(r);
        require(punks.ownerOf(7) == ALICE && progression.trainingCredits(44) == 0);
        require(source.burnReviewNonce(7) == 0);
    }

    function testUnexpectedSecondBurnRollsBackBothNftsAndCredit() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        punks.configure(3, address(0), "");
        VM.expectRevert(GoghForgeSupplyPolicy.UnexpectedSupplyChange.selector);
        VM.prank(ALICE);
        source.applyBurnReview(r);
        require(punks.ownerOf(7) == ALICE && punks.ownerOf(1000) == ALICE);
        require(punks.totalSupply() == 1120 && progression.trainingCredits(44) == 0);
        require(source.burnReviewNonce(7) == 0);
    }

    function testProgressionRuntimeChangeRejectsBurn() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        VM.etch(address(progression), hex"00");
        VM.expectRevert(GoghReviewedBurnSource.RuntimeChanged.selector);
        VM.prank(ALICE);
        source.applyBurnReview(r);
        require(punks.ownerOf(7) == ALICE);
    }

    function testRegistryRuntimeChangeRejectsBurn() public {
        GoghReviewedBurnSource.BurnReview memory r = _review();
        VM.etch(address(registry), hex"00");
        VM.expectRevert(GoghReviewedBurnSource.RuntimeChanged.selector);
        VM.prank(ALICE);
        source.applyBurnReview(r);
        require(punks.ownerOf(7) == ALICE);
    }
}
