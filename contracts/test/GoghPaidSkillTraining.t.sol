// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghPaidSkillTraining } from "../src/GoghPaidSkillTraining.sol";
import { GoghReviewedSkillProgression } from "../src/GoghReviewedSkillProgression.sol";
import { GoghSkillRegistry } from "../src/GoghSkillRegistry.sol";
import { SkillForgeMockPunks, LocalSkillTrainingSource } from "./GoghSkillForge.t.sol";
import { TestVm } from "./mocks/TestInfrastructure.sol";

interface PaidLogVm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

contract PaidTrainingTestTreasury {
    address public target;
    bytes[] private payloads;
    bool public rejectPayment;
    uint256 public attempted;
    uint256 public succeeded;
    uint256 public guardedFailures;

    function configure(address target_, bytes[] memory payloads_, bool reject_) external {
        target = target_;
        payloads = payloads_;
        rejectPayment = reject_;
    }

    receive() external payable {
        require(!rejectPayment, "TEST_REJECT_PAYMENT");
        for (uint256 i; i < payloads.length; ++i) {
            ++attempted;
            (bool ok, bytes memory result) = target.call(payloads[i]);
            if (ok) {
                ++succeeded;
            } else if (
                result.length >= 4
                    && bytes4(result) == GoghPaidSkillTraining.ReviewReentrancy.selector
            ) {
                ++guardedFailures;
            }
        }
    }
}

contract PaidTrainingBadSlots {
    address public immutable collection;
    address public immutable registry;
    uint8 public constant baseSlots = 1;
    uint8 public constant slotCap = 6;
    uint64 public constant MAX_REVIEW_LIFETIME = 60;
    uint256 public constant allocationChainId = 31_337;

    constructor(address c, address r) {
        collection = c;
        registry = r;
    }
}

contract GoghPaidSkillTrainingTest {
    TestVm private constant vm = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    PaidLogVm private constant logsVm = PaidLogVm(address(vm));
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    uint256 private constant PRICE = 500_000_000_000_000;
    bytes32 private constant SNAPSHOT = keccak256("PAID_TRAINING_DISPOSABLE_RARITY");
    SkillForgeMockPunks private collection;
    LocalSkillTrainingSource private source;
    GoghSkillRegistry private registry;
    GoghReviewedSkillProgression private legacy;
    GoghPaidSkillTraining private paid;
    PaidTrainingTestTreasury private treasury;
    bytes32 private detective;
    bytes32 private rarity;
    bytes32 private reader;
    bytes32 private financial;
    bytes32 private mixed;
    bytes32 private risky;
    bytes32 private dependent;
    bytes32 private unlisted;
    uint256 private nextSacrifice = 100;

    function setUp() public {
        vm.chainId(31_337);
        vm.warp(1_800_000_000);
        vm.deal(ALICE, 10 ether);
        vm.deal(BOB, 10 ether);
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
        legacy = new GoghReviewedSkillProgression(
            address(collection), address(registry), address(source), leaf, SNAPSHOT
        );
        source.bind(legacy);
        collection.mint(ALICE, 1);
        collection.mint(BOB, 2);
        detective = _register(1, 1, 0, bytes32(0));
        rarity = _register(2, 8, 0, bytes32(0));
        reader = _register(3, 205, 0, bytes32(0));
        financial = _register(4, 2, 0, bytes32(0));
        mixed = _register(5, 257, 0, bytes32(0));
        risky = _register(6, 1, 1, bytes32(0));
        dependent = _register(7, 4, 0, detective);
        unlisted = _register(8, 4, 0, bytes32(0));
        treasury = new PaidTrainingTestTreasury();
        paid = new GoghPaidSkillTraining(_config(), _keys());
    }

    function _register(uint32 id, uint256 capabilities, uint8 risk, bytes32 prerequisite)
        private
        returns (bytes32 key)
    {
        key = registry.register(
            id,
            1,
            keccak256(abi.encode(id)),
            keccak256("TEST_INSTRUCTIONS"),
            prerequisite,
            capabilities,
            risk
        );
        registry.setStatus(key, GoghSkillRegistry.Status.TESTING, bytes32(0));
        registry.setStatus(key, GoghSkillRegistry.Status.READY, keccak256("TEST_EVIDENCE"));
    }

    function _config() private view returns (GoghPaidSkillTraining.Configuration memory) {
        return GoghPaidSkillTraining.Configuration({
            chainId: 31_337,
            collection: address(collection),
            registry: address(registry),
            legacyProgression: address(legacy),
            treasury: payable(address(treasury)),
            guardian: address(this),
            collectionCodeHash: address(collection).codehash,
            registryCodeHash: address(registry).codehash,
            legacyProgressionCodeHash: address(legacy).codehash
        });
    }

    function _keys() private view returns (bytes32[] memory keys) {
        keys = new bytes32[](3);
        keys[0] = detective;
        keys[1] = rarity;
        keys[2] = reader;
    }

    function _review(GoghPaidSkillTraining.Operation operation, bytes32 key, uint8 slot)
        private
        view
        returns (GoghPaidSkillTraining.Review memory)
    {
        return GoghPaidSkillTraining.Review({
            tokenId: 1,
            operation: operation,
            skillKey: key,
            slot: slot,
            nonce: paid.reviewNonce(1),
            stateHash: paid.reviewStateHash(1),
            deadline: uint64(block.timestamp + 60)
        });
    }

    function _apply(GoghPaidSkillTraining.Operation operation, bytes32 key, uint8 slot) private {
        GoghPaidSkillTraining.Review memory r = _review(operation, key, slot);
        address holder = collection.ownerOf(1);
        vm.prank(holder);
        paid.applyReview{ value: operation == GoghPaidSkillTraining.Operation.BUY ? PRICE : 0 }(r);
    }

    function _buy() private {
        if (paid.purchasesPaused()) paid.setPurchasesPaused(false);
        _apply(GoghPaidSkillTraining.Operation.BUY, bytes32(0), 0);
    }

    function _activate() private {
        _apply(GoghPaidSkillTraining.Operation.ACTIVATE, bytes32(0), 0);
    }

    function _burnCredit() private {
        address holder = collection.ownerOf(1);
        uint256 id = nextSacrifice++;
        collection.mint(holder, id);
        vm.prank(holder);
        collection.approve(address(source), id);
        vm.prank(holder);
        source.sacrifice(id, 1);
    }

    function _legacyReview(
        GoghReviewedSkillProgression.Operation operation,
        bytes32 key,
        uint8 slot
    ) private view returns (GoghReviewedSkillProgression.TrainingReview memory r) {
        r.tokenId = 1;
        r.operation = operation;
        r.skillKey = key;
        r.slot = slot;
        r.nonce = legacy.trainingReviewNonce(1);
        r.stateHash = legacy.trainingReviewStateHash(1);
        r.deadline = uint64(block.timestamp + 60);
        r.rarityProof = new bytes32[](0);
        if (operation == GoghReviewedSkillProgression.Operation.CLAIM_RARITY) r.startingSlots = 2;
    }

    function _legacyApply(GoghReviewedSkillProgression.Operation operation, bytes32 key, uint8 slot)
        private
    {
        GoghReviewedSkillProgression.TrainingReview memory r = _legacyReview(operation, key, slot);
        address holder = collection.ownerOf(1);
        vm.prank(holder);
        legacy.applyTrainingReview(r);
    }

    function testExactInterfacePriceAndPausedDeployment() public {
        require(paid.creditPriceWei() == PRICE && paid.purchasesPaused());
        require(paid.treasury() == address(treasury) && paid.owner() == address(this));
        require(paid.allowedSkill(detective) && !paid.allowedSkill(financial));
        require(
            GoghPaidSkillTraining.applyReview.selector
                == bytes4(
                    keccak256("applyReview((uint256,uint8,bytes32,uint8,uint256,bytes32,uint64))")
                )
        );
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.PurchasesPaused.selector);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        require(paid.purchasedCredits(1) == 0 && paid.reviewNonce(1) == 0);
    }

    function testBuyForwardsExactEthAndCreatesExactlyOneSeparateCreditWithReceiptEvent() public {
        paid.setPurchasesPaused(false);
        logsVm.recordLogs();
        _apply(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        PaidLogVm.Log[] memory entries = logsVm.getRecordedLogs();
        bytes32 signature = keccak256("PaidTrainingReviewApplied(uint256,uint256,uint8)");
        uint256 reviews;
        for (uint256 i; i < entries.length; ++i) {
            if (entries[i].emitter == address(paid) && entries[i].topics[0] == signature) {
                ++reviews;
                require(
                    entries[i].topics.length == 3 && entries[i].topics[1] == bytes32(uint256(1))
                        && entries[i].topics[2] == 0 && abi.decode(entries[i].data, (uint8)) == 0
                );
            }
        }
        require(reviews == 1 && paid.purchasedCredits(1) == 1 && paid.reviewNonce(1) == 1);
        require(address(treasury).balance == PRICE && address(paid).balance == 0);
        require(legacy.trainingCredits(1) == 0 && legacy.creditsCreated() == 0);
        require(
            !paid.activated(1) && paid.learnedLevel(1, detective) == 0
                && paid.effectiveCapabilities(1) == 0
        );
    }

    function testUnderpaymentOverpaymentAndValueOnFreeOperationRevert() public {
        paid.setPurchasesPaused(false);
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.IncorrectPayment.selector);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE - 1 }(r);
        vm.expectRevert(GoghPaidSkillTraining.IncorrectPayment.selector);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE + 1 }(r);
        r = _review(GoghPaidSkillTraining.Operation.ACTIVATE, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.IncorrectPayment.selector);
        vm.prank(ALICE);
        paid.applyReview{ value: 1 }(r);
        require(
            paid.reviewNonce(1) == 0 && paid.purchasedCredits(1) == 0
                && address(treasury).balance == 0
        );
    }

    function testBurnTokenApprovalBlocksPurchaseUntilRevoked() public {
        paid.setPurchasesPaused(false);
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        vm.prank(ALICE);
        collection.approve(address(source), 1);
        vm.expectRevert(GoghPaidSkillTraining.BurnApprovalActive.selector);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        require(paid.purchasedCredits(1) == 0 && paid.reviewNonce(1) == 0);
        require(address(treasury).balance == 0 && collection.ownerOf(1) == ALICE);
        vm.prank(ALICE);
        collection.approve(address(0), 1);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        require(paid.purchasedCredits(1) == 1 && collection.ownerOf(1) == ALICE);
    }

    function testBurnOperatorApprovalBlocksPurchaseUntilRevoked() public {
        paid.setPurchasesPaused(false);
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        vm.prank(ALICE);
        collection.setApprovalForAll(address(source), true);
        vm.expectRevert(GoghPaidSkillTraining.BurnApprovalActive.selector);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        require(paid.purchasedCredits(1) == 0 && paid.reviewNonce(1) == 0);
        vm.prank(ALICE);
        collection.setApprovalForAll(address(source), false);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        require(paid.purchasedCredits(1) == 1 && collection.ownerOf(1) == ALICE);
    }

    function testUnrelatedTokenAndOperatorApprovalsDoNotBlockPurchase() public {
        vm.prank(ALICE);
        collection.approve(BOB, 1);
        vm.prank(ALICE);
        collection.setApprovalForAll(BOB, true);
        _buy();
        require(paid.purchasedCredits(1) == 1 && collection.ownerOf(1) == ALICE);
        require(collection.getApproved(1) == BOB && collection.isApprovedForAll(ALICE, BOB));
        require(!collection.isApprovedForAll(ALICE, address(source)));
    }

    function testTreasuryCannotApproveBurnSourceWhileAcceptingPurchase() public {
        paid.setPurchasesPaused(false);
        vm.prank(ALICE);
        collection.setApprovalForAll(address(treasury), true);
        bytes[] memory payloads = new bytes[](1);
        payloads[0] = abi.encodeCall(collection.approve, (address(source), 1));
        treasury.configure(address(collection), payloads, false);
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.BurnApprovalActive.selector);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        require(paid.purchasedCredits(1) == 0 && paid.reviewNonce(1) == 0);
        require(collection.getApproved(1) == address(0) && collection.ownerOf(1) == ALICE);
        require(address(treasury).balance == 0 && treasury.attempted() == 0);
    }

    function testRejectedTreasuryRevertsPaymentCreditNonceAndCanRetrySameReview() public {
        paid.setPurchasesPaused(false);
        treasury.configure(address(0), new bytes[](0), true);
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.TreasuryTransferFailed.selector);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        require(
            paid.reviewNonce(1) == 0 && paid.purchasedCredits(1) == 0
                && address(treasury).balance == 0 && address(paid).balance == 0
        );
        treasury.configure(address(0), new bytes[](0), false);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        require(paid.reviewNonce(1) == 1 && paid.purchasedCredits(1) == 1);
    }

    function testEveryHolderOperationRejectsTreasuryReentrancy() public {
        paid.setPurchasesPaused(false);
        bytes[] memory payloads = new bytes[](6);
        for (uint8 i; i < 6; ++i) {
            GoghPaidSkillTraining.Review memory r =
                _review(GoghPaidSkillTraining.Operation(i), 0, 0);
            payloads[i] = abi.encodeCall(paid.applyReview, (r));
        }
        treasury.configure(address(paid), payloads, false);
        _apply(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        require(
            treasury.attempted() == 6 && treasury.guardedFailures() == 6
                && treasury.succeeded() == 0
        );
        require(paid.purchasedCredits(1) == 1 && paid.reviewNonce(1) == 1 && !paid.activated(1));
    }

    function testTreasuryCannotTransferPunkDuringPurchase() public {
        paid.setPurchasesPaused(false);
        vm.prank(ALICE);
        collection.approve(address(treasury), 1);
        bytes[] memory payloads = new bytes[](1);
        payloads[0] = abi.encodeCall(collection.transferFrom, (ALICE, BOB, 1));
        treasury.configure(address(collection), payloads, false);
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.NotCurrentOwner.selector);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        require(
            collection.ownerOf(1) == ALICE && paid.purchasedCredits(1) == 0
                && paid.reviewNonce(1) == 0
        );
        require(address(treasury).balance == 0 && treasury.attempted() == 0);
    }

    function testTreasuryCannotMutateReviewedLegacyStateDuringPurchase() public {
        vm.prank(ALICE);
        collection.transferFrom(ALICE, address(treasury), 1);
        vm.deal(address(treasury), PRICE);
        paid.setPurchasesPaused(false);
        bytes[] memory payloads = new bytes[](1);
        payloads[0] = abi.encodeCall(
            legacy.applyTrainingReview,
            (_legacyReview(GoghReviewedSkillProgression.Operation.CLAIM_RARITY, 0, 0))
        );
        treasury.configure(address(legacy), payloads, false);
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.ReviewStateChanged.selector);
        vm.prank(address(treasury));
        paid.applyReview{ value: PRICE }(r);
        require(
            paid.purchasedCredits(1) == 0 && paid.reviewNonce(1) == 0
                && legacy.claimedStartingSlots(1) == 0 && legacy.trainingReviewNonce(1) == 0
        );
    }

    function testTreasuryCannotRemoveLastCreditUseDuringPurchase() public {
        registry.setDisabled(rarity, true);
        registry.setDisabled(reader, true);
        registry.transferOwnership(address(treasury));
        vm.prank(address(treasury));
        registry.acceptOwnership();
        paid.setPurchasesPaused(false);
        bytes[] memory payloads = new bytes[](1);
        payloads[0] = abi.encodeCall(registry.setDisabled, (detective, true));
        treasury.configure(address(registry), payloads, false);
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.NoCreditUseAvailable.selector);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        require(paid.purchasedCredits(1) == 0 && paid.reviewNonce(1) == 0);
        require(registry.available(detective) && address(treasury).balance == 0);
    }

    function testTreasuryCannotChangeReviewedRegistryPolicyDuringPurchase() public {
        registry.transferOwnership(address(treasury));
        vm.prank(address(treasury));
        registry.acceptOwnership();
        paid.setPurchasesPaused(false);
        bytes[] memory payloads = new bytes[](1);
        // Even a policy change outside the paid read-only mask invalidates this review.
        payloads[0] = abi.encodeCall(registry.setEmergencyControls, (false, 2));
        treasury.configure(address(registry), payloads, false);
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.ReviewStateChanged.selector);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        require(paid.purchasedCredits(1) == 0 && paid.reviewNonce(1) == 0);
        require(registry.disabledCapabilities() == 0 && address(treasury).balance == 0);
    }

    function testOnlyGuardianCanPauseAndPauseRoundTripInvalidatesReview() public {
        vm.expectRevert();
        vm.prank(ALICE);
        paid.setPurchasesPaused(false);
        paid.setPurchasesPaused(false);
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        paid.setPurchasesPaused(true);
        paid.setPurchasesPaused(false);
        vm.expectRevert(GoghPaidSkillTraining.ReviewStateChanged.selector);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        require(paid.reviewNonce(1) == 0);
    }

    function testPurchasePauseDoesNotTrapExistingPaidLearningOrLoadout() public {
        _buy();
        _activate();
        paid.setPurchasesPaused(true);
        _apply(GoghPaidSkillTraining.Operation.LEARN, detective, 0);
        _apply(GoghPaidSkillTraining.Operation.EQUIP, detective, 0);
        require(paid.effectiveCapabilities(1) == 1);
        _apply(GoghPaidSkillTraining.Operation.UNEQUIP, 0, 0);
        require(paid.effectiveCapabilities(1) == 0 && paid.learnedLevel(1, detective) == 1);
    }

    function testReplayWrongOwnerWrongChainAndChangedCodeFailClosed() public {
        paid.setPurchasesPaused(false);
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.NotCurrentOwner.selector);
        vm.prank(BOB);
        paid.applyReview{ value: PRICE }(r);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        vm.expectRevert(GoghPaidSkillTraining.ReviewNonceChanged.selector);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        r = _review(GoghPaidSkillTraining.Operation.ACTIVATE, 0, 0);
        vm.chainId(1);
        vm.expectRevert(GoghPaidSkillTraining.RuntimeChanged.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
        vm.chainId(31_337);
        vm.etch(address(legacy), hex"00");
        vm.expectRevert(GoghPaidSkillTraining.RuntimeChanged.selector);
        paid.effectiveCapabilities(1);
    }

    function testExpiredTooLongAndExactDeadline() public {
        GoghPaidSkillTraining.Review memory r =
            _review(GoghPaidSkillTraining.Operation.ACTIVATE, 0, 0);
        ++r.deadline;
        vm.expectRevert(GoghPaidSkillTraining.ReviewDeadlineTooFar.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
        --r.deadline;
        vm.warp(r.deadline + 1);
        vm.expectRevert(GoghPaidSkillTraining.ReviewExpired.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
        vm.warp(r.deadline);
        vm.prank(ALICE);
        paid.applyReview(r);
        require(paid.activated(1));
    }

    function testEveryActionRequiresItsExactArgumentsAndActivation() public {
        GoghPaidSkillTraining.Review memory r =
            _review(GoghPaidSkillTraining.Operation.ACTIVATE, detective, 0);
        vm.expectRevert(GoghPaidSkillTraining.InvalidReviewArguments.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
        r = _review(GoghPaidSkillTraining.Operation.LEARN, detective, 1);
        vm.expectRevert(GoghPaidSkillTraining.InvalidReviewArguments.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
        r = _review(GoghPaidSkillTraining.Operation.EQUIP, detective, 7);
        vm.expectRevert(GoghPaidSkillTraining.InvalidReviewArguments.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
        for (uint8 op = 2; op < 6; ++op) {
            r = _review(
                GoghPaidSkillTraining.Operation(op),
                (op == 2 || op == 4) ? detective : bytes32(0),
                0
            );
            vm.expectRevert(GoghPaidSkillTraining.ActivationRequired.selector);
            vm.prank(ALICE);
            paid.applyReview(r);
        }
    }

    function testLegacyCreditsNeverImportedOrSpentByPaidLearning() public {
        _burnCredit();
        _activate();
        GoghPaidSkillTraining.Review memory r =
            _review(GoghPaidSkillTraining.Operation.LEARN, detective, 0);
        vm.expectRevert(GoghPaidSkillTraining.NoPurchasedCredit.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
        _buy();
        _apply(GoghPaidSkillTraining.Operation.LEARN, detective, 0);
        require(
            paid.purchasedCredits(1) == 0 && legacy.trainingCredits(1) == 1
                && legacy.creditsSpent() == 0
        );
        require(paid.learnedLevel(1, detective) == 1 && legacy.learnedLevel(1, detective) == 0);
        _legacyApply(GoghReviewedSkillProgression.Operation.LEARN, rarity, 0);
        require(paid.learnedLevel(1, rarity) == 1 && legacy.trainingCredits(1) == 0);
    }

    function testPaidLearningRejectsExistingLegacyAndPaidSkillsWithoutSpending() public {
        _burnCredit();
        _legacyApply(GoghReviewedSkillProgression.Operation.LEARN, detective, 0);
        _buy();
        _activate();
        GoghPaidSkillTraining.Review memory r =
            _review(GoghPaidSkillTraining.Operation.LEARN, detective, 0);
        vm.expectRevert(GoghPaidSkillTraining.AlreadyLearned.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
        require(paid.purchasedCredits(1) == 1);
        _apply(GoghPaidSkillTraining.Operation.LEARN, rarity, 0);
        r = _review(GoghPaidSkillTraining.Operation.LEARN, rarity, 0);
        vm.expectRevert(GoghPaidSkillTraining.AlreadyLearned.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
        require(paid.purchasedCredits(1) == 0);
    }

    function testOriginalDirectDuplicateCreditWasteCannotDoubleCapabilities() public {
        _buy();
        _activate();
        _apply(GoghPaidSkillTraining.Operation.LEARN, detective, 0);
        _apply(GoghPaidSkillTraining.Operation.EQUIP, detective, 0);
        _burnCredit();
        _legacyApply(GoghReviewedSkillProgression.Operation.LEARN, detective, 0);
        _legacyApply(GoghReviewedSkillProgression.Operation.EQUIP, detective, 0);
        require(paid.effectiveCapabilities(1) == 1 && paid.learnedLevel(1, detective) == 1);
        _apply(GoghPaidSkillTraining.Operation.UNEQUIP, 0, 0);
        require(paid.effectiveCapabilities(1) == 0 && legacy.effectiveCapabilities(1) == 1);
    }

    function testActivationPreservesLegacyThenOnlyCanonicalLoadoutGrantsCapabilities() public {
        _burnCredit();
        _legacyApply(GoghReviewedSkillProgression.Operation.LEARN, detective, 0);
        _legacyApply(GoghReviewedSkillProgression.Operation.EQUIP, detective, 0);
        require(paid.equipped(1, 0) == detective && paid.effectiveCapabilities(1) == 1);
        _activate();
        require(paid.equipped(1, 0) == detective && paid.effectiveCapabilities(1) == 1);
        _legacyApply(GoghReviewedSkillProgression.Operation.UNEQUIP, 0, 0);
        require(paid.equipped(1, 0) == detective && paid.effectiveCapabilities(1) == 1);
        _apply(GoghPaidSkillTraining.Operation.UNEQUIP, 0, 0);
        _legacyApply(GoghReviewedSkillProgression.Operation.EQUIP, detective, 0);
        require(paid.effectiveCapabilities(1) == 0 && legacy.effectiveCapabilities(1) == 1);
        GoghPaidSkillTraining.Review memory r =
            _review(GoghPaidSkillTraining.Operation.ACTIVATE, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.AlreadyActivated.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
    }

    function testActivationRejectsFinancialLegacyLoadoutWithoutSilentlyChangingFallback() public {
        _burnCredit();
        _legacyApply(GoghReviewedSkillProgression.Operation.LEARN, financial, 0);
        _legacyApply(GoghReviewedSkillProgression.Operation.EQUIP, financial, 0);
        require(paid.effectiveCapabilities(1) == 2 && paid.equipped(1, 0) == financial);
        GoghPaidSkillTraining.Review memory r =
            _review(GoghPaidSkillTraining.Operation.ACTIVATE, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.UnsupportedLegacyLoadout.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
        require(!paid.activated(1) && paid.equipped(1, 0) == financial && paid.reviewNonce(1) == 0);
        _legacyApply(GoghReviewedSkillProgression.Operation.UNEQUIP, 0, 0);
        _activate();
        require(paid.effectiveCapabilities(1) == 0);
    }

    function testRejectedSkillClassesCannotSpendCreditOrEnterCanonicalLoadout() public {
        _buy();
        _activate();
        bytes32[5] memory rejected = [financial, mixed, risky, dependent, unlisted];
        for (uint256 i; i < rejected.length; ++i) {
            GoghPaidSkillTraining.Review memory r =
                _review(GoghPaidSkillTraining.Operation.LEARN, rejected[i], 0);
            vm.expectRevert(GoghPaidSkillTraining.SkillUnavailable.selector);
            vm.prank(ALICE);
            paid.applyReview(r);
        }
        require(paid.purchasedCredits(1) == 1 && paid.effectiveCapabilities(1) == 0);
    }

    function testRegistryDisablesPaidSkillAndGlobalPauseBlocksPurchaseButAllowsUnequip() public {
        _buy();
        _activate();
        _apply(GoghPaidSkillTraining.Operation.LEARN, detective, 0);
        _apply(GoghPaidSkillTraining.Operation.EQUIP, detective, 0);
        registry.setDisabled(detective, true);
        require(paid.effectiveCapabilities(1) == 0);
        registry.setDisabled(detective, false);
        require(paid.effectiveCapabilities(1) == 1);
        registry.setEmergencyControls(true, 0);
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.PurchasesPaused.selector);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        require(paid.effectiveCapabilities(1) == 0);
        _apply(GoghPaidSkillTraining.Operation.UNEQUIP, 0, 0);
        require(paid.equipped(1, 0) == bytes32(0));
    }

    function testLegacyCreditNonceSlotAndAllocationChangesInvalidatePreparedReview() public {
        GoghPaidSkillTraining.Review memory r =
            _review(GoghPaidSkillTraining.Operation.ACTIVATE, 0, 0);
        _burnCredit();
        _rejectStale(r);
        r = _review(GoghPaidSkillTraining.Operation.ACTIVATE, 0, 0);
        _legacyApply(GoghReviewedSkillProgression.Operation.CLAIM_RARITY, 0, 0);
        _rejectStale(r);
        r = _review(GoghPaidSkillTraining.Operation.ACTIVATE, 0, 0);
        _legacyApply(GoghReviewedSkillProgression.Operation.UNLOCK, 0, 0);
        _rejectStale(r);
        r = _review(GoghPaidSkillTraining.Operation.ACTIVATE, 0, 0);
        vm.prank(ALICE);
        legacy.invalidateTrainingReviews(1);
        _rejectStale(r);
    }

    function _rejectStale(GoghPaidSkillTraining.Review memory r) private {
        vm.expectRevert(GoghPaidSkillTraining.ReviewStateChanged.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
        require(!paid.activated(1) && paid.reviewNonce(1) == 0);
    }

    function testPurchaseGuardBoundsCreditsByCurrentlyUsableSkillsAndClaimedSlots() public {
        require(paid.remainingCreditUses(1) == 3);
        _buy();
        _buy();
        _buy();
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.NoCreditUseAvailable.selector);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        require(paid.purchasedCredits(1) == 3 && address(treasury).balance == 3 * PRICE);
        _legacyApply(GoghReviewedSkillProgression.Operation.CLAIM_RARITY, 0, 0);
        require(paid.remainingCreditUses(1) == 8);
        _buy();
        require(paid.purchasedCredits(1) == 4);
    }

    function testPurchaseGuardRejectsNoReadySkillsButAllowsUsableSlots() public {
        registry.setDisabled(detective, true);
        registry.setDisabled(rarity, true);
        registry.setDisabled(reader, true);
        paid.setPurchasesPaused(false);
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.NoCreditUseAvailable.selector);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        _legacyApply(GoghReviewedSkillProgression.Operation.CLAIM_RARITY, 0, 0);
        require(paid.remainingCreditUses(1) == 5);
        _buy();
        require(paid.purchasedCredits(1) == 1);
    }

    function testPaidUnlockNeedsRarityAndDynamicLegacySlotsNeverExceedSeven() public {
        _buy();
        _activate();
        GoghPaidSkillTraining.Review memory r =
            _review(GoghPaidSkillTraining.Operation.UNLOCK, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.RarityClaimRequired.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
        _legacyApply(GoghReviewedSkillProgression.Operation.CLAIM_RARITY, 0, 0);
        _apply(GoghPaidSkillTraining.Operation.UNLOCK, 0, 0);
        require(paid.unlockedSlots(1) == 3 && legacy.unlockedSlots(1) == 2);
        for (uint8 i; i < 5; ++i) {
            _burnCredit();
            _legacyApply(GoghReviewedSkillProgression.Operation.UNLOCK, 0, 0);
            require(paid.unlockedSlots(1) <= 7);
        }
        require(legacy.unlockedSlots(1) == 7 && paid.unlockedSlots(1) == 7);
        _buy();
        r = _review(GoghPaidSkillTraining.Operation.UNLOCK, 0, 0);
        vm.expectRevert(GoghPaidSkillTraining.SlotUnavailable.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
        require(paid.purchasedCredits(1) == 1);
    }

    function testEquipmentChecksLearnedDuplicateSlotsAndReadOnlyMask() public {
        _activate();
        GoghPaidSkillTraining.Review memory r =
            _review(GoghPaidSkillTraining.Operation.EQUIP, detective, 0);
        vm.expectRevert(GoghPaidSkillTraining.NotLearned.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
        _buy();
        _apply(GoghPaidSkillTraining.Operation.LEARN, reader, 0);
        _apply(GoghPaidSkillTraining.Operation.EQUIP, reader, 0);
        require(paid.effectiveCapabilities(1) == 205);
        _legacyApply(GoghReviewedSkillProgression.Operation.CLAIM_RARITY, 0, 0);
        r = _review(GoghPaidSkillTraining.Operation.EQUIP, reader, 1);
        vm.expectRevert(GoghPaidSkillTraining.DuplicateEquipment.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
        r = _review(GoghPaidSkillTraining.Operation.UNEQUIP, 0, 2);
        vm.expectRevert(GoghPaidSkillTraining.SlotUnavailable.selector);
        vm.prank(ALICE);
        paid.applyReview(r);
    }

    function testFuzzTransferPreservesPaidStateAndOnlyCurrentOwnerCanAct(uint8 route) public {
        _buy();
        _buy();
        _activate();
        _apply(GoghPaidSkillTraining.Operation.LEARN, detective, 0);
        _apply(GoghPaidSkillTraining.Operation.EQUIP, detective, 0);
        GoghPaidSkillTraining.Review memory old =
            _review(GoghPaidSkillTraining.Operation.UNEQUIP, 0, 0);
        if (route % 3 == 0) {
            vm.prank(ALICE);
            collection.transferFrom(ALICE, BOB, 1);
        } else if (route % 3 == 1) {
            vm.prank(ALICE);
            collection.safeTransferFrom(ALICE, BOB, 1);
        } else {
            vm.prank(ALICE);
            collection.approve(address(this), 1);
            collection.transferFrom(ALICE, BOB, 1);
        }
        require(
            paid.activated(1) && paid.purchasedCredits(1) == 1
                && paid.learnedLevel(1, detective) == 1
        );
        require(paid.equipped(1, 0) == detective && paid.effectiveCapabilities(1) == 1);
        vm.expectRevert(GoghPaidSkillTraining.NotCurrentOwner.selector);
        vm.prank(ALICE);
        paid.applyReview(old);
        vm.expectRevert(GoghPaidSkillTraining.ReviewStateChanged.selector);
        vm.prank(BOB);
        paid.applyReview(old);
        _apply(GoghPaidSkillTraining.Operation.UNEQUIP, 0, 0);
        require(paid.effectiveCapabilities(1) == 0);
    }

    function testBurnedPunkCannotPurchaseAndLosesEffectiveCapabilities() public {
        _buy();
        _activate();
        _apply(GoghPaidSkillTraining.Operation.LEARN, detective, 0);
        _apply(GoghPaidSkillTraining.Operation.EQUIP, detective, 0);
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        vm.prank(ALICE);
        collection.burn(1);
        require(paid.effectiveCapabilities(1) == 0);
        vm.expectRevert();
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
    }

    function testAwayAndBackPreservesHashAndRequiresOffchainTransferContinuity() public {
        paid.setPurchasesPaused(false);
        GoghPaidSkillTraining.Review memory r = _review(GoghPaidSkillTraining.Operation.BUY, 0, 0);
        vm.prank(ALICE);
        collection.transferFrom(ALICE, BOB, 1);
        require(paid.reviewStateHash(1) != r.stateHash);
        vm.prank(BOB);
        collection.transferFrom(BOB, ALICE, 1);
        // This is an explicit residual: immutable ownerOf has no ownership epoch.
        // The supported submit path must reject this review from canonical Transfer logs.
        require(paid.reviewStateHash(1) == r.stateHash && paid.reviewNonce(1) == r.nonce);
        vm.prank(ALICE);
        paid.applyReview{ value: PRICE }(r);
        require(paid.purchasedCredits(1) == 1);
    }

    function testConstructorRejectsMismatchedChainCodeIdentitySlotCapAndTreasury() public {
        GoghPaidSkillTraining.Configuration memory c = _config();
        bytes32[] memory keys = _keys();
        c.chainId = 4663;
        vm.expectRevert(GoghPaidSkillTraining.InvalidConfiguration.selector);
        new GoghPaidSkillTraining(c, keys);
        c = _config();
        c.legacyProgressionCodeHash = bytes32(uint256(1));
        vm.expectRevert(GoghPaidSkillTraining.InvalidConfiguration.selector);
        new GoghPaidSkillTraining(c, keys);
        c = _config();
        c.collectionCodeHash = bytes32(uint256(1));
        vm.expectRevert(GoghPaidSkillTraining.InvalidConfiguration.selector);
        new GoghPaidSkillTraining(c, keys);
        c = _config();
        c.treasury = payable(address(0));
        vm.expectRevert(GoghPaidSkillTraining.InvalidConfiguration.selector);
        new GoghPaidSkillTraining(c, keys);
        c = _config();
        GoghSkillRegistry other = new GoghSkillRegistry(address(this));
        c.registry = address(other);
        c.registryCodeHash = address(other).codehash;
        vm.expectRevert(GoghPaidSkillTraining.InvalidConfiguration.selector);
        new GoghPaidSkillTraining(c, keys);
        c = _config();
        PaidTrainingBadSlots bad = new PaidTrainingBadSlots(address(collection), address(registry));
        c.legacyProgression = address(bad);
        c.legacyProgressionCodeHash = address(bad).codehash;
        vm.expectRevert(GoghPaidSkillTraining.InvalidConfiguration.selector);
        new GoghPaidSkillTraining(c, keys);
    }

    function testConstructorRejectsUnboundedDuplicateUnknownOrUnsafeKeys() public {
        GoghPaidSkillTraining.Configuration memory c = _config();
        bytes32[] memory keys = new bytes32[](0);
        vm.expectRevert(GoghPaidSkillTraining.InvalidConfiguration.selector);
        new GoghPaidSkillTraining(c, keys);
        keys = new bytes32[](33);
        vm.expectRevert(GoghPaidSkillTraining.InvalidConfiguration.selector);
        new GoghPaidSkillTraining(c, keys);
        keys = new bytes32[](2);
        keys[0] = detective;
        keys[1] = detective;
        vm.expectRevert(GoghPaidSkillTraining.InvalidConfiguration.selector);
        new GoghPaidSkillTraining(c, keys);
        keys = new bytes32[](1);
        bytes32[5] memory bad = [bytes32(0), financial, mixed, risky, dependent];
        for (uint256 i; i < bad.length; ++i) {
            keys[0] = bad[i];
            vm.expectRevert(GoghPaidSkillTraining.InvalidConfiguration.selector);
            new GoghPaidSkillTraining(c, keys);
        }
        keys[0] = keccak256("UNKNOWN");
        vm.expectRevert();
        new GoghPaidSkillTraining(c, keys);
    }

    function testNoUnreviewedPaymentMintOrRefundEntryPointExists() public {
        (bool sent,) = address(paid).call{ value: PRICE }("");
        require(!sent);
        (bool minted,) =
            address(paid).call(abi.encodeWithSignature("mintCredits(uint256,uint256)", 1, 1));
        (bool refunded,) = address(paid).call(abi.encodeWithSignature("refund(uint256)", 1));
        require(!minted && !refunded && paid.purchasedCredits(1) == 0);
    }
}
