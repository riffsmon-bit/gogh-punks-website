// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {
    IndependentWeth,
    IndependentRegistry,
    IndependentProtocol,
    MarketplaceIndependentVm
} from "./GoghMarketplaceIndependent.t.sol";
import { GoghPunkMarketplaceBid, IMarketplaceSeaport } from "../src/GoghPunkMarketplaceBid.sol";
import { MockCanonicalGoghPunks, MockERC721 } from "./mocks/TestInfrastructure.sol";

/// @dev Local owner actor: each transfer is called by its current owner, not an
///      operator whose approval would have to survive the first transfer.
contract WethReadinessOwner {
    address private immutable controller = msg.sender;

    function transferPunk(address punks, address next) external {
        require(msg.sender == controller);
        MockCanonicalGoghPunks(punks).transferFrom(address(this), next, 93);
    }

    function create(GoghPunkMarketplaceBid escrow, address art, bool anyToken, uint48 deadline)
        external
        returns (bytes32)
    {
        require(msg.sender == controller);
        return escrow.createBid{ value: 0.01 ether }(
            93,
            art,
            anyToken ? 0 : 7,
            anyToken,
            0.01 ether,
            deadline,
            escrow.nonces(address(this)),
            art.codehash
        );
    }

    function cancel(GoghPunkMarketplaceBid escrow, bytes32 orderHash) external {
        require(msg.sender == controller);
        escrow.cancelBid(orderHash);
    }
}

/// @notice Characterizes a release blocker, not a passing public-bidding design.
/// @dev The escrow is the actual candidate source. Punk, registry, WETH and
///      protocol are offline models; the existing fork proof covers Seaport 1.6.
contract GoghWethReleaseReadinessTest {
    MarketplaceIndependentVm private constant vm =
        MarketplaceIndependentVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address private constant SELLER = address(0x5E11);
    uint256 private constant PRICE = 0.01 ether;
    IndependentWeth private weth;
    IndependentProtocol private protocol;
    IndependentRegistry private registry;
    MockERC721 private recipient;
    MockERC721 private art;
    GoghPunkMarketplaceBid private escrow;
    WethReadinessOwner private alice;
    WethReadinessOwner private bob;

    function setUp() public {
        vm.chainId(4663);
        vm.warp(1000);
        MockCanonicalGoghPunks model = new MockCanonicalGoghPunks();
        vm.etch(PUNKS, address(model).code);
        alice = new WethReadinessOwner();
        bob = new WethReadinessOwner();
        MockCanonicalGoghPunks(PUNKS).mint(address(alice), 93);
        recipient = new MockERC721();
        art = new MockERC721();
        art.mint(SELLER, 7);
        weth = new IndependentWeth();
        protocol = new IndependentProtocol();
        registry = new IndependentRegistry(address(recipient));
        escrow = new GoghPunkMarketplaceBid(address(registry), address(protocol), address(weth));
        vm.deal(address(alice), 1 ether);
        vm.prank(SELLER);
        art.setApprovalForAll(address(protocol), true);
    }

    function zone(bytes32 orderHash)
        private
        view
        returns (IMarketplaceSeaport.ZoneParameters memory z)
    {
        z.orderHash = orderHash;
        z.offerer = address(escrow);
        z.fulfiller = SELLER;
        z.offer = new IMarketplaceSeaport.SpentItem[](1);
        z.offer[0] = IMarketplaceSeaport.SpentItem(1, address(weth), 0, PRICE);
        z.consideration = new IMarketplaceSeaport.ReceivedItem[](1);
        z.consideration[0] =
            IMarketplaceSeaport.ReceivedItem(2, address(art), 7, 1, payable(address(recipient)));
    }

    function digest(bytes32 orderHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked(hex"1901", protocol.DOMAIN(), orderHash));
    }

    function observedState(bytes32 orderHash) private view returns (bytes32) {
        (bool ok, bytes memory bid) =
            address(escrow).staticcall(abi.encodeWithSelector(escrow.bids.selector, orderHash));
        require(ok, "complete immutable/order/status snapshot available");
        bytes32 authorization = keccak256(
            abi.encode(
                bid,
                escrow.orderComponents(orderHash),
                escrow.digestOrders(digest(orderHash)),
                escrow.nonces(address(alice)),
                protocol.getCounter(address(escrow)),
                MockCanonicalGoghPunks(PUNKS).ownerOf(93),
                registry.account(93)
            )
        );
        bytes32 dependencies = keccak256(
            abi.encode(
                address(registry).codehash,
                address(protocol).codehash,
                address(weth).codehash,
                address(recipient).codehash,
                address(art).codehash
            )
        );
        return keccak256(
            abi.encode(
                authorization,
                dependencies,
                weth.balanceOf(address(escrow)),
                weth.allowance(address(escrow), address(protocol)),
                block.chainid,
                block.number,
                block.timestamp
            )
        );
    }

    function roundTripAndFulfill(bool anyToken, uint48 deadline) private {
        bytes32 orderHash = alice.create(escrow, address(art), anyToken, deadline);
        bytes32 beforeState = observedState(orderHash);
        require(escrow.isValidSignature(digest(orderHash), "") == 0x1626ba7e);

        // All calls below occur in this ONE test transaction, with no prank,
        // block advance, or opportunity for an off-chain watcher transaction.
        alice.transferPunk(PUNKS, address(bob));
        require(escrow.isValidSignature(digest(orderHash), "") == bytes4(0));
        IMarketplaceSeaport.ZoneParameters memory z = zone(orderHash);
        vm.expectRevert(GoghPunkMarketplaceBid.InvalidState.selector);
        protocol.authorize(escrow, z);
        bob.transferPunk(PUNKS, address(alice));

        require(observedState(orderHash) == beforeState, "every sampled bid input is restored");
        require(
            escrow.isValidSignature(digest(orderHash), "") == 0x1626ba7e,
            "old signature revives without new funding or authorization"
        );
        protocol.fulfill(escrow, z, weth, art, SELLER);
        require(
            art.ownerOf(7) == address(recipient), "old offer delivers after transfer round trip"
        );
        require(weth.balanceOf(SELLER) == PRICE, "old offer spends its original funding once");
    }

    function testSameTransactionExactOfferRevivesWithIdenticalObservedState() public {
        roundTripAndFulfill(false, uint48(block.timestamp + 3600));
    }

    function testSameTransactionCollectionOfferRevivesWithIdenticalObservedState() public {
        roundTripAndFulfill(true, uint48(block.timestamp + 3600));
    }

    function testOneSecondExpiryStillAllowsPreExpiryRoundTripRevival() public {
        roundTripAndFulfill(false, uint48(block.timestamp + 1));
    }

    function testSelfTransferLeavesStandingOfferAndObservedStateUnchanged() public {
        bytes32 orderHash = alice.create(escrow, address(art), false, uint48(block.timestamp + 60));
        bytes32 beforeState = observedState(orderHash);
        alice.transferPunk(PUNKS, address(alice));
        require(observedState(orderHash) == beforeState);
        require(escrow.isValidSignature(digest(orderHash), "") == 0x1626ba7e);
        protocol.fulfill(escrow, zone(orderHash), weth, art, SELLER);
        require(weth.balanceOf(SELLER) == PRICE);
    }

    function testExplicitCancellationRemainsTerminalAfterReturn() public {
        bytes32 orderHash = alice.create(escrow, address(art), false, uint48(block.timestamp + 60));
        alice.transferPunk(PUNKS, address(bob));
        alice.cancel(escrow, orderHash);
        bob.transferPunk(PUNKS, address(alice));
        require(escrow.isValidSignature(digest(orderHash), "") == bytes4(0));
        IMarketplaceSeaport.ZoneParameters memory z = zone(orderHash);
        vm.expectRevert(GoghPunkMarketplaceBid.InvalidState.selector);
        protocol.authorize(escrow, z);
        require(weth.balanceOf(address(alice)) == PRICE);
        alice.cancel(escrow, orderHash);
        require(weth.balanceOf(address(alice)) == PRICE, "no duplicate local refund");
    }
}
