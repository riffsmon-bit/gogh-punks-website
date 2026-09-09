// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghSkillRegistry } from "../src/GoghSkillRegistry.sol";
import { GoghSkillProgression } from "../src/GoghSkillProgression.sol";
import { GoghRaritySkillProgression } from "../src/GoghRaritySkillProgression.sol";
import { SkillForgeMockPunks, LocalSkillTrainingSource } from "./GoghSkillForge.t.sol";
import { TestVm } from "./mocks/TestInfrastructure.sol";

contract GoghRaritySkillProgressionTest {
    TestVm private constant VM = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    bytes32 private constant SNAPSHOT = keccak256("LOCAL_FIXTURE_NOT_PRODUCTION_SNAPSHOT");
    SkillForgeMockPunks private collection;
    GoghSkillRegistry private registry;
    LocalSkillTrainingSource private source;
    GoghRaritySkillProgression private progression;

    function _leaf(uint256 id, uint8 slots) private view returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        keccak256("GOGH_RARITY_SLOTS_V1"),
                        uint256(31_337),
                        address(collection),
                        SNAPSHOT,
                        id,
                        slots
                    )
                )
            )
        );
    }

    function _pair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _proof() private view returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = _leaf(50, 1);
    }

    function setUp() public {
        VM.chainId(31_337);
        collection = new SkillForgeMockPunks();
        registry = new GoghSkillRegistry(address(this));
        source = new LocalSkillTrainingSource(collection);
        progression = new GoghRaritySkillProgression(
            address(collection),
            address(registry),
            address(source),
            _pair(_leaf(1, 3), _leaf(50, 1)),
            SNAPSHOT
        );
        source.bind(progression);
        for (uint256 id = 1; id <= 12; ++id) {
            collection.mint(ALICE, id);
        }
        collection.mint(BOB, 50);
    }

    function _credit(uint256 id) private {
        VM.prank(ALICE);
        collection.approve(address(source), id);
        VM.prank(ALICE);
        source.sacrifice(id, 1);
    }

    function testClaimIsPermanentCapacityNotCreditsOrCapabilities() public {
        require(progression.unlockedSlots(1) == 1);
        VM.prank(ALICE);
        progression.claimRaritySlots(1, 3, _proof());
        require(progression.unlockedSlots(1) == 3 && progression.slotCap() == 7);
        require(progression.creditsCreated() == 0 && progression.effectiveCapabilities(1) == 0);
        VM.prank(ALICE);
        collection.safeTransferFrom(ALICE, BOB, 1);
        require(progression.unlockedSlots(1) == 3 && progression.claimedStartingSlots(1) == 3);
        VM.expectRevert(GoghSkillProgression.NotCurrentOwner.selector);
        VM.prank(ALICE);
        progression.claimRaritySlots(1, 3, _proof());
        VM.expectRevert(GoghRaritySkillProgression.AlreadyClaimed.selector);
        VM.prank(BOB);
        progression.claimRaritySlots(1, 3, _proof());
    }

    function testClaimRequiredBeforePaidUnlockNoCreditLost() public {
        _credit(2);
        VM.expectRevert(GoghRaritySkillProgression.RarityClaimRequired.selector);
        VM.prank(ALICE);
        progression.unlockSlot(1);
        require(progression.trainingCredits(1) == 1 && progression.creditsSpent() == 0);
        VM.prank(ALICE);
        progression.claimRaritySlots(1, 3, _proof());
        VM.prank(ALICE);
        progression.unlockSlot(1);
        require(progression.unlockedSlots(1) == 4 && progression.creditsSpent() == 1);
    }

    function testFixedSevenSlotCapNeverConsumesExtraCredit() public {
        VM.prank(ALICE);
        progression.claimRaritySlots(1, 3, _proof());
        for (uint256 id = 2; id <= 6; ++id) {
            _credit(id);
        }
        for (uint256 i; i < 4; ++i) {
            VM.prank(ALICE);
            progression.unlockSlot(1);
        }
        require(progression.unlockedSlots(1) == 7 && progression.trainingCredits(1) == 1);
        VM.expectRevert(GoghSkillProgression.SlotUnavailable.selector);
        VM.prank(ALICE);
        progression.unlockSlot(1);
        require(progression.trainingCredits(1) == 1);
    }

    function testWrongTokenAmountOwnerAndProofRejected() public {
        VM.expectRevert(GoghSkillProgression.NotCurrentOwner.selector);
        VM.prank(BOB);
        progression.claimRaritySlots(1, 3, _proof());
        VM.expectRevert(GoghRaritySkillProgression.InvalidAllocation.selector);
        VM.prank(ALICE);
        progression.claimRaritySlots(1, 2, _proof());
        VM.expectRevert(GoghRaritySkillProgression.InvalidAllocation.selector);
        VM.prank(ALICE);
        progression.claimRaritySlots(2, 3, _proof());
        VM.expectRevert(GoghRaritySkillProgression.InvalidAllocation.selector);
        VM.prank(ALICE);
        progression.claimRaritySlots(1, 3, new bytes32[](0));
    }

    function testNewOwnerCanClaimButBurnedTokenCannot() public {
        VM.prank(ALICE);
        collection.transferFrom(ALICE, BOB, 1);
        VM.prank(BOB);
        progression.claimRaritySlots(1, 3, _proof());
        VM.prank(BOB);
        collection.burn(1);
        require(
            progression.claimedStartingSlots(1) == 3 && progression.effectiveCapabilities(1) == 0
        );
        VM.expectRevert();
        VM.prank(BOB);
        progression.claimRaritySlots(1, 3, _proof());
    }

    function testChainReplayRejected() public {
        VM.chainId(4663);
        VM.expectRevert(GoghRaritySkillProgression.InvalidAllocation.selector);
        VM.prank(ALICE);
        progression.claimRaritySlots(1, 3, _proof());
    }

    function testZeroRootAndSnapshotRejected() public {
        VM.expectRevert(GoghRaritySkillProgression.InvalidAllocation.selector);
        new GoghRaritySkillProgression(
            address(collection), address(registry), address(source), bytes32(0), SNAPSHOT
        );
        VM.expectRevert(GoghRaritySkillProgression.InvalidAllocation.selector);
        new GoghRaritySkillProgression(
            address(collection), address(registry), address(source), _leaf(1, 3), bytes32(0)
        );
    }

    function testFuzzWrongSlotCountRejected(uint8 slots) public {
        if (slots == 3) return;
        VM.expectRevert(GoghRaritySkillProgression.InvalidAllocation.selector);
        VM.prank(ALICE);
        progression.claimRaritySlots(1, slots, _proof());
    }
}
