// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {
    GoghPunkDirectedPaidMint,
    GoghPunkDirectedPaidMintFactory
} from "../src/GoghPunkDirectedPaidMint.sol";
import { PaidSeaDropMock, PaidCloneImplementationMarker } from "./AutomatedSeaDropPaid.t.sol";
import { MockCanonicalGoghPunks, TestVm } from "./mocks/TestInfrastructure.sol";

contract DirectedPaidTestCollection is ERC721 {
    uint256 public minted;
    mapping(address => uint256) public mintedBy;
    bool public extraMint;
    constructor() ERC721("Paid Test", "PAID") { }

    function setExtraMint(bool value) external {
        extraMint = value;
    }

    function getMintStats(address minter) external view returns (uint256, uint256, uint256) {
        return (mintedBy[minter], minted, 100);
    }

    function mintSeaDrop(address minter, uint256 quantity) external {
        require(msg.sender == 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5 && quantity == 1);
        mintedBy[minter]++;
        _safeMint(minter, ++minted);
        if (extraMint) _safeMint(minter, ++minted);
    }
}

contract DirectedPaidRecipient is IERC721Receiver {
    bool public reject;

    function setReject(bool value) external {
        reject = value;
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        view
        returns (bytes4)
    {
        require(!reject);
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract DirectedPaidTestRegistry {
    address public immutable recipient;

    constructor(address recipient_) {
        recipient = recipient_;
    }

    function account(uint256) external view returns (address) {
        return recipient;
    }
}

contract DirectedPaidRejectFee {
    receive() external payable {
        revert();
    }
}

contract DirectedPaidTransferOnFee {
    receive() external payable {
        MockCanonicalGoghPunks(0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6)
            .transferFrom(address(0xA11CE), address(0xB0B), 93);
    }
}

contract GoghPunkDirectedPaidMintTest {
    TestVm constant VM = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address constant SEA = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;
    address constant IMPL = 0x09a26fC8FCEF18192E267D7A6da9dFb4be81Dd6A;
    address constant OWNER = address(0xA11CE);
    address constant BUYER = address(0xB0B);
    address constant WORKER = address(0xA6E17);
    uint256 constant PRICE = 0.0001 ether;
    uint256 constant FEE = 0.000_02 ether;
    GoghPunkDirectedPaidMintFactory factory;
    DirectedPaidTestCollection art;
    DirectedPaidRecipient recipient;

    function setUp() public {
        VM.chainId(4663);
        VM.warp(1_800_000_000);
        VM.deal(OWNER, 100 ether);
        VM.etch(PUNKS, address(new MockCanonicalGoghPunks()).code);
        MockCanonicalGoghPunks(PUNKS).mint(OWNER, 93);
        VM.etch(SEA, address(new PaidSeaDropMock()).code);
        VM.etch(IMPL, address(new PaidCloneImplementationMarker()).code);
        art = new DirectedPaidTestCollection();
        recipient = new DirectedPaidRecipient();
        DirectedPaidTestRegistry registry = new DirectedPaidTestRegistry(address(recipient));
        factory = new GoghPunkDirectedPaidMintFactory(
            address(registry),
            address(registry).codehash,
            SEA.codehash,
            IMPL.codehash,
            address(art).codehash
        );
        _price(PRICE);
    }

    function _price(uint256 amount) private {
        PaidSeaDropMock(SEA)
            .configure(
                uint80(amount), uint48(block.timestamp - 1), uint48(block.timestamp + 1 days), 25
            );
    }

    function _authorize(uint256 price, uint256 fee, address worker, uint64 generation)
        private
        returns (GoghPunkDirectedPaidMint)
    {
        VM.prank(OWNER);
        return factory.authorize{ value: price + fee }(
            93,
            worker,
            address(art),
            address(art).codehash,
            price,
            fee,
            generation,
            uint48(block.timestamp + 600)
        );
    }

    function _execute(GoghPunkDirectedPaidMint vault) private {
        VM.prank(WORKER);
        vault.execute(1);
    }

    function _active(GoghPunkDirectedPaidMint vault) private view returns (bool) {
        (,,,,,,,, GoghPunkDirectedPaidMint.Status status) = vault.mission();
        return status == GoghPunkDirectedPaidMint.Status.ACTIVE;
    }

    function testOneOwnerTransactionFundsAndAuthorizesThenWorkerMints() public {
        uint256 before = OWNER.balance;
        GoghPunkDirectedPaidMint vault = _authorize(PRICE, FEE, WORKER, 0);
        require(OWNER.balance == before - PRICE - FEE && address(vault).balance == PRICE + FEE);
        _execute(vault);
        require(art.ownerOf(1) == address(recipient) && address(vault).balance == 0);
        require(WORKER.balance == FEE && SEA.balance == PRICE && !_active(vault));
    }

    function testFuzzExactBudgetAndSingleNft(uint80 rawPrice, uint64 fee) public {
        uint256 price = uint256(rawPrice) % 1 ether + 1;
        _price(price);
        GoghPunkDirectedPaidMint vault = _authorize(price, fee, WORKER, 0);
        _execute(vault);
        require(
            art.balanceOf(address(recipient)) == 1 && SEA.balance == price && WORKER.balance == fee
        );
        require(address(vault).balance == 0);
    }

    function testCannotExecuteTwiceOrReplayGeneration() public {
        GoghPunkDirectedPaidMint vault = _authorize(PRICE, FEE, WORKER, 0);
        _execute(vault);
        VM.expectRevert();
        _execute(vault);
        VM.expectRevert();
        _authorize(PRICE, FEE, WORKER, 0);
        require(address(_authorize(PRICE, FEE, WORKER, 1)) == address(vault));
        VM.expectRevert();
        _execute(vault);
        VM.prank(WORKER);
        vault.execute(2);
        require(art.balanceOf(address(recipient)) == 2 && art.mintedBy(address(vault)) == 2);
    }

    function testCannotReplaceActiveMission() public {
        _authorize(PRICE, FEE, WORKER, 0);
        VM.expectRevert();
        _authorize(PRICE, FEE, WORKER, 1);
    }

    function testOnlyOwnerAuthorizesAndOnlyWorkerExecutes() public {
        VM.prank(BUYER);
        VM.expectRevert();
        factory.authorize(
            93,
            WORKER,
            address(art),
            address(art).codehash,
            PRICE,
            FEE,
            0,
            uint48(block.timestamp + 600)
        );
        GoghPunkDirectedPaidMint vault = _authorize(PRICE, FEE, WORKER, 0);
        VM.prank(OWNER);
        VM.expectRevert();
        vault.execute(1);
        VM.prank(BUYER);
        VM.expectRevert();
        vault.execute(1);
    }

    function testRejectsWrongPaymentRuntimeZeroPriceAndLongExpiry() public {
        VM.startPrank(OWNER);
        VM.expectRevert();
        factory.authorize{ value: PRICE }(
            93,
            WORKER,
            address(art),
            address(art).codehash,
            PRICE,
            FEE,
            0,
            uint48(block.timestamp + 600)
        );
        VM.expectRevert();
        factory.authorize{ value: PRICE + FEE }(
            93,
            WORKER,
            address(art),
            bytes32(uint256(1)),
            PRICE,
            FEE,
            0,
            uint48(block.timestamp + 600)
        );
        VM.expectRevert();
        factory.authorize{ value: FEE }(
            93,
            WORKER,
            address(art),
            address(art).codehash,
            0,
            FEE,
            0,
            uint48(block.timestamp + 600)
        );
        VM.expectRevert();
        factory.authorize{ value: PRICE + FEE }(
            93,
            WORKER,
            address(art),
            address(art).codehash,
            PRICE,
            FEE,
            0,
            uint48(block.timestamp + 601)
        );
        VM.stopPrank();
    }

    function testPriceChangeRejectsAtAuthorizationAndExecution() public {
        _price(PRICE + 1);
        VM.expectRevert();
        _authorize(PRICE, FEE, WORKER, 0);
        _price(PRICE);
        GoghPunkDirectedPaidMint vault = _authorize(PRICE, FEE, WORKER, 0);
        _price(PRICE + 1);
        VM.expectRevert();
        _execute(vault);
        _price(0);
        VM.expectRevert();
        _execute(vault);
        require(_active(vault) && address(vault).balance == PRICE + FEE && art.minted() == 0);
    }

    function testChangedCodeCannotSpend() public {
        GoghPunkDirectedPaidMint vault = _authorize(PRICE, FEE, WORKER, 0);
        VM.etch(address(art), hex"00");
        VM.expectRevert();
        _execute(vault);
        require(_active(vault) && address(vault).balance == PRICE + FEE);
    }

    function testExpiryAllowsAnyoneToCancelButOnlyFunderCanRefund() public {
        GoghPunkDirectedPaidMint vault = _authorize(PRICE, FEE, WORKER, 0);
        VM.warp(block.timestamp + 601);
        VM.expectRevert();
        _execute(vault);
        VM.prank(BUYER);
        vault.cancel(1);
        VM.prank(BUYER);
        VM.expectRevert();
        vault.withdrawRefund(payable(BUYER));
        VM.prank(OWNER);
        vault.withdrawRefund(payable(OWNER));
        require(OWNER.balance == 100 ether && address(vault).balance == 0);
    }

    function testOwnerCancelStopsExecutionAndPreservesExactRefund() public {
        GoghPunkDirectedPaidMint vault = _authorize(PRICE, FEE, WORKER, 0);
        VM.prank(BUYER);
        VM.expectRevert();
        vault.cancel(1);
        VM.prank(OWNER);
        vault.cancel(1);
        VM.expectRevert();
        _execute(vault);
        require(vault.refundable(OWNER) == PRICE + FEE && vault.refundLiability() == PRICE + FEE);
        VM.prank(OWNER);
        vault.withdrawRefund(payable(BUYER));
        require(BUYER.balance == PRICE + FEE);
        VM.prank(OWNER);
        VM.expectRevert();
        vault.withdrawRefund(payable(OWNER));
    }

    function testTransferStopsMintAndBuyerCannotTakeOriginalBudget() public {
        GoghPunkDirectedPaidMint vault = _authorize(PRICE, FEE, WORKER, 0);
        VM.prank(OWNER);
        MockCanonicalGoghPunks(PUNKS).transferFrom(OWNER, BUYER, 93);
        VM.expectRevert();
        _execute(vault);
        VM.prank(BUYER);
        vault.recoverNative(payable(BUYER));
        require(BUYER.balance == 0);
        VM.prank(BUYER);
        vault.cancel(1);
        VM.prank(BUYER);
        vault.recoverNative(payable(BUYER));
        require(BUYER.balance == 0);
        VM.prank(OWNER);
        vault.withdrawRefund(payable(OWNER));
        require(OWNER.balance == 100 ether);
    }

    function testPendingRefundIsNotSpentByNextMission() public {
        GoghPunkDirectedPaidMint vault = _authorize(PRICE, FEE, WORKER, 0);
        VM.prank(OWNER);
        vault.cancel(1);
        _authorize(PRICE, FEE, WORKER, 1);
        VM.prank(WORKER);
        vault.execute(2);
        require(address(vault).balance == PRICE + FEE && vault.refundable(OWNER) == PRICE + FEE);
        VM.prank(OWNER);
        vault.withdrawRefund(payable(OWNER));
        require(address(vault).balance == 0);
    }

    function testRejectingNftRecipientRollsBackMintPaymentAndCompletion() public {
        GoghPunkDirectedPaidMint vault = _authorize(PRICE, FEE, WORKER, 0);
        recipient.setReject(true);
        VM.expectRevert();
        _execute(vault);
        require(_active(vault) && art.minted() == 0 && SEA.balance == 0 && WORKER.balance == 0);
        recipient.setReject(false);
        _execute(vault);
    }

    function testExtraNftCannotPassPostcondition() public {
        GoghPunkDirectedPaidMint vault = _authorize(PRICE, FEE, WORKER, 0);
        art.setExtraMint(true);
        VM.expectRevert();
        _execute(vault);
        require(_active(vault) && art.minted() == 0 && SEA.balance == 0);
    }

    function testRejectingExecutionFeeRollsBackWholeMint() public {
        DirectedPaidRejectFee worker = new DirectedPaidRejectFee();
        GoghPunkDirectedPaidMint vault = _authorize(PRICE, FEE, address(worker), 0);
        VM.prank(address(worker));
        VM.expectRevert();
        vault.execute(1);
        require(_active(vault) && art.minted() == 0 && SEA.balance == 0);
    }

    function testNoWorkerRecoveryAndNoEscrowDrain() public {
        GoghPunkDirectedPaidMint vault = _authorize(PRICE, FEE, WORKER, 0);
        VM.prank(WORKER);
        VM.expectRevert();
        vault.recoverNative(payable(WORKER));
        VM.deal(address(vault), PRICE + FEE + 1 ether);
        VM.prank(OWNER);
        vault.recoverNative(payable(OWNER));
        require(address(vault).balance == PRICE + FEE);
        _execute(vault);
    }

    function testTransferDuringFeeCallbackRollsBackMintFeeAndCompletion() public {
        DirectedPaidTransferOnFee worker = new DirectedPaidTransferOnFee();
        GoghPunkDirectedPaidMint vault = _authorize(PRICE, FEE, address(worker), 0);
        VM.prank(OWNER);
        MockCanonicalGoghPunks(PUNKS).approve(address(worker), 93);
        VM.prank(address(worker));
        VM.expectRevert();
        vault.execute(1);
        require(MockCanonicalGoghPunks(PUNKS).ownerOf(93) == OWNER);
        require(_active(vault) && art.minted() == 0 && SEA.balance == 0);
        require(address(worker).balance == 0 && address(vault).balance == PRICE + FEE);
    }
}
