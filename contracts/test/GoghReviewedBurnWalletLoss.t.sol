// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghReviewedBurnSource } from "../src/GoghReviewedBurnSource.sol";
import { GoghReviewedSkillProgression } from "../src/GoghReviewedSkillProgression.sol";
import { GoghSkillRegistry } from "../src/GoghSkillRegistry.sol";
import { GoghPunkAccountV1 } from "../src/GoghPunkAccountV1.sol";
import { GoghPunkAccountV2 } from "../src/GoghPunkAccountV2.sol";
import { GoghPunkAccountV3 } from "../src/GoghPunkAccountV3.sol";
import { GoghPunkAgentAccount } from "../src/GoghPunkAgentAccount.sol";
import { BrokerPolicyModule } from "../src/BrokerPolicyModule.sol";
import { ArtAgentRegistry } from "../src/ArtAgentRegistry.sol";
import { ArtAdapterRegistry } from "../src/ArtAdapterRegistry.sol";
import { LocalBurnPunks } from "./mocks/LocalReviewedBurn.sol";
import { AgentAccountMockEntryPoint } from "./GoghPunkAgentAccount.t.sol";
import { TestVm, ERC6551RegistryHarness } from "./mocks/TestInfrastructure.sol";

/// @dev Actual wallet implementations with disposable collection/EntryPoint fixtures.
contract GoghReviewedBurnWalletLossTest {
    TestVm private constant VM = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ALICE = address(0xA11CE);
    address private constant PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address private constant FACTORY = 0x000000006551c19487814612e58FE06813775758;
    address private constant ENTRY = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;

    function testReviewedBurnRemovesAllFourWalletOwnersAndLeavesAssetsInPlace() public {
        VM.chainId(31_337);
        VM.etch(PUNKS, address(new LocalBurnPunks()).code);
        VM.chainId(4663);
        VM.warp(1_800_000_000);
        VM.etch(FACTORY, address(new ERC6551RegistryHarness()).code);
        VM.etch(ENTRY, address(new AgentAccountMockEntryPoint()).code);
        LocalBurnPunks punks = LocalBurnPunks(PUNKS);
        for (uint256 first = 1; first < 1121; first += 100) {
            uint256 count = 1121 - first;
            punks.mintReserve(ALICE, first, count > 100 ? 100 : count);
        }
        GoghSkillRegistry registry = new GoghSkillRegistry(address(this));
        GoghReviewedBurnSource source = new GoghReviewedBurnSource(PUNKS);
        GoghReviewedSkillProgression progression = new GoghReviewedSkillProgression(
            PUNKS, address(registry), address(source), keccak256("root"), keccak256("snapshot")
        );
        source.bindProgression(address(progression));
        ArtAdapterRegistry adapters = new ArtAdapterRegistry(address(this));
        ArtAgentRegistry agents = new ArtAgentRegistry(address(this));
        BrokerPolicyModule policy = new BrokerPolicyModule(address(this), address(adapters));
        address[4] memory implementations = [
            address(new GoghPunkAccountV1(address(policy), address(agents), address(adapters))),
            address(new GoghPunkAccountV2(address(policy), address(agents), address(adapters))),
            address(new GoghPunkAccountV3(address(policy), address(agents), address(adapters))),
            address(new GoghPunkAgentAccount(ENTRY, address(adapters)))
        ];
        address[4] memory wallets;
        for (uint256 i; i < 4; ++i) {
            wallets[i] = ERC6551RegistryHarness(FACTORY)
                .createAccount(implementations[i], bytes32(i), 4663, PUNKS, 7);
            require(GoghPunkAccountV1(payable(wallets[i])).owner() == ALICE);
            VM.deal(wallets[i], 1);
        }
        VM.deal(ALICE, 1);
        VM.prank(ALICE);
        GoghPunkAgentAccount(payable(wallets[3])).depositToEntryPoint{ value: 1 }();
        VM.prank(ALICE);
        punks.approve(address(source), 7);
        GoghReviewedBurnSource.BurnReview memory r = GoghReviewedBurnSource.BurnReview({
            sourceTokenId: 7,
            targetTokenId: 44,
            nonce: 0,
            stateHash: source.burnReviewStateHash(7, 44),
            deadline: uint64(block.timestamp + 60)
        });
        // Deliberate loss demonstration. A source contract is NOT an inventory attestor:
        // the eventual owner flow must require withdrawals before offering this transaction.
        VM.prank(ALICE);
        source.applyBurnReview(r);
        require(punks.ownerOf(44) == ALICE && progression.trainingCredits(44) == 1);
        for (uint256 i; i < 4; ++i) {
            require(wallets[i].code.length > 0 && wallets[i].balance == 1);
            require(GoghPunkAccountV1(payable(wallets[i])).owner() == address(0));
            VM.expectRevert();
            VM.prank(ALICE);
            GoghPunkAccountV1(payable(wallets[i])).execute(ALICE, 1, "", 0);
        }
        require(GoghPunkAgentAccount(payable(wallets[3])).entryPointDeposit() == 1);
        VM.expectRevert();
        VM.prank(ALICE);
        GoghPunkAgentAccount(payable(wallets[3])).withdrawEntryPointDeposit(1);
    }
}
