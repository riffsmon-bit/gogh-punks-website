// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ArtAdapterRegistry } from "../src/ArtAdapterRegistry.sol";
import { GoghPunkAgentAccount } from "../src/GoghPunkAgentAccount.sol";
import { GoghPunkAgentAccountRegistry } from "../src/GoghPunkAgentAccountRegistry.sol";
import { PaidSeaDropMock } from "./AutomatedSeaDropPaid.t.sol";
import { DirectedPaidTestCollection } from "./GoghPunkDirectedPaidMint.t.sol";
import { AgentAccountMockEntryPoint } from "./GoghPunkAgentAccount.t.sol";
import {
    MockCanonicalGoghPunks,
    ERC6551RegistryHarness,
    TestVm
} from "./mocks/TestInfrastructure.sol";

/// @dev Exercises the deployed account's exact payable owner-call route. The
///      sale is a local mock; this is not a live public collection acceptance.
contract GoghPublicPaidOwnerMintTest {
    TestVm private constant VM = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address private constant REGISTRY = 0x000000006551c19487814612e58FE06813775758;
    address private constant ENTRY = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;
    address private constant SEA = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;
    address private constant FEE = 0x0000a26b00c1F0DF003000390027140000fAa719;
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    uint256 private constant PRICE = 0.0001 ether;
    uint256 private constant PUNK = 194;
    GoghPunkAgentAccount private account;
    DirectedPaidTestCollection private art;

    function setUp() public {
        VM.chainId(4663);
        VM.warp(1_800_000_000);
        VM.etch(PUNKS, address(new MockCanonicalGoghPunks()).code);
        VM.etch(REGISTRY, address(new ERC6551RegistryHarness()).code);
        VM.etch(ENTRY, address(new AgentAccountMockEntryPoint()).code);
        VM.etch(SEA, address(new PaidSeaDropMock()).code);
        MockCanonicalGoghPunks(PUNKS).mint(ALICE, PUNK);
        ArtAdapterRegistry adapters = new ArtAdapterRegistry(address(this));
        GoghPunkAgentAccount implementation = new GoghPunkAgentAccount(ENTRY, address(adapters));
        GoghPunkAgentAccountRegistry registry =
            new GoghPunkAgentAccountRegistry(address(implementation), bytes32(0));
        VM.prank(ALICE);
        account = GoghPunkAgentAccount(payable(registry.createAccount(PUNK)));
        art = new DirectedPaidTestCollection();
        PaidSeaDropMock(SEA)
            .configure(
                uint80(PRICE), uint48(block.timestamp - 1), uint48(block.timestamp + 1 days), 5
            );
        VM.deal(ALICE, 1 ether);
        VM.deal(BOB, 1 ether);
    }

    function _mint() private {
        account.execute{ value: PRICE }(
            SEA,
            PRICE,
            abi.encodeCall(PaidSeaDropMock.mintPublic, (address(art), FEE, address(0), 1)),
            0
        );
    }

    function testOwnerPaysExactlyOnceAndNFTArrivesInAgentWallet() public {
        uint256 beforeOwner = ALICE.balance;
        VM.prank(ALICE);
        _mint();
        require(art.ownerOf(1) == address(account), "delivery");
        require(ALICE.balance == beforeOwner - PRICE, "exact owner price");
        require(address(account).balance == 0, "no reserve spent or escrow left");
        require(SEA.balance == PRICE, "sale paid");
        require(account.state() == 2, "receive and owner action recorded");
        require(account.autonomousSession().remainingMints == 0, "no delegated mission");
    }

    function testPriceChangeRevertsWithoutSpendingWalletReserve() public {
        VM.deal(address(account), 0.02 ether);
        PaidSeaDropMock(SEA)
            .configure(
                uint80(PRICE + 1), uint48(block.timestamp - 1), uint48(block.timestamp + 1 days), 5
            );
        VM.expectRevert();
        VM.prank(ALICE);
        _mint();
        require(ALICE.balance == 1 ether, "owner payment reverted");
        require(address(account).balance == 0.02 ether, "reserve untouched");
        require(art.minted() == 0, "no NFT minted");
    }

    function testOldOwnerCannotMintAfterTransferNewOwnerCan() public {
        VM.prank(ALICE);
        MockCanonicalGoghPunks(PUNKS).transferFrom(ALICE, BOB, PUNK);
        VM.expectRevert();
        VM.prank(ALICE);
        _mint();
        VM.prank(BOB);
        _mint();
        require(art.ownerOf(1) == address(account), "new owner controls same account");
        require(ALICE.balance == 1 ether, "old owner not charged");
    }

    function testWorkerHasNoPaidMintPermission() public {
        VM.deal(address(0x1234), 1 ether);
        VM.expectRevert();
        VM.prank(address(0x1234));
        _mint();
        require(art.minted() == 0, "no delegated mint");
    }
}
