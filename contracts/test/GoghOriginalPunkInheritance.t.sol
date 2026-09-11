// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { GoghPunkAgentAccount } from "../src/GoghPunkAgentAccount.sol";
import { GoghPunkAgentAccountRegistry } from "../src/GoghPunkAgentAccountRegistry.sol";
import { GoghRaritySkillProgression } from "../src/GoghRaritySkillProgression.sol";
import { GoghSkillRegistry } from "../src/GoghSkillRegistry.sol";
import { ArtAdapterRegistry } from "../src/ArtAdapterRegistry.sol";
import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import { TestVm, ERC6551RegistryHarness } from "./mocks/TestInfrastructure.sol";
import { EpochFixturePunks, EpochFixtureCredits } from "./GoghEpochAccount.t.sol";
import {
    AgentAccountMockEntryPoint,
    AgentAccountMockVenue,
    AgentAccountMockFreeMintAdapter
} from "./GoghPunkAgentAccount.t.sol";

contract InheritanceFixtureToken is ERC20 {
    constructor() ERC20("Disposable inheritance asset", "TEST") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Original collection only: NO wrapper, receipt, or epoch registry is deployed.
/// The worker continuity guard is still required for legacy round-trip protection.
contract GoghOriginalPunkInheritanceTest {
    TestVm private constant vm = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address private constant CANONICAL = 0x000000006551c19487814612e58FE06813775758;
    address private constant ENTRY = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant MARKET = address(0xCAFE);
    EpochFixturePunks private punks;
    EpochFixturePunks private art;
    InheritanceFixtureToken private erc20;
    GoghPunkAgentAccount private account;
    GoghPunkAgentAccountRegistry private factory;
    GoghRaritySkillProgression private progression;
    bytes32 private hunter;

    function setUp() public {
        vm.chainId(4663);
        vm.warp(1_800_000_000);
        vm.etch(PUNKS, address(new EpochFixturePunks()).code);
        vm.etch(CANONICAL, address(new ERC6551RegistryHarness()).code);
        vm.etch(ENTRY, address(new AgentAccountMockEntryPoint()).code);
        punks = EpochFixturePunks(PUNKS);
        punks.mint(ALICE, 93);
        punks.mint(ALICE, 812);
        punks.mint(ALICE, 813);
        GoghSkillRegistry skills = new GoghSkillRegistry(address(this));
        EpochFixtureCredits source = new EpochFixtureCredits();
        bytes32 snapshot = keccak256("ORIGINAL_NFT_LOCAL_RARITY");
        bytes32 root = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        keccak256("GOGH_RARITY_SLOTS_V1"),
                        uint256(4663),
                        PUNKS,
                        snapshot,
                        uint256(93),
                        uint8(2)
                    )
                )
            )
        );
        progression =
            new GoghRaritySkillProgression(PUNKS, address(skills), address(source), root, snapshot);
        hunter = skills.register(
            1, 1, keccak256("fixture manifest"), keccak256("fixture instructions"), bytes32(0), 2, 1
        );
        skills.setStatus(hunter, GoghSkillRegistry.Status.TESTING, bytes32(0));
        skills.setStatus(hunter, GoghSkillRegistry.Status.READY, keccak256("fixture evidence"));
        vm.startPrank(ALICE);
        punks.approve(address(source), 812);
        source.award(progression, 812, 93);
        punks.approve(address(source), 813);
        source.award(progression, 813, 93);
        progression.claimRaritySlots(93, 2, new bytes32[](0));
        progression.learnSkill(93, hunter);
        progression.equipSkill(93, 0, hunter);
        vm.stopPrank();
        ArtAdapterRegistry adapters = new ArtAdapterRegistry(address(this));
        AgentAccountMockVenue venue = new AgentAccountMockVenue();
        AgentAccountMockFreeMintAdapter adapter =
            new AgentAccountMockFreeMintAdapter(address(venue));
        adapters.registerAdapter(
            address(adapter),
            GoghBrokerTypes.AdapterKind.MINT,
            address(venue),
            keccak256("fixture"),
            keccak256("free")
        );
        GoghPunkAgentAccount implementation = new GoghPunkAgentAccount(ENTRY, address(adapters));
        factory = new GoghPunkAgentAccountRegistry(
            address(implementation), keccak256("ORIGINAL_NFT_FIXTURE")
        );
        vm.prank(ALICE);
        account = GoghPunkAgentAccount(payable(factory.createAccount(93)));
        vm.prank(ALICE);
        account.configureAutonomousSession(
            GoghPunkAgentAccount.AutonomousSessionConfig({
                sessionKey: address(0x515510),
                adapter: address(adapter),
                venue: address(venue),
                adapterCodeHash: address(adapter).codehash,
                targetCollection: address(0),
                validAfter: uint48(block.timestamp),
                validUntil: uint48(block.timestamp + 1 days),
                maxMintsPerDay: 1,
                maxMintsTotal: 1,
                maxGasCostWei: 0.0005 ether,
                minimumNativeReserveWei: 0
            })
        );
        vm.deal(address(account), 1 ether);
        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        account.depositToEntryPoint{ value: 0.1 ether }();
        art = new EpochFixturePunks();
        art.mint(address(account), 7);
        erc20 = new InheritanceFixtureToken();
        erc20.mint(address(account), 100);
    }

    function testFuzzOriginalSaleTransfersAgentAndTrainingWithoutReceiptOrClaim(uint8 route)
        public
    {
        require(account.isAutonomousSessionActive());
        if (route % 3 == 0) {
            vm.prank(ALICE);
            punks.transferFrom(ALICE, BOB, 93);
        } else if (route % 3 == 1) {
            vm.prank(ALICE);
            punks.safeTransferFrom(ALICE, BOB, 93);
        } else {
            vm.prank(ALICE);
            punks.approve(MARKET, 93);
            vm.prank(MARKET);
            punks.safeTransferFrom(ALICE, BOB, 93);
        }
        // Buyer has sent NO transaction. Only original ownerOf changed.
        require(punks.ownerOf(93) == BOB && account.owner() == BOB);
        require(factory.account(93) == address(account));
        (uint256 chain, address collection, uint256 id) = account.token();
        require(chain == 4663 && collection == PUNKS && id == 93);
        require(address(account).balance == 1 ether && account.entryPointDeposit() == 0.1 ether);
        require(art.ownerOf(7) == address(account) && erc20.balanceOf(address(account)) == 100);
        require(progression.trainingCredits(93) == 1 && progression.learnedLevel(93, hunter) == 1);
        require(progression.unlockedSlots(93) == 2 && progression.equipped(93, 0) == hunter);
        require(!account.isAutonomousSessionActive());
        vm.expectRevert();
        vm.prank(ALICE);
        account.withdrawEntryPointDeposit(1);
        vm.expectRevert();
        vm.prank(ALICE);
        progression.unequipSkill(93, 0);
        vm.expectRevert();
        vm.prank(MARKET);
        account.withdrawEntryPointDeposit(1);
        // Optional owner operations work immediately, with no claim or reenrollment.
        vm.prank(BOB);
        account.withdrawEntryPointDeposit(1);
        vm.prank(BOB);
        progression.unequipSkill(93, 0);
        vm.prank(BOB);
        account.execute(address(erc20), 0, abi.encodeCall(erc20.transfer, (BOB, 1)), 0);
        require(erc20.balanceOf(BOB) == 1 && progression.learnedLevel(93, hunter) == 1);
    }

    function testOriginalBurnRemovesOwnerAuthorityButDoesNotEraseHistoricalLearning() public {
        vm.prank(ALICE); // DISPOSABLE FIXTURE, not a production burn pathway.
        punks.burn(93);
        require(account.owner() == address(0) && !account.isAutonomousSessionActive());
        require(
            progression.learnedLevel(93, hunter) == 1 && progression.effectiveCapabilities(93) == 0
        );
        vm.expectRevert();
        vm.prank(ALICE);
        account.withdrawEntryPointDeposit(1);
    }
}
