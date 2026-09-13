// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMarketplaceRegistry {
    function account(uint256 punkId) external view returns (address);
}

interface IMarketplaceWETH is IERC20 {
    function deposit() external payable;
}

interface IMarketplaceSeaport {
    struct OfferItem {
        uint8 itemType;
        address token;
        uint256 identifierOrCriteria;
        uint256 startAmount;
        uint256 endAmount;
    }

    struct ConsiderationItem {
        uint8 itemType;
        address token;
        uint256 identifierOrCriteria;
        uint256 startAmount;
        uint256 endAmount;
        address payable recipient;
    }

    struct SpentItem {
        uint8 itemType;
        address token;
        uint256 identifier;
        uint256 amount;
    }

    struct ReceivedItem {
        uint8 itemType;
        address token;
        uint256 identifier;
        uint256 amount;
        address payable recipient;
    }

    struct ZoneParameters {
        bytes32 orderHash;
        address fulfiller;
        address offerer;
        SpentItem[] offer;
        ReceivedItem[] consideration;
        bytes extraData;
        bytes32[] orderHashes;
        uint256 startTime;
        uint256 endTime;
        bytes32 zoneHash;
    }

    struct OrderComponents {
        address offerer;
        address zone;
        OfferItem[] offer;
        ConsiderationItem[] consideration;
        uint8 orderType;
        uint256 startTime;
        uint256 endTime;
        bytes32 zoneHash;
        uint256 salt;
        bytes32 conduitKey;
        uint256 counter;
    }
    function getOrderHash(OrderComponents calldata order) external view returns (bytes32);
    function getCounter(address offerer) external view returns (uint256);
    function getOrderStatus(bytes32 orderHash)
        external
        view
        returns (bool isValidated, bool isCancelled, uint256 totalFilled, uint256 totalSize);
    function information() external view returns (string memory, bytes32, address);
    function cancel(OrderComponents[] calldata orders) external returns (bool);
}

/// @notice Exact, owner-funded, single-item WETH offers. No access to Punk Wallet funds.
/// @dev CONTROLLED TEST CANDIDATE. The original collection has no ownership epoch.
///      A transfer away and back cannot be detected here; public activation MUST remain
///      blocked until that limitation has a reviewed solution. No registry/module install.
///      WETH refunds always belong to the original funder, including after transfer/burn.
contract GoghPunkMarketplaceBid is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    uint256 public constant MAX_BID_DURATION = 1 days;
    IMarketplaceRegistry public immutable registry;
    IMarketplaceSeaport public immutable seaport;
    IMarketplaceWETH public immutable weth;
    bytes32 public immutable registryCodeHash;
    bytes32 public immutable seaportCodeHash;
    bytes32 public immutable wethCodeHash;

    enum Status {
        EMPTY,
        ACTIVE,
        SETTLED,
        CANCELLED
    }

    struct Bid {
        address funder;
        address recipient;
        address collection;
        uint256 punkId;
        uint256 tokenId;
        uint256 priceWei;
        uint256 salt;
        uint256 counter;
        uint48 createdAt;
        uint48 deadline;
        bool anyToken;
        bytes32 collectionCodeHash;
        bytes32 recipientCodeHash;
        Status status;
    }
    mapping(bytes32 orderHash => Bid) public bids;
    mapping(bytes32 digest => bytes32 orderHash) public digestOrders;
    mapping(address funder => uint256 nonce) public nonces;

    error InvalidConfiguration();
    error Unauthorized();
    error InvalidBid();
    error InvalidState();
    error ChangedDependency();

    event BidCreated(
        bytes32 indexed orderHash,
        uint256 indexed punkId,
        address indexed funder,
        address recipient,
        address collection,
        uint256 tokenId,
        bool anyToken,
        uint256 priceWei,
        uint48 deadline
    );
    event BidSettled(bytes32 indexed orderHash);
    event BidCancelled(bytes32 indexed orderHash, address indexed funder, uint256 refundedWeth);

    constructor(address registry_, address seaport_, address weth_) {
        if (
            block.chainid != 4663 || PUNKS.code.length == 0 || registry_.code.length == 0
                || seaport_.code.length == 0 || weth_.code.length == 0
        ) revert InvalidConfiguration();
        registry = IMarketplaceRegistry(registry_);
        seaport = IMarketplaceSeaport(seaport_);
        weth = IMarketplaceWETH(weth_);
        registryCodeHash = registry_.codehash;
        seaportCodeHash = seaport_.codehash;
        wethCodeHash = weth_.codehash;
    }

    function createBid(
        uint256 punkId,
        address collection,
        uint256 tokenId,
        bool anyToken,
        uint256 priceWei,
        uint48 deadline,
        uint256 expectedNonce,
        bytes32 collectionCodeHash
    ) external payable nonReentrant returns (bytes32 orderHash) {
        _dependencies();
        if (IERC721(PUNKS).ownerOf(punkId) != msg.sender) revert Unauthorized();
        address recipient = registry.account(punkId);
        if (
            recipient.code.length == 0 || collection == PUNKS || collection == address(this)
                || collection.code.length == 0 || collection.codehash != collectionCodeHash
                || priceWei == 0 || msg.value != priceWei || deadline <= block.timestamp
                || deadline > block.timestamp + MAX_BID_DURATION
                || expectedNonce != nonces[msg.sender] || (anyToken && tokenId != 0)
        ) revert InvalidBid();
        nonces[msg.sender] = expectedNonce + 1;
        Bid memory bid = Bid({
            funder: msg.sender,
            recipient: recipient,
            collection: collection,
            punkId: punkId,
            tokenId: tokenId,
            priceWei: priceWei,
            salt: uint256(
                keccak256(
                    abi.encode(
                        "GOGH_WETH_BID_V1", block.chainid, address(this), msg.sender, expectedNonce
                    )
                )
            ),
            counter: seaport.getCounter(address(this)),
            createdAt: uint48(block.timestamp),
            deadline: deadline,
            anyToken: anyToken,
            collectionCodeHash: collectionCodeHash,
            recipientCodeHash: recipient.codehash,
            status: Status.ACTIVE
        });
        orderHash = seaport.getOrderHash(_order(bid));
        if (bids[orderHash].status != Status.EMPTY) revert InvalidState();
        bids[orderHash] = bid;
        (, bytes32 domain,) = seaport.information();
        digestOrders[keccak256(abi.encodePacked(hex"1901", domain, orderHash))] = orderHash;
        uint256 beforeBalance = weth.balanceOf(address(this));
        weth.deposit{ value: priceWei }();
        if (weth.balanceOf(address(this)) != beforeBalance + priceWei) revert InvalidState();
        // Finite approval equals the WETH actually held, never an unlimited approval.
        // Only exact, internally built active order digests pass ERC-1271 below.
        IERC20(address(weth)).forceApprove(address(seaport), beforeBalance + priceWei);
        emit BidCreated(
            orderHash,
            punkId,
            msg.sender,
            recipient,
            collection,
            tokenId,
            anyToken,
            priceWei,
            deadline
        );
    }

    function orderComponents(bytes32 orderHash)
        external
        view
        returns (IMarketplaceSeaport.OrderComponents memory)
    {
        if (bids[orderHash].status == Status.EMPTY) revert InvalidBid();
        return _order(bids[orderHash]);
    }

    function isValidSignature(bytes32 digest, bytes calldata) external view returns (bytes4) {
        Bid memory bid = bids[digestOrders[digest]];
        if (
            bid.status != Status.ACTIVE || block.timestamp >= bid.deadline
                || address(registry).codehash != registryCodeHash
                || address(seaport).codehash != seaportCodeHash
                || address(weth).codehash != wethCodeHash
                || bid.collection.codehash != bid.collectionCodeHash
                || bid.recipient.codehash != bid.recipientCodeHash
        ) return bytes4(0);
        try IERC721(PUNKS).ownerOf(bid.punkId) returns (address currentOwner) {
            if (currentOwner != bid.funder) return bytes4(0);
        } catch {
            return bytes4(0);
        }
        try registry.account(bid.punkId) returns (address recipient) {
            if (recipient != bid.recipient) return bytes4(0);
        } catch {
            return bytes4(0);
        }
        return 0x1626ba7e;
    }

    // Restricted-order callbacks recheck authority on every fulfillment, even
    // after someone has cached ERC-1271 validation via Seaport.validate().
    function authorizeOrder(IMarketplaceSeaport.ZoneParameters calldata z)
        external
        view
        returns (bytes4)
    {
        _zoneCheck(z);
        return this.authorizeOrder.selector;
    }

    function validateOrder(IMarketplaceSeaport.ZoneParameters calldata z)
        external
        returns (bytes4)
    {
        _zoneCheck(z);
        Bid storage bid = bids[z.orderHash];
        if (IERC721(bid.collection).ownerOf(z.consideration[0].identifier) != bid.recipient) {
            revert InvalidState();
        }
        bid.status = Status.SETTLED;
        emit BidSettled(z.orderHash);
        return this.validateOrder.selector;
    }

    function _zoneCheck(IMarketplaceSeaport.ZoneParameters calldata z) private view {
        _dependencies();
        Bid memory bid = bids[z.orderHash];
        if (
            msg.sender != address(seaport) || z.offerer != address(this)
                || bid.status != Status.ACTIVE || block.timestamp >= bid.deadline
                || IERC721(PUNKS).ownerOf(bid.punkId) != bid.funder
                || registry.account(bid.punkId) != bid.recipient
                || bid.recipient.codehash != bid.recipientCodeHash
                || bid.collection.codehash != bid.collectionCodeHash || z.offer.length != 1
                || z.consideration.length != 1 || z.offer[0].itemType != 1
                || z.offer[0].token != address(weth) || z.offer[0].amount != bid.priceWei
                || z.consideration[0].itemType != 2 || z.consideration[0].token != bid.collection
                || z.consideration[0].amount != 1 || z.consideration[0].recipient != bid.recipient
                || (!bid.anyToken && z.consideration[0].identifier != bid.tokenId)
        ) revert InvalidState();
    }

    /// @notice Reconcile already completed settlement. Does not transfer an asset.
    function settleBid(bytes32 orderHash) external nonReentrant {
        _dependencies();
        Bid storage bid = bids[orderHash];
        if (bid.status == Status.SETTLED) return;
        if (bid.status != Status.ACTIVE || !_filled(orderHash)) revert InvalidState();
        bid.status = Status.SETTLED;
        emit BidSettled(orderHash);
    }

    /// @notice Cancel exact order and return unspent WETH to original funder.
    /// @dev No current-owner requirement: the funder retains recovery after transfer/burn.
    function cancelBid(bytes32 orderHash) external nonReentrant {
        // Registry/Punk state is irrelevant to original-funder recovery.
        if (address(seaport).codehash != seaportCodeHash || address(weth).codehash != wethCodeHash) revert ChangedDependency();
        Bid storage bid = bids[orderHash];
        if (bid.funder != msg.sender) revert Unauthorized();
        if (bid.status == Status.SETTLED || bid.status == Status.CANCELLED) return;
        if (bid.status != Status.ACTIVE) revert InvalidState();
        if (_filled(orderHash)) {
            bid.status = Status.SETTLED;
            emit BidSettled(orderHash);
            return;
        }
        IMarketplaceSeaport.OrderComponents[] memory orders =
            new IMarketplaceSeaport.OrderComponents[](1);
        orders[0] = _order(bid);
        if (!seaport.cancel(orders)) revert InvalidState();
        bid.status = Status.CANCELLED;
        IERC20(address(weth)).safeTransfer(bid.funder, bid.priceWei);
        IERC20(address(weth)).forceApprove(address(seaport), weth.balanceOf(address(this)));
        emit BidCancelled(orderHash, bid.funder, bid.priceWei);
    }

    function _filled(bytes32 orderHash) private view returns (bool) {
        (,, uint256 filled, uint256 size) = seaport.getOrderStatus(orderHash);
        // FULL_RESTRICTED, quantity one: fractional fills are unsupported.
        if (filled != 0 && filled != size) revert InvalidState();
        return size != 0 && filled == size;
    }

    function _dependencies() private view {
        if (
            address(registry).codehash != registryCodeHash
                || address(seaport).codehash != seaportCodeHash
                || address(weth).codehash != wethCodeHash
        ) revert ChangedDependency();
    }

    function _order(Bid memory bid)
        private
        view
        returns (IMarketplaceSeaport.OrderComponents memory order)
    {
        order.offerer = address(this);
        order.offer = new IMarketplaceSeaport.OfferItem[](1);
        order.offer[0] =
            IMarketplaceSeaport.OfferItem(1, address(weth), 0, bid.priceWei, bid.priceWei);
        order.consideration = new IMarketplaceSeaport.ConsiderationItem[](1);
        order.consideration[0] = IMarketplaceSeaport.ConsiderationItem(
            bid.anyToken ? 4 : 2, bid.collection, bid.tokenId, 1, 1, payable(bid.recipient)
        );
        order.zone = address(this);
        order.orderType = 2; // FULL_RESTRICTED: current-owner checks cannot be cached away.
        order.startTime = bid.createdAt;
        order.endTime = bid.deadline;
        order.salt = bid.salt;
        order.counter = bid.counter;
        // zero zoneHash and conduitKey: no external zone or conduit authority.
    }
}
