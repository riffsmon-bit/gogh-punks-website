// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;
import { GoghPunkMarketplaceGuard } from "../src/GoghPunkMarketplaceGuard.sol";
import { MockCanonicalGoghPunks, MockERC721, TestVm } from "./mocks/TestInfrastructure.sol";

contract MarketplaceGuardAccountFixture {
    address public owner;
    uint256 public state = 5;

    constructor(address owner_) {
        owner = owner_;
    }

    function setOwner(address owner_) external {
        owner = owner_;
    }

    function setState(uint256 state_) external {
        state = state_;
    }
}

contract MarketplaceGuardRegistryFixture {
    address public immutable wallet;

    constructor(address wallet_) {
        wallet = wallet_;
    }

    function account(uint256) external view returns (address) {
        return wallet;
    }
}

contract GoghMarketplaceGuardTest {
    TestVm private constant vm = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address private constant OWNER = address(0xA11CE);
    MarketplaceGuardAccountFixture private wallet;
    MarketplaceGuardRegistryFixture private registry;
    MockERC721 private art;
    GoghPunkMarketplaceGuard private guard;

    function setUp() public {
        vm.chainId(4663);
        MockCanonicalGoghPunks model = new MockCanonicalGoghPunks();
        vm.etch(PUNKS, address(model).code);
        MockCanonicalGoghPunks(PUNKS).mint(OWNER, 93);
        wallet = new MarketplaceGuardAccountFixture(OWNER);
        registry = new MarketplaceGuardRegistryFixture(address(wallet));
        art = new MockERC721();
        art.mint(address(wallet), 1);
        art.mint(address(wallet), 2);
        guard = new GoghPunkMarketplaceGuard(address(registry));
        vm.deal(address(wallet), 1 ether);
    }

    function check(uint256 reserve, uint256 deadline) private {
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;
        vm.prank(address(wallet));
        guard.assertPurchase(
            93, OWNER, 5, address(art), address(art).codehash, ids, reserve, deadline
        );
    }

    function testExactStateOwnerRecipientAndReservePass() public {
        check(1 ether, block.timestamp + 60);
    }

    function testReserveAfterInterleavedSpendingFails() public {
        vm.deal(address(wallet), 0.1 ether);
        vm.expectRevert(GoghPunkMarketplaceGuard.InvalidPurchasePostcondition.selector);
        check(0.2 ether, block.timestamp + 60);
    }

    function testChangedAccountStateFails() public {
        wallet.setState(6);
        vm.expectRevert(GoghPunkMarketplaceGuard.InvalidPurchasePostcondition.selector);
        check(0, block.timestamp + 60);
    }

    function testTransferredPunkFails() public {
        vm.prank(OWNER);
        MockCanonicalGoghPunks(PUNKS).transferFrom(OWNER, address(0xB0B), 93);
        vm.expectRevert(GoghPunkMarketplaceGuard.InvalidPurchasePostcondition.selector);
        check(0, block.timestamp + 60);
    }

    function testChangedWalletOwnerFails() public {
        wallet.setOwner(address(0xB0B));
        vm.expectRevert(GoghPunkMarketplaceGuard.InvalidPurchasePostcondition.selector);
        check(0, block.timestamp + 60);
    }

    function testExpiredReviewFailsOnchain() public {
        uint256 expires = block.timestamp + 60;
        vm.warp(expires + 1);
        vm.expectRevert(GoghPunkMarketplaceGuard.InvalidPurchasePostcondition.selector);
        check(0, expires);
    }

    function testRecipientDoesNotOwnAssetFails() public {
        vm.prank(address(wallet));
        art.transferFrom(address(wallet), OWNER, 2);
        vm.expectRevert(GoghPunkMarketplaceGuard.InvalidPurchasePostcondition.selector);
        check(0, block.timestamp + 60);
    }

    function testFalseEOACallerFails() public {
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.prank(OWNER);
        vm.expectRevert(GoghPunkMarketplaceGuard.InvalidPurchasePostcondition.selector);
        guard.assertPurchase(
            93, OWNER, 5, address(art), address(art).codehash, ids, 0, block.timestamp + 60
        );
    }

    function testDuplicateAssetsFail() public {
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 1;
        vm.prank(address(wallet));
        vm.expectRevert(GoghPunkMarketplaceGuard.InvalidPurchasePostcondition.selector);
        guard.assertPurchase(
            93, OWNER, 5, address(art), address(art).codehash, ids, 0, block.timestamp + 60
        );
    }

    function testCollectionRuntimeMismatchFails() public {
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.prank(address(wallet));
        vm.expectRevert(GoghPunkMarketplaceGuard.InvalidPurchasePostcondition.selector);
        guard.assertPurchase(
            93, OWNER, 5, address(art), bytes32(uint256(1)), ids, 0, block.timestamp + 60
        );
    }

    function testRegistryRuntimeMismatchFails() public {
        vm.etch(address(registry), hex"60006000f3");
        vm.expectRevert(GoghPunkMarketplaceGuard.InvalidPurchasePostcondition.selector);
        check(0, block.timestamp + 60);
    }

    function testFuzzReserveIsNeverRoundedDown(uint128 reserve) public {
        if (reserve <= 1 ether) {
            check(reserve, block.timestamp + 60);
        } else {
            vm.expectRevert(GoghPunkMarketplaceGuard.InvalidPurchasePostcondition.selector);
            check(reserve, block.timestamp + 60);
        }
    }
}
