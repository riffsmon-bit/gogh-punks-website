// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { GoghPunkMarketplaceBid, IMarketplaceSeaport } from "../src/GoghPunkMarketplaceBid.sol";
import { MockCanonicalGoghPunks, MockERC721 } from "./mocks/TestInfrastructure.sol";

interface MarketplaceIndependentVm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }
    function chainId(uint256) external;
    function deal(address, uint256) external;
    function etch(address, bytes calldata) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function warp(uint256) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

contract IndependentWeth is ERC20 {
    constructor() ERC20("Local Test Wrapped Ether", "TWETH") { }

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }
}

contract IndependentRegistry {
    address public immutable recipient;

    constructor(address recipient_) {
        recipient = recipient_;
    }

    function account(uint256) external view returns (address) {
        return recipient;
    }
}

contract IndependentProtocol {
    mapping(bytes32 => bool) public cancelled;
    bytes32 public constant DOMAIN = keccak256("LOCAL_MOCK_NOT_SEAPORT");

    function getCounter(address) external pure returns (uint256) {
        return 0;
    }

    function getOrderHash(IMarketplaceSeaport.OrderComponents calldata order)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(order));
    }

    function information() external pure returns (string memory, bytes32, address) {
        return ("LOCAL_MOCK_NOT_SEAPORT", DOMAIN, address(0));
    }

    function getOrderStatus(bytes32 orderHash)
        external
        view
        returns (bool, bool, uint256, uint256)
    {
        return (false, cancelled[orderHash], 0, 0);
    }

    function cancel(IMarketplaceSeaport.OrderComponents[] calldata orders) external returns (bool) {
        require(orders.length == 1 && orders[0].offerer == msg.sender);
        cancelled[keccak256(abi.encode(orders[0]))] = true;
        return true;
    }

    // This is deliberately a minimal callback driver, not real-Seaport coverage.
    function fulfill(
        GoghPunkMarketplaceBid escrow,
        IMarketplaceSeaport.ZoneParameters calldata zone,
        IndependentWeth weth,
        MockERC721 art,
        address seller
    ) external {
        escrow.authorizeOrder(zone);
        require(weth.transferFrom(address(escrow), seller, zone.offer[0].amount));
        art.transferFrom(seller, zone.consideration[0].recipient, zone.consideration[0].identifier);
        escrow.validateOrder(zone);
    }

    function authorize(
        GoghPunkMarketplaceBid escrow,
        IMarketplaceSeaport.ZoneParameters calldata zone
    ) external view returns (bytes4) {
        return escrow.authorizeOrder(zone);
    }
}

contract GoghMarketplaceIndependentTest {
    MarketplaceIndependentVm private constant vm =
        MarketplaceIndependentVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address private constant FUNDER = address(0xF00D);
    address private constant SELLER = address(0x5E11);
    address private constant STRANGER = address(0xBAD);
    uint256 private constant PRICE = 0.01 ether;
    IndependentWeth private weth;
    IndependentProtocol private protocol;
    IndependentRegistry private registry;
    MockERC721 private recipient;
    MockERC721 private art;
    GoghPunkMarketplaceBid private escrow;

    function setUp() public {
        vm.chainId(4663);
        vm.warp(1000);
        MockCanonicalGoghPunks model = new MockCanonicalGoghPunks();
        vm.etch(PUNKS, address(model).code);
        MockCanonicalGoghPunks(PUNKS).mint(FUNDER, 93);
        recipient = new MockERC721();
        art = new MockERC721();
        art.mint(SELLER, 7);
        art.mint(SELLER, 8);
        weth = new IndependentWeth();
        protocol = new IndependentProtocol();
        registry = new IndependentRegistry(address(recipient));
        escrow = new GoghPunkMarketplaceBid(address(registry), address(protocol), address(weth));
        vm.deal(FUNDER, 1 ether);
        vm.prank(SELLER);
        art.setApprovalForAll(address(protocol), true);
    }

    function create(bool anyToken) private returns (bytes32 orderHash) {
        uint256 nonce = escrow.nonces(FUNDER);
        vm.prank(FUNDER);
        return escrow.createBid{ value: PRICE }(
            93,
            address(art),
            anyToken ? 0 : 7,
            anyToken,
            PRICE,
            uint48(block.timestamp + 3600),
            nonce,
            address(art).codehash
        );
    }

    function zone(bytes32 orderHash, uint256 tokenId)
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
        z.consideration[0] = IMarketplaceSeaport.ReceivedItem(
            2, address(art), tokenId, 1, payable(address(recipient))
        );
    }

    function testCancelAfterFillIsNoOpWithoutRecoveryEvent() public {
        bytes32 orderHash = create(false);
        protocol.fulfill(escrow, zone(orderHash, 7), weth, art, SELLER);
        require(art.ownerOf(7) == address(recipient), "NFT delivered before cancellation");
        require(weth.balanceOf(SELLER) == PRICE, "seller paid exactly once");
        vm.recordLogs();
        vm.prank(FUNDER);
        escrow.cancelBid(orderHash);
        require(vm.getRecordedLogs().length == 0, "reader must use historical state for no-op");
        require(weth.balanceOf(FUNDER) == 0, "spent funds never refunded");
        require(weth.balanceOf(address(escrow)) == 0, "escrow no longer owns spent WETH");
    }

    function testSecondCancellationIsNoOpWithoutRecoveryEvent() public {
        bytes32 orderHash = create(false);
        vm.prank(FUNDER);
        escrow.cancelBid(orderHash);
        require(weth.balanceOf(FUNDER) == PRICE, "first cancellation refunds funder");
        vm.recordLogs();
        vm.prank(FUNDER);
        escrow.cancelBid(orderHash);
        require(vm.getRecordedLogs().length == 0, "reader must not infer a second refund");
        require(weth.balanceOf(FUNDER) == PRICE, "no second refund");
        require(weth.allowance(address(escrow), address(protocol)) == 0, "no remaining allowance");
    }

    function testCachedSignatureCannotBypassZoneOwnershipCheck() public {
        bytes32 orderHash = create(false);
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", protocol.DOMAIN(), orderHash));
        require(escrow.isValidSignature(digest, "") == 0x1626ba7e);
        vm.prank(FUNDER);
        MockCanonicalGoghPunks(PUNKS).transferFrom(FUNDER, STRANGER, 93);
        require(escrow.isValidSignature(digest, "") == bytes4(0));
        IMarketplaceSeaport.ZoneParameters memory z = zone(orderHash, 7);
        vm.expectRevert(GoghPunkMarketplaceBid.InvalidState.selector);
        protocol.authorize(escrow, z);
    }

    function testAwayAndBackRemainsPublicBlocker() public {
        bytes32 orderHash = create(false);
        vm.prank(FUNDER);
        MockCanonicalGoghPunks(PUNKS).transferFrom(FUNDER, STRANGER, 93);
        vm.prank(STRANGER);
        MockCanonicalGoghPunks(PUNKS).transferFrom(STRANGER, FUNDER, 93);
        protocol.fulfill(escrow, zone(orderHash, 7), weth, art, SELLER);
        require(weth.balanceOf(SELLER) == PRICE, "known public-release blocker reproduced");
    }

    function testNewOwnerCannotRecoverPredecessorFunds() public {
        bytes32 orderHash = create(false);
        vm.prank(FUNDER);
        MockCanonicalGoghPunks(PUNKS).transferFrom(FUNDER, STRANGER, 93);
        vm.prank(STRANGER);
        vm.expectRevert(GoghPunkMarketplaceBid.Unauthorized.selector);
        escrow.cancelBid(orderHash);
        vm.prank(FUNDER);
        escrow.cancelBid(orderHash);
        require(weth.balanceOf(FUNDER) == PRICE && weth.balanceOf(STRANGER) == 0);
    }

    function testPooledFundsDoNotRefundSettledBidFromAnotherBid() public {
        bytes32 filled = create(false);
        bytes32 active = create(true);
        protocol.fulfill(escrow, zone(filled, 7), weth, art, SELLER);
        vm.prank(FUNDER);
        escrow.cancelBid(filled);
        require(weth.balanceOf(address(escrow)) == PRICE, "other bid remains funded");
        vm.prank(FUNDER);
        escrow.cancelBid(active);
        require(weth.balanceOf(FUNDER) == PRICE && weth.balanceOf(SELLER) == PRICE);
    }

    function testCriteriaResolvesOneTokenAndDeliversToCanonicalRecipient() public {
        bytes32 orderHash = create(true);
        protocol.fulfill(escrow, zone(orderHash, 8), weth, art, SELLER);
        require(art.ownerOf(8) == address(recipient) && weth.balanceOf(SELLER) == PRICE);
    }

    function testZoneRejectsWrongRecipientAndWrongExactToken() public {
        bytes32 orderHash = create(false);
        IMarketplaceSeaport.ZoneParameters memory z = zone(orderHash, 8);
        vm.expectRevert(GoghPunkMarketplaceBid.InvalidState.selector);
        protocol.authorize(escrow, z);
        z = zone(orderHash, 7);
        z.consideration[0].recipient = payable(STRANGER);
        vm.expectRevert(GoghPunkMarketplaceBid.InvalidState.selector);
        protocol.authorize(escrow, z);
    }

    function testUnauthenticatedZoneCallAndNonceReplayFail() public {
        bytes32 orderHash = create(false);
        IMarketplaceSeaport.ZoneParameters memory z = zone(orderHash, 7);
        vm.expectRevert(GoghPunkMarketplaceBid.InvalidState.selector);
        escrow.validateOrder(z);
        vm.prank(FUNDER);
        vm.expectRevert(GoghPunkMarketplaceBid.InvalidBid.selector);
        escrow.createBid{ value: PRICE }(
            93,
            address(art),
            7,
            false,
            PRICE,
            uint48(block.timestamp + 3600),
            0,
            address(art).codehash
        );
    }
}
