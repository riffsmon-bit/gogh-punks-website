// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { ERC721Burnable } from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { GoghPunkSessionWrapper } from "../src/epoch/GoghPunkSessionWrapper.sol";
import { GoghOwnershipEpochRegistry } from "../src/epoch/GoghOwnershipEpochRegistry.sol";
import { GoghEpochAgentAccount } from "../src/epoch/GoghEpochAgentAccount.sol";
import { GoghEpochAccountRegistry } from "../src/epoch/GoghEpochAccountRegistry.sol";
import { GoghEpochSkillProgression } from "../src/epoch/GoghEpochSkillProgression.sol";
import { GoghPunkAgentAccount } from "../src/GoghPunkAgentAccount.sol";
import { GoghPunkAgentAccountRegistry } from "../src/GoghPunkAgentAccountRegistry.sol";
import { GoghSkillRegistry } from "../src/GoghSkillRegistry.sol";
import { GoghSkillProgression } from "../src/GoghSkillProgression.sol";
import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import { ArtAdapterRegistry } from "../src/ArtAdapterRegistry.sol";
import { PackedUserOperation } from "../src/interfaces/IEntryPointV08.sol";
import { TestVm, ERC6551RegistryHarness } from "./mocks/TestInfrastructure.sol";
import {
    AgentAccountMockEntryPoint,
    AgentAccountMockVenue,
    AgentAccountMockCollection,
    AgentAccountMockFreeMintAdapter
} from "./GoghPunkAgentAccount.t.sol";

/// @dev DISPOSABLE TEST COLLECTION. Never deploy or etch on a public network.
contract EpochFixturePunks is ERC721Burnable {
    constructor() ERC721("Disposable Epoch Punks", "TEST") { }

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }

    function forceTransfer(address from, address to, uint256 id) external {
        _transfer(from, to, id);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return "data:application/json,{\"name\":\"Disposable test Punk\"}";
    }
}

/// @dev TEST CREDIT SOURCE; not a production burn-eligibility implementation.
contract EpochFixtureCredits {
    function award(GoghSkillProgression progression, uint256 source, uint256 id) external {
        EpochFixturePunks collection = EpochFixturePunks(address(progression.collection()));
        require(collection.ownerOf(source) == msg.sender && collection.ownerOf(id) == msg.sender);
        collection.burn(source);
        progression.awardTrainingCredit(source, id);
    }
}

contract EpochReceiver is IERC721Receiver {
    GoghEpochAgentAccount private immutable account;
    bool private immutable reject;

    constructor(GoghEpochAgentAccount account_, bool reject_) {
        account = account_;
        reject = reject_;
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        view
        returns (bytes4)
    {
        require(!account.isAutonomousSessionActive(), "old session visible in callback");
        require(!reject, "reject receipt");
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract EpochRoundTripVenue {
    GoghPunkSessionWrapper private immutable wrapper;
    address private immutable alice;
    address private immutable bob;

    constructor(GoghPunkSessionWrapper w, address a, address b) {
        wrapper = w;
        alice = a;
        bob = b;
    }

    function mint(address collection, address recipient, uint256 id) external {
        AgentAccountMockCollection(collection).mint(recipient, id);
        wrapper.transferFrom(alice, bob, 93);
        wrapper.transferFrom(bob, alice, 93);
    }
}

contract GoghEpochAccountTest {
    using MessageHashUtils for bytes32;
    TestVm private constant vm = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address private constant CANONICAL = 0x000000006551c19487814612e58FE06813775758;
    address private constant ENTRY = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;
    uint256 private constant ID = 93;
    uint256 private constant SIGNER_KEY = 0x515510;
    address private alice;
    address private bob = address(0xB0B);
    address private marketplace = address(0xCAFE);
    EpochFixturePunks private punks;
    GoghPunkSessionWrapper private wrapper;
    GoghOwnershipEpochRegistry private epochs;
    GoghEpochAgentAccount private account;
    GoghEpochAccountRegistry private factory;
    GoghEpochSkillProgression private progression;
    GoghSkillRegistry private skills;
    ArtAdapterRegistry private adapters;
    AgentAccountMockEntryPoint private entryPoint;
    AgentAccountMockFreeMintAdapter private adapter;
    AgentAccountMockVenue private venue;
    AgentAccountMockCollection private art;
    bytes32 private hunter;
    bytes32 private rarityLeaf;

    function testReceiptEnumerationFollowsTransfersAndRedemption() public {
        require(wrapper.supportsInterface(0x780e9d63), "enumeration interface");
        require(wrapper.totalSupply() == 1 && wrapper.balanceOf(alice) == 1);
        require(wrapper.tokenOfOwnerByIndex(alice, 0) == ID && wrapper.tokenByIndex(0) == ID);
        vm.startPrank(alice);
        wrapper.transferFrom(alice, alice, ID);
        require(wrapper.tokenOfOwnerByIndex(alice, 0) == ID && wrapper.balanceOf(alice) == 1);
        wrapper.safeTransferFrom(alice, bob, ID);
        vm.stopPrank();
        require(wrapper.balanceOf(alice) == 0 && wrapper.balanceOf(bob) == 1);
        require(wrapper.tokenOfOwnerByIndex(bob, 0) == ID && wrapper.totalSupply() == 1);
        vm.prank(bob);
        wrapper.unwrap(ID);
        require(wrapper.totalSupply() == 0 && wrapper.balanceOf(bob) == 0);
        require(punks.ownerOf(ID) == bob && epochs.epoch(ID) == 4);
        vm.startPrank(bob);
        punks.approve(address(wrapper), ID);
        wrapper.wrap(ID);
        vm.stopPrank();
        require(wrapper.totalSupply() == 1 && wrapper.tokenOfOwnerByIndex(bob, 0) == ID);
        require(epochs.epoch(ID) == 5 && !account.isAutonomousSessionActive());
    }

    function setUp() public {
        vm.chainId(4663);
        vm.warp(1_800_000_000);
        alice = vm.addr(0xA11CE);
        vm.etch(PUNKS, address(new EpochFixturePunks()).code);
        vm.etch(CANONICAL, address(new ERC6551RegistryHarness()).code);
        vm.etch(ENTRY, address(new AgentAccountMockEntryPoint()).code);
        punks = EpochFixturePunks(PUNKS);
        punks.mint(alice, ID);
        punks.mint(alice, 812);
        punks.mint(alice, 813);
        wrapper = new GoghPunkSessionWrapper(address(this));
        epochs = wrapper.epochs();
        skills = new GoghSkillRegistry(address(this));
        EpochFixtureCredits source = new EpochFixtureCredits();
        bytes32 snapshot = keccak256("LOCAL_FIXTURE");
        rarityLeaf = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        keccak256("GOGH_RARITY_SLOTS_V1"),
                        uint256(4663),
                        PUNKS,
                        snapshot,
                        ID,
                        uint8(2)
                    )
                )
            )
        );
        progression = new GoghEpochSkillProgression(
            address(wrapper), address(skills), address(source), rarityLeaf, snapshot
        );
        hunter = skills.register(
            1,
            1,
            keccak256("LOCAL_MINT_MANIFEST"),
            keccak256("LOCAL_INSTRUCTIONS"),
            bytes32(0),
            2,
            1
        );
        skills.setStatus(hunter, GoghSkillRegistry.Status.TESTING, bytes32(0));
        skills.setStatus(hunter, GoghSkillRegistry.Status.READY, keccak256("LOCAL_TEST_EVIDENCE"));
        vm.startPrank(alice);
        punks.approve(address(source), 812);
        source.award(progression, 812, ID);
        punks.approve(address(source), 813);
        source.award(progression, 813, ID);
        progression.learnSkill(ID, hunter);
        progression.equipSkill(ID, 0, hunter);
        punks.approve(address(wrapper), ID);
        wrapper.wrap(ID);
        vm.stopPrank();
        entryPoint = AgentAccountMockEntryPoint(payable(ENTRY));
        adapters = new ArtAdapterRegistry(address(this));
        venue = new AgentAccountMockVenue();
        art = new AgentAccountMockCollection(address(venue));
        adapter = new AgentAccountMockFreeMintAdapter(address(venue));
        adapters.registerAdapter(
            address(adapter),
            GoghBrokerTypes.AdapterKind.MINT,
            address(venue),
            keccak256("fixture"),
            keccak256("free")
        );
        GoghEpochAgentAccount implementation = new GoghEpochAgentAccount(
            ENTRY, address(adapters), address(wrapper), address(progression)
        );
        factory = new GoghEpochAccountRegistry(address(implementation), keccak256("LOCAL_EPOCH"));
        vm.prank(alice);
        account = GoghEpochAgentAccount(payable(factory.createAccount(ID)));
        vm.deal(address(account), 1 ether);
        _configure(alice);
    }

    function testWrappedMintWithLearnedEquippedSkillAndEpoch() public {
        require(punks.ownerOf(ID) == address(wrapper) && wrapper.ownerOf(ID) == alice);
        require(account.owner() == alice && epochs.epoch(ID) == 1 && account.authorizedEpoch() == 1);
        (uint256 chain, address collection, uint256 id) = account.token();
        require(chain == 4663 && collection == PUNKS && id == ID);
        (PackedUserOperation memory op, bytes32 hash) = _signed(_intent());
        require(entryPoint.validate(account, op, hash, 0) != 1);
        entryPoint.execute(address(account), op.callData);
        require(art.ownerOf(700) == address(account) && account.acquisitionNonce() == 1);
        vm.expectRevert();
        entryPoint.execute(address(account), op.callData);
    }

    function testRoundTripInvalidatesSignedOperationAtValidationAndExecution() public {
        (PackedUserOperation memory op, bytes32 hash) = _signed(_intent());
        _transfer(alice, bob);
        _transfer(bob, alice);
        require(
            account.owner() == alice && epochs.epoch(ID) == 3
                && !account.isAutonomousSessionActive()
        );
        vm.expectRevert();
        entryPoint.validate(account, op, hash, 0);
        vm.expectRevert();
        entryPoint.execute(address(account), op.callData);
    }

    function testTransferBetweenValidationAndExecutionIsRejected() public {
        (PackedUserOperation memory op, bytes32 hash) = _signed(_intent());
        require(entryPoint.validate(account, op, hash, 0) != 1);
        _transfer(alice, bob);
        _transfer(bob, alice);
        vm.expectRevert();
        entryPoint.execute(address(account), op.callData);
    }

    function testTransferDuringMintRollsBackWholeTransaction() public {
        EpochRoundTripVenue attack = new EpochRoundTripVenue(wrapper, alice, bob);
        venue = AgentAccountMockVenue(address(attack));
        art = new AgentAccountMockCollection(address(attack));
        adapter = new AgentAccountMockFreeMintAdapter(address(attack));
        adapters.registerAdapter(
            address(adapter),
            GoghBrokerTypes.AdapterKind.MINT,
            address(attack),
            keccak256("callback fixture"),
            keccak256("free")
        );
        vm.prank(alice);
        wrapper.setApprovalForAll(address(attack), true);
        vm.prank(bob);
        wrapper.setApprovalForAll(address(attack), true);
        _configure(alice);
        (PackedUserOperation memory op, bytes32 hash) = _signed(_intent());
        require(entryPoint.validate(account, op, hash, 0) != 1);
        vm.expectRevert(GoghEpochAgentAccount.AuthorityChangedDuringExecution.selector);
        entryPoint.execute(address(account), op.callData);
        require(
            epochs.epoch(ID) == 1 && wrapper.ownerOf(ID) == alice && account.acquisitionNonce() == 0
        );
        vm.expectRevert();
        art.ownerOf(700);
    }

    function testGasDepositAndNFTRecoveryRemainOwnerControlled() public {
        EpochFixturePunks heldArt = new EpochFixturePunks();
        heldArt.mint(address(account), 1);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        account.depositToEntryPoint{ value: 0.1 ether }();
        _transfer(alice, bob);
        vm.prank(bob);
        wrapper.unwrap(ID);
        vm.prank(bob);
        account.withdrawEntryPointDeposit(0.1 ether);
        vm.prank(bob);
        account.execute(
            address(heldArt),
            0,
            abi.encodeWithSignature(
                "transferFrom(address,address,uint256)", address(account), bob, 1
            ),
            0
        );
        require(account.entryPointDeposit() == 0 && heldArt.ownerOf(1) == bob);
    }

    function testForkedChainAndBurnedOriginalFailClosed() public {
        vm.chainId(1);
        require(!account.isAutonomousSessionActive() && account.owner() == address(0));
        vm.expectRevert();
        vm.prank(alice);
        wrapper.unwrap(ID);
        vm.chainId(4663);
        vm.prank(alice);
        wrapper.unwrap(ID);
        vm.prank(alice);
        punks.burn(ID);
        require(account.owner() == address(0) && !account.isAutonomousSessionActive());
    }

    function testDeterministicFactoryMatchesIndependentCreate2Calculation() public view {
        bytes memory creationCode = abi.encodePacked(
            hex"3d60ad80600a3d3981f3",
            hex"363d3d373d3d3d363d73",
            address(factory.implementation()),
            hex"5af43d82803e903d91602b57fd5bf3",
            abi.encode(factory.accountSalt(), uint256(4663), PUNKS, ID)
        );
        address expected = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff", CANONICAL, factory.accountSalt(), keccak256(creationCode)
                        )
                    )
                )
            )
        );
        require(expected == address(account) && expected == factory.account(ID));
    }

    function testFreshAuthorizationCannotReplayOldGeneration() public {
        (PackedUserOperation memory oldOp,) = _signed(_intent());
        _transfer(alice, bob);
        _transfer(bob, alice);
        _configure(alice);
        require(account.isAutonomousSessionActive() && account.authorizedEpoch() == 3);
        vm.expectRevert();
        entryPoint.execute(address(account), oldOp.callData);
        (PackedUserOperation memory op, bytes32 hash) = _signed(_intent());
        require(entryPoint.validate(account, op, hash, 0) != 1);
        entryPoint.execute(address(account), op.callData);
    }

    function testUnwrapRewrapNeverResetsEpochOrRevivesSession() public {
        vm.prank(alice);
        wrapper.unwrap(ID);
        require(
            punks.ownerOf(ID) == alice && epochs.epoch(ID) == 2
                && !account.isAutonomousSessionActive()
        );
        vm.prank(alice);
        punks.approve(address(wrapper), ID);
        vm.prank(alice);
        wrapper.wrap(ID);
        require(epochs.epoch(ID) == 3 && !account.isAutonomousSessionActive());
        _configure(alice);
        require(account.isAutonomousSessionActive());
    }

    function testOwnerCanRecoverNativeFundsWrappedAndAfterUnwrap() public {
        _transfer(alice, bob);
        vm.expectRevert();
        vm.prank(alice);
        account.execute(alice, 1, "", 0);
        uint256 before = bob.balance;
        vm.prank(bob);
        account.execute(bob, 0.1 ether, "", 0);
        vm.prank(bob);
        wrapper.unwrap(ID);
        vm.prank(bob);
        account.execute(bob, 0.1 ether, "", 0);
        require(bob.balance == before + 0.2 ether && account.owner() == bob);
        vm.expectRevert(); // Unwrapped accounts have recovery, no autonomy.
        _configure(bob);
    }

    function testSkillsCreditsRaritySlotsPersistAndNewOwnerControlsLoadout() public {
        _transfer(alice, bob);
        require(progression.learnedLevel(ID, hunter) == 1 && progression.equipped(ID, 0) == hunter);
        require(progression.trainingCredits(ID) == 1);
        vm.expectRevert();
        vm.prank(alice);
        progression.unequipSkill(ID, 0);
        vm.prank(bob);
        progression.claimRaritySlots(ID, 2, new bytes32[](0));
        vm.prank(bob);
        progression.unlockSlot(ID);
        require(progression.unlockedSlots(ID) == 3 && progression.trainingCredits(ID) == 0);
        vm.prank(bob);
        progression.unequipSkill(ID, 0);
        vm.prank(bob);
        progression.equipSkill(ID, 1, hunter);
        _configure(bob);
        require(account.isAutonomousSessionActive());
        vm.prank(bob);
        wrapper.unwrap(ID);
        require(progression.unlockedSlots(ID) == 3 && progression.equipped(ID, 1) == hunter);
        vm.prank(bob);
        progression.unequipSkill(ID, 1);
    }

    function testUnequippedDisabledDeprecatedAndUnlearnedCannotMint() public {
        vm.prank(alice);
        progression.unequipSkill(ID, 0);
        require(!account.isAutonomousSessionActive());
        vm.expectRevert();
        _configure(alice);
        vm.expectRevert();
        vm.prank(alice);
        progression.equipSkill(ID, 0, keccak256("unlearned"));
        vm.prank(alice);
        progression.equipSkill(ID, 0, hunter);
        skills.setDisabled(hunter, true);
        require(!account.isAutonomousSessionActive());
        vm.expectRevert();
        _configure(alice);
        skills.setDisabled(hunter, false);
        skills.deprecate(hunter, bytes32(0));
        require(!account.isAutonomousSessionActive() && progression.learnedLevel(ID, hunter) == 1);
    }

    function testEmergencyResumeRequiresFreshSessionButNeverBlocksExit() public {
        epochs.setExecutionPaused(true);
        require(!account.isAutonomousSessionActive());
        epochs.setExecutionPaused(false);
        require(!account.isAutonomousSessionActive());
        _configure(alice);
        require(account.isAutonomousSessionActive());
        epochs.setExecutionPaused(true);
        _transfer(alice, bob);
        vm.prank(bob);
        wrapper.unwrap(ID);
        require(punks.ownerOf(ID) == bob);
    }

    function testRegistryCannotBeSpoofedOrPausedByHolder() public {
        vm.expectRevert(GoghOwnershipEpochRegistry.NotWrapper.selector);
        epochs.advance(ID, alice, bob);
        vm.expectRevert(GoghOwnershipEpochRegistry.NotGuardian.selector);
        vm.prank(alice);
        epochs.setExecutionPaused(true);
        require(epochs.epoch(ID) == 1);
    }

    function testApprovedMarketplaceTransferAdvancesAndClearsApproval() public {
        vm.prank(alice);
        wrapper.approve(marketplace, ID);
        vm.prank(marketplace);
        wrapper.transferFrom(alice, bob, ID);
        require(epochs.epoch(ID) == 2 && wrapper.getApproved(ID) == address(0));
        require(account.owner() == bob && !account.isAutonomousSessionActive());
        vm.expectRevert();
        vm.prank(marketplace);
        wrapper.transferFrom(bob, alice, ID);
    }

    /// @dev A sale is just an approved ERC721 transfer. There is no buyer claim,
    /// migration, account recreation, synchronization transaction or re-equipping.
    /// This covers the WRAPPED receipt; original-collection marketplace enrollment
    /// is not claimed by a fixture transfer test.
    function testFuzzSaleInheritsWholePunkWithoutBuyerSetup(uint8 route) public {
        vm.prank(alice);
        progression.claimRaritySlots(ID, 2, new bytes32[](0));
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        account.depositToEntryPoint{ value: 0.1 ether }();
        (PackedUserOperation memory op, bytes32 hash) = _signed(_intent());
        require(entryPoint.validate(account, op, hash, 0) != 1);
        entryPoint.execute(address(account), op.callData);

        address identity = address(account);
        uint256 nativeBalance = identity.balance;
        uint256 deposit = account.entryPointDeposit();
        uint256 acquisitionNonce = account.acquisitionNonce();
        uint64 oldGeneration = account.sessionGeneration();
        require(account.isAutonomousSessionActive());
        if (route % 3 == 0) {
            vm.prank(alice);
            wrapper.transferFrom(alice, bob, ID);
        } else if (route % 3 == 1) {
            vm.prank(alice);
            wrapper.safeTransferFrom(alice, bob, ID);
        } else {
            vm.prank(alice);
            wrapper.approve(marketplace, ID);
            vm.prank(marketplace);
            wrapper.safeTransferFrom(alice, bob, ID);
        }

        // No transaction from Bob has occurred. Everything below must already hold.
        require(wrapper.ownerOf(ID) == bob && account.owner() == bob);
        require(factory.account(ID) == identity && punks.ownerOf(ID) == address(wrapper));
        require(progression.trainingCredits(ID) == 1 && progression.learnedCount(ID) == 1);
        require(progression.learnedLevel(ID, hunter) == 1);
        require(progression.claimedStartingSlots(ID) == 2 && progression.unlockedSlots(ID) == 2);
        require(progression.equipped(ID, 0) == hunter && progression.equipped(ID, 1) == bytes32(0));
        require(progression.effectiveCapabilities(ID) == 2);
        require(identity.balance == nativeBalance && account.entryPointDeposit() == deposit);
        require(art.ownerOf(700) == identity && account.acquisitionNonce() == acquisitionNonce);
        require(wrapper.balanceOf(alice) == 0 && wrapper.tokenOfOwnerByIndex(bob, 0) == ID);
        // Old authorization is invalidated, not silently rewritten to authorize Bob.
        require(
            !account.isAutonomousSessionActive() && account.sessionGeneration() == oldGeneration
        );
        require(account.autonomousSession().authorizingOwner == alice);
        vm.expectRevert();
        vm.prank(alice);
        progression.unequipSkill(ID, 0);
        vm.expectRevert();
        vm.prank(alice);
        account.withdrawEntryPointDeposit(1);
        // The buyer can immediately use owner controls without enrollment or claiming.
        vm.prank(bob);
        account.withdrawEntryPointDeposit(1);
        vm.prank(bob);
        progression.unequipSkill(ID, 0);
        require(
            account.entryPointDeposit() == deposit - 1 && progression.equipped(ID, 0) == bytes32(0)
        );
        require(progression.learnedLevel(ID, hunter) == 1);
    }

    function testOriginalSaleAfterUnwrapKeepsProgressionButDoesNotEnableAutonomy() public {
        vm.prank(alice);
        progression.claimRaritySlots(ID, 2, new bytes32[](0));
        vm.prank(alice);
        wrapper.unwrap(ID);
        vm.prank(alice);
        punks.approve(marketplace, ID);
        vm.prank(marketplace);
        punks.safeTransferFrom(alice, bob, ID);
        // Original token-ID state survives too; wrapping is not what stores the skills.
        require(punks.ownerOf(ID) == bob && account.owner() == bob);
        require(factory.account(ID) == address(account));
        require(progression.trainingCredits(ID) == 1 && progression.learnedLevel(ID, hunter) == 1);
        require(progression.unlockedSlots(ID) == 2 && progression.equipped(ID, 0) == hunter);
        require(!wrapper.isWrapped(ID) && !account.isAutonomousSessionActive());
        vm.expectRevert();
        vm.prank(alice);
        progression.unequipSkill(ID, 0);
        vm.prank(bob);
        progression.unequipSkill(ID, 0);
        // Buyer controls the account and loadout, but original ownership alone is not
        // permission to bypass the epoch model's wrapped-session requirement.
        vm.prank(bob);
        progression.equipSkill(ID, 0, hunter);
        vm.expectRevert();
        _configure(bob);
    }

    function testOperatorSafeTransferAndSelfTransferAdvance() public {
        vm.prank(alice);
        wrapper.setApprovalForAll(marketplace, true);
        vm.prank(marketplace);
        wrapper.safeTransferFrom(alice, bob, ID, hex"1234");
        vm.prank(bob);
        wrapper.transferFrom(bob, bob, ID);
        require(epochs.epoch(ID) == 3 && !account.isAutonomousSessionActive());
    }

    function testSafeTransferEpochVisibleBeforeReceiverCallback() public {
        EpochReceiver receiver = new EpochReceiver(account, false);
        vm.prank(alice);
        wrapper.safeTransferFrom(alice, address(receiver), ID);
        require(epochs.epoch(ID) == 2 && account.owner() == address(receiver));
    }

    function testReceiverRevertRollsBackReceiptAndEpoch() public {
        EpochReceiver receiver = new EpochReceiver(account, true);
        vm.expectRevert();
        vm.prank(alice);
        wrapper.safeTransferFrom(alice, address(receiver), ID);
        require(
            epochs.epoch(ID) == 1 && wrapper.ownerOf(ID) == alice
                && account.isAutonomousSessionActive()
        );
    }

    function testInvalidWrapUnwrapAndUnsolicitedDepositAreRejected() public {
        vm.expectRevert();
        vm.prank(bob);
        wrapper.wrap(ID);
        vm.expectRevert();
        vm.prank(bob);
        wrapper.unwrap(ID);
        vm.prank(alice);
        wrapper.approve(marketplace, ID);
        vm.expectRevert();
        vm.prank(marketplace);
        wrapper.unwrap(ID);
        punks.mint(alice, 999);
        vm.prank(alice);
        punks.approve(address(wrapper), 999);
        vm.expectRevert();
        vm.prank(marketplace);
        wrapper.wrap(999);
        vm.expectRevert();
        vm.prank(alice);
        punks.safeTransferFrom(alice, address(wrapper), 999);
        vm.expectRevert();
        wrapper.onERC721Received(address(wrapper), alice, 999, "");
        require(punks.ownerOf(999) == alice);
    }

    function testReceiptCannotBeSentToControllingAccountEvenWithRawTransfer() public {
        vm.expectRevert();
        vm.prank(alice);
        wrapper.transferFrom(alice, address(account), ID);
        vm.expectRevert();
        vm.prank(alice);
        wrapper.transferFrom(alice, address(wrapper), ID);
        require(epochs.epoch(ID) == 1);
    }

    function testEscrowLossBlocksMintingAndRebindsRecoveryToOriginalOwner() public {
        // Models a broken/compromised collection; no normal wrapper function permits this.
        punks.forceTransfer(address(wrapper), bob, ID);
        require(!wrapper.isWrapped(ID) && !account.isAutonomousSessionActive());
        require(account.owner() == bob);
        vm.expectRevert();
        vm.prank(alice);
        wrapper.unwrap(ID);
    }

    function testWrongOwnerCannotCreateConfigureOrWithdrawDeposit() public {
        vm.expectRevert();
        vm.prank(bob);
        factory.createAccount(ID);
        vm.expectRevert();
        _configure(bob);
        vm.expectRevert();
        vm.prank(bob);
        account.withdrawEntryPointDeposit(1);
        vm.prank(alice);
        require(factory.createAccount(ID) == address(account));
    }

    function testOriginalMetadataAndAccountIdentityPersist() public {
        require(keccak256(bytes(wrapper.tokenURI(ID))) == keccak256(bytes(punks.tokenURI(ID))));
        address before = address(account);
        _transfer(alice, bob);
        vm.prank(bob);
        wrapper.unwrap(ID);
        require(factory.account(ID) == before);
    }

    function testLegacyWalletNeedsUnwrapForRecoveryAndIsNotUpgraded() public {
        GoghPunkAgentAccount implementation = new GoghPunkAgentAccount(ENTRY, address(adapters));
        GoghPunkAgentAccountRegistry legacy =
            new GoghPunkAgentAccountRegistry(address(implementation), bytes32(0));
        vm.prank(alice);
        wrapper.unwrap(ID);
        vm.prank(alice);
        GoghPunkAgentAccount old = GoghPunkAgentAccount(payable(legacy.createAccount(ID)));
        vm.deal(address(old), 0.2 ether);
        vm.prank(alice);
        punks.approve(address(wrapper), ID);
        vm.prank(alice);
        wrapper.wrap(ID);
        require(old.owner() == address(wrapper));
        vm.expectRevert();
        vm.prank(alice);
        old.execute(alice, 1, "", 0);
        _transfer(alice, bob);
        vm.prank(bob);
        wrapper.unwrap(ID);
        require(old.owner() == bob);
        vm.prank(bob);
        old.execute(bob, 0.2 ether, "", 0);
        require(address(old).balance == 0);
    }

    function testOwnerPolicyExpiryPriceNonceAndSignaturesStillApply() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent();
        intent.expectedPrice = 1;
        vm.expectRevert();
        entryPoint.execute(
            address(account), abi.encodeCall(account.executeSessionAcquisition, (intent, bytes("")))
        );
        (PackedUserOperation memory op, bytes32 hash) = _signed(_intent());
        op.signature = hex"1234";
        require(entryPoint.validate(account, op, hash, 0) == 1);
        vm.warp(block.timestamp + 8 days);
        require(!account.isAutonomousSessionActive());
    }

    function testFuzzTransfersNeverReactivate(uint8 transfers) public {
        uint256 count = uint256(transfers) % 32 + 1;
        address current = alice;
        for (uint256 i; i < count; ++i) {
            address next = current == alice ? bob : alice;
            _transfer(current, next);
            current = next;
            require(!account.isAutonomousSessionActive() && epochs.epoch(ID) == i + 2);
        }
    }

    function _transfer(address from, address to) private {
        vm.prank(from);
        wrapper.transferFrom(from, to, ID);
    }

    function _configure(address owner) private {
        GoghPunkAgentAccount.AutonomousSessionConfig memory config =
            GoghPunkAgentAccount.AutonomousSessionConfig({
                sessionKey: vm.addr(SIGNER_KEY),
                adapter: address(adapter),
                venue: address(venue),
                adapterCodeHash: address(adapter).codehash,
                targetCollection: address(art),
                validAfter: uint48(block.timestamp),
                validUntil: uint48(block.timestamp + 7 days),
                maxMintsPerDay: 2,
                maxMintsTotal: 2,
                maxGasCostWei: 0.01 ether,
                minimumNativeReserveWei: 0.5 ether
            });
        vm.prank(owner);
        account.configureAutonomousSession(config);
    }

    function _intent() private view returns (GoghBrokerTypes.AcquisitionIntent memory i) {
        i.account = address(account);
        i.chainId = 4663;
        i.expectedOwner = account.owner();
        i.nonce = account.acquisitionNonce();
        i.policyVersion = account.sessionGeneration();
        i.opportunityType = GoghBrokerTypes.OpportunityType.FREE_MINT;
        i.assetStandard = GoghBrokerTypes.AssetStandard.ERC721;
        i.adapter = address(adapter);
        i.venue = address(venue);
        i.collection = address(art);
        i.tokenId = 700;
        i.assetAmount = 1;
        i.createdAt = uint64(block.timestamp);
        i.expiresAt = uint64(block.timestamp + 5 minutes);
        i.opportunityId = keccak256("LOCAL_OPPORTUNITY");
        i.reasoningHash = keccak256("LOCAL_SCREEN");
        i.adapterCodeHash = address(adapter).codehash;
    }

    function _signed(GoghBrokerTypes.AcquisitionIntent memory intent)
        private
        returns (PackedUserOperation memory op, bytes32 hash)
    {
        op.sender = address(account);
        op.nonce = intent.nonce;
        op.callData = abi.encodeCall(account.executeSessionAcquisition, (intent, bytes("")));
        op.accountGasLimits = bytes32((uint256(100_000) << 128) | uint256(150_000));
        op.preVerificationGas = 50_000;
        op.gasFees = bytes32(uint256(1 gwei));
        hash = keccak256(abi.encode(op.sender, op.callData, op.nonce));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, hash.toEthSignedMessageHash());
        op.signature = abi.encodePacked(r, s, v);
    }
}
