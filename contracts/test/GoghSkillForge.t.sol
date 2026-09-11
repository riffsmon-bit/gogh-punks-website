// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { ERC721Burnable } from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import { GoghSkillRegistry } from "../src/GoghSkillRegistry.sol";
import { GoghSkillProgression } from "../src/GoghSkillProgression.sol";
import { TestVm } from "./mocks/TestInfrastructure.sol";

contract SkillForgeMockPunks is ERC721Burnable {
    constructor() ERC721("LOCAL ONLY", "TEST") { }

    function mint(address owner, uint256 id) external {
        _mint(owner, id);
    }
}

/// @dev TEST HARNESS ONLY. Bitflags represent mocked inventory, NOT a real asset attestor.
contract LocalSkillTrainingSource {
    SkillForgeMockPunks public immutable collection;
    address private immutable creator;
    GoghSkillProgression public progression;
    mapping(uint256 id => uint256 mask) public blockers;

    constructor(SkillForgeMockPunks collection_) {
        require(block.chainid == 31_337, "LOCAL_ONLY");
        collection = collection_;
        creator = msg.sender;
    }

    function bind(GoghSkillProgression progression_) external {
        require(msg.sender == creator && address(progression) == address(0));
        progression = progression_;
    }

    function setBlockers(uint256 id, uint256 mask) external {
        blockers[id] = mask;
    }

    function sacrifice(uint256 source, uint256 target) external {
        require(
            source != target && collection.ownerOf(source) == msg.sender
                && collection.ownerOf(target) == msg.sender,
            "OWN_BOTH"
        );
        require(blockers[source] == 0, "WALLET_UNSAFE");
        collection.burn(source);
        progression.awardTrainingCredit(source, target);
    }
}

contract GoghSkillForgeTest {
    TestVm private constant VM = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant MARKETPLACE = address(0xCAFE);
    SkillForgeMockPunks private collection;
    LocalSkillTrainingSource private source;
    GoghSkillRegistry private registry;
    GoghSkillProgression private progression;
    bytes32 private detective;
    bytes32 private hunter;

    function setUp() public {
        VM.chainId(31_337);
        collection = new SkillForgeMockPunks();
        registry = new GoghSkillRegistry(address(this));
        source = new LocalSkillTrainingSource(collection);
        // Four slots is an explicit TEST configuration, not the final production economy.
        progression =
            new GoghSkillProgression(address(collection), address(registry), address(source), 1, 4);
        source.bind(progression);
        for (uint256 i = 1; i <= 20; ++i) {
            collection.mint(ALICE, i);
        }
        collection.mint(BOB, 50);
        detective = _registerReady(3, 1, bytes32(0), 1);
        hunter = _registerReady(1, 1, bytes32(0), 2);
    }

    function _registerReady(uint32 id, uint16 version, bytes32 prerequisite, uint256 capabilities)
        private
        returns (bytes32 key)
    {
        key = registry.register(
            id,
            version,
            keccak256(abi.encode(id, version)),
            keccak256("LOCAL_TEST_INSTRUCTIONS"),
            prerequisite,
            capabilities,
            1
        );
        registry.setStatus(key, GoghSkillRegistry.Status.TESTING, bytes32(0));
        registry.setStatus(
            key, GoghSkillRegistry.Status.READY, keccak256("LOCAL_FIXTURE_EVIDENCE_NOT_PRODUCTION")
        );
    }

    function _credit(uint256 id) private {
        VM.prank(ALICE);
        collection.approve(address(source), id);
        VM.prank(ALICE);
        source.sacrifice(id, 1);
    }

    function _learn(bytes32 key, uint256 creditId) private {
        _credit(creditId);
        VM.prank(ALICE);
        progression.learnSkill(1, key);
    }

    function testCreditIsAtomicUniqueAndTokenBound() public {
        _credit(2);
        require(progression.trainingCredits(1) == 1 && progression.creditsCreated() == 1);
        VM.expectRevert();
        collection.ownerOf(2);
        VM.expectRevert();
        VM.prank(ALICE);
        source.sacrifice(2, 1);
        VM.prank(ALICE);
        collection.transferFrom(ALICE, BOB, 1);
        require(progression.trainingCredits(1) == 1);
        VM.expectRevert(GoghSkillProgression.NotCurrentOwner.selector);
        VM.prank(ALICE);
        progression.learnSkill(1, hunter);
        VM.prank(BOB);
        progression.learnSkill(1, hunter);
        require(progression.learnedLevel(1, hunter) == 1 && progression.trainingCredits(1) == 0);
    }

    function testCannotBurnSomeoneElseSelfOrWithoutApproval() public {
        VM.expectRevert();
        VM.prank(ALICE);
        source.sacrifice(50, 1);
        VM.expectRevert();
        VM.prank(ALICE);
        source.sacrifice(1, 1);
        VM.expectRevert();
        VM.prank(ALICE);
        source.sacrifice(2, 1);
        require(collection.ownerOf(2) == ALICE && progression.creditsCreated() == 0);
    }

    function testMockAssetAndUnresolvedStateBlockers() public {
        VM.prank(ALICE);
        collection.approve(address(source), 2);
        for (uint256 bit; bit < 7; ++bit) {
            source.setBlockers(2, 1 << bit);
            VM.expectRevert();
            VM.prank(ALICE);
            source.sacrifice(2, 1);
            require(collection.ownerOf(2) == ALICE && progression.creditsCreated() == 0);
        }
    }

    function testCreditFailureRollsBackBurn() public {
        VM.prank(address(source));
        progression.awardTrainingCredit(99, 1);
        collection.mint(ALICE, 99); // Deliberately corrupt harness chronology to force downstream replay failure.
        VM.prank(ALICE);
        collection.approve(address(source), 99);
        VM.expectRevert(GoghSkillProgression.InvalidSacrifice.selector);
        VM.prank(ALICE);
        source.sacrifice(99, 1);
        require(collection.ownerOf(99) == ALICE && progression.creditsCreated() == 1);
    }

    function testCreditCannotBeIssuedByOwnerOrGuardianAndCannotCreditLiveToken() public {
        VM.expectRevert(GoghSkillProgression.InvalidTrainingSource.selector);
        progression.awardTrainingCredit(2, 1);
        VM.expectRevert(GoghSkillProgression.InvalidTrainingSource.selector);
        VM.prank(ALICE);
        progression.awardTrainingCredit(2, 1);
        VM.expectRevert(GoghSkillProgression.InvalidSacrifice.selector);
        VM.prank(address(source));
        progression.awardTrainingCredit(2, 1);
    }

    function testOnlyReadySkillsAndSingleCreditSpend() public {
        bytes32 candidate = registry.register(
            4, 1, keccak256("candidate"), keccak256("instructions"), bytes32(0), 4, 0
        );
        _credit(2);
        VM.expectRevert(GoghSkillProgression.SkillUnavailable.selector);
        VM.prank(ALICE);
        progression.learnSkill(1, candidate);
        VM.prank(ALICE);
        progression.learnSkill(1, hunter);
        VM.expectRevert(GoghSkillProgression.NoCredit.selector);
        VM.prank(ALICE);
        progression.unlockSlot(1);
        VM.expectRevert(GoghSkillProgression.AlreadyLearned.selector);
        VM.prank(ALICE);
        progression.learnSkill(1, hunter);
        require(progression.creditsSpent() == 1 && progression.learnedCount(1) == 1);
    }

    function testLearnedButUnequippedDoesNotEnableCapability() public {
        _learn(hunter, 2);
        require(progression.effectiveCapabilities(1) == 0);
        VM.prank(ALICE);
        progression.equipSkill(1, 0, hunter);
        require(progression.effectiveCapabilities(1) == 2);
        VM.prank(ALICE);
        progression.unequipSkill(1, 0);
        require(
            progression.effectiveCapabilities(1) == 0 && progression.learnedLevel(1, hunter) == 1
        );
    }

    function testLockedUnlearnedDuplicateAndReplacementEquipment() public {
        VM.expectRevert(GoghSkillProgression.NotLearned.selector);
        VM.prank(ALICE);
        progression.equipSkill(1, 0, hunter);
        _learn(hunter, 2);
        _learn(detective, 3);
        VM.expectRevert(GoghSkillProgression.SlotUnavailable.selector);
        VM.prank(ALICE);
        progression.equipSkill(1, 1, hunter);
        VM.prank(ALICE);
        progression.equipSkill(1, 0, hunter);
        _credit(4);
        VM.prank(ALICE);
        progression.unlockSlot(1);
        VM.expectRevert(GoghSkillProgression.DuplicateEquipment.selector);
        VM.prank(ALICE);
        progression.equipSkill(1, 1, hunter);
        VM.prank(ALICE);
        progression.equipSkill(1, 0, detective);
        require(progression.effectiveCapabilities(1) == 1);
    }

    function testSlotsArePermanentAndCapped() public {
        for (uint256 id = 2; id <= 4; ++id) {
            _credit(id);
            VM.prank(ALICE);
            progression.unlockSlot(1);
        }
        _credit(5);
        VM.expectRevert(GoghSkillProgression.SlotUnavailable.selector);
        VM.prank(ALICE);
        progression.unlockSlot(1);
        require(progression.unlockedSlots(1) == 4 && progression.trainingCredits(1) == 1);
    }

    function testTransferPathsKeepProgressionAndChangeLoadoutOwner() public {
        _learn(hunter, 2);
        _credit(3);
        VM.prank(ALICE);
        progression.unlockSlot(1);
        VM.prank(ALICE);
        progression.equipSkill(1, 0, hunter);
        _credit(4);
        VM.prank(ALICE);
        collection.approve(MARKETPLACE, 1);
        VM.prank(MARKETPLACE);
        collection.safeTransferFrom(ALICE, BOB, 1);
        require(progression.learnedLevel(1, hunter) == 1 && progression.equipped(1, 0) == hunter);
        require(progression.unlockedSlots(1) == 2 && progression.trainingCredits(1) == 1);
        VM.expectRevert(GoghSkillProgression.NotCurrentOwner.selector);
        VM.prank(ALICE);
        progression.unequipSkill(1, 0);
        VM.prank(BOB);
        progression.unequipSkill(1, 0);
        VM.prank(BOB);
        collection.safeTransferFrom(BOB, ALICE, 1);
        VM.prank(ALICE);
        progression.equipSkill(1, 0, hunter);
    }

    function testDisableAndDeprecationPreserveHistory() public {
        _learn(hunter, 2);
        VM.prank(ALICE);
        progression.equipSkill(1, 0, hunter);
        registry.setDisabled(hunter, true);
        require(progression.effectiveCapabilities(1) == 0);
        registry.setDisabled(hunter, false);
        registry.setEmergencyControls(true, 0);
        require(progression.effectiveCapabilities(1) == 0);
        registry.setEmergencyControls(false, 2);
        require(progression.effectiveCapabilities(1) == 0);
        registry.setEmergencyControls(false, 0);
        require(progression.effectiveCapabilities(1) == 2);
        bytes32 next = _registerReady(1, 2, bytes32(0), 2);
        registry.deprecate(hunter, next);
        require(
            progression.effectiveCapabilities(1) == 0 && progression.learnedLevel(1, hunter) == 1
        );
        require(progression.equipped(1, 0) == hunter && progression.learnedLevel(1, next) == 0);
    }

    function testDirectTransferPreservesFullLoadoutAndNewOwnerAuthority() public {
        _assertTransferLifecycle(0);
    }

    function testSafeTransferPreservesFullLoadoutAndNewOwnerAuthority() public {
        _assertTransferLifecycle(1);
    }

    function testApprovedOperatorTransferPreservesFullLoadoutAndNewOwnerAuthority() public {
        _assertTransferLifecycle(2);
    }

    function _assertTransferLifecycle(uint8 route) private {
        _learn(hunter, 2);
        _learn(detective, 3);
        _credit(4);
        VM.prank(ALICE);
        progression.unlockSlot(1);
        VM.prank(ALICE);
        progression.equipSkill(1, 0, hunter);
        VM.prank(ALICE);
        progression.equipSkill(1, 1, detective);
        _credit(5);
        uint256 created = progression.creditsCreated();
        uint256 spent = progression.creditsSpent();
        if (route == 0) {
            VM.prank(ALICE);
            collection.transferFrom(ALICE, BOB, 1);
        } else if (route == 1) {
            VM.prank(ALICE);
            collection.safeTransferFrom(ALICE, BOB, 1);
        } else {
            VM.prank(ALICE);
            collection.setApprovalForAll(MARKETPLACE, true);
            VM.prank(MARKETPLACE);
            collection.safeTransferFrom(ALICE, BOB, 1);
        }
        require(collection.ownerOf(1) == BOB);
        require(progression.trainingCredits(1) == 1 && progression.unlockedSlots(1) == 2);
        require(progression.learnedCount(1) == 2);
        require(
            progression.learnedKeyAt(1, 0) == hunter && progression.learnedKeyAt(1, 1) == detective
        );
        require(
            progression.learnedLevel(1, hunter) == 1 && progression.learnedLevel(1, detective) == 1
        );
        require(progression.equipped(1, 0) == hunter && progression.equipped(1, 1) == detective);
        require(progression.effectiveCapabilities(1) == 3);
        require(progression.creditsCreated() == created && progression.creditsSpent() == spent);
        VM.expectRevert(GoghSkillProgression.NotCurrentOwner.selector);
        VM.prank(ALICE);
        progression.unlockSlot(1);
        VM.expectRevert(GoghSkillProgression.NotCurrentOwner.selector);
        VM.prank(ALICE);
        progression.unequipSkill(1, 0);
        VM.expectRevert(GoghSkillProgression.NotCurrentOwner.selector);
        VM.prank(MARKETPLACE);
        progression.unequipSkill(1, 0);
        VM.prank(BOB);
        progression.unequipSkill(1, 0);
        VM.expectRevert(GoghSkillProgression.NotCurrentOwner.selector);
        VM.prank(ALICE);
        progression.equipSkill(1, 0, hunter);
        VM.prank(BOB);
        progression.equipSkill(1, 0, hunter);
        VM.prank(BOB);
        progression.unlockSlot(1);
        require(progression.trainingCredits(1) == 0 && progression.unlockedSlots(1) == 3);
        require(progression.creditsSpent() == spent + 1);
    }

    function testPrerequisitesAndTransitiveEmergencyDisable() public {
        bytes32 child = _registerReady(8, 1, detective, 8);
        bytes32 grandchild = _registerReady(9, 1, child, 16);
        _credit(2);
        VM.expectRevert(GoghSkillProgression.PrerequisiteMissing.selector);
        VM.prank(ALICE);
        progression.learnSkill(1, child);
        VM.prank(ALICE);
        progression.learnSkill(1, detective);
        _learn(child, 3);
        _learn(grandchild, 4);
        VM.prank(ALICE);
        progression.equipSkill(1, 0, grandchild);
        require(progression.effectiveCapabilities(1) == 16);
        registry.setDisabled(detective, true);
        require(progression.effectiveCapabilities(1) == 0);
    }

    function testRegistryVersionsAreImmutableAndReadyNeedsEvidence() public {
        VM.expectRevert(GoghSkillRegistry.AlreadyRegistered.selector);
        registry.register(1, 1, keccak256("changed"), keccak256("new"), bytes32(0), 128, 3);
        bytes32 candidate =
            registry.register(5, 1, keccak256("new"), keccak256("instructions"), bytes32(0), 4, 1);
        VM.expectRevert(GoghSkillRegistry.InvalidTransition.selector);
        registry.setStatus(candidate, GoghSkillRegistry.Status.READY, keccak256("fake"));
        registry.setStatus(candidate, GoghSkillRegistry.Status.TESTING, bytes32(0));
        VM.expectRevert(GoghSkillRegistry.InvalidTransition.selector);
        registry.setStatus(candidate, GoghSkillRegistry.Status.READY, bytes32(0));
    }

    function testBurnedParentHasNoEffectiveCapabilities() public {
        _learn(hunter, 2);
        VM.prank(ALICE);
        progression.equipSkill(1, 0, hunter);
        VM.prank(ALICE);
        collection.burn(1);
        require(
            progression.effectiveCapabilities(1) == 0 && progression.learnedLevel(1, hunter) == 1
        );
    }

    function testLocalSourceCannotDeployOnRobinhood() public {
        VM.chainId(4663);
        VM.expectRevert();
        new LocalSkillTrainingSource(collection);
    }

    function testFuzzUnauthorizedOwnerCannotEquip(address attacker) public {
        if (attacker == ALICE) return;
        _learn(hunter, 2);
        VM.expectRevert(GoghSkillProgression.NotCurrentOwner.selector);
        VM.prank(attacker);
        progression.equipSkill(1, 0, hunter);
        require(progression.effectiveCapabilities(1) == 0);
    }
}
