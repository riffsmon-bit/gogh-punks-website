// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { IERC1155Receiver } from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import { GoghBrokerTypes } from "../../src/GoghBrokerTypes.sol";
import { IERC6551Registry } from "../../src/interfaces/IERC6551Registry.sol";
import { IGoghMarketplaceAdapter } from "../../src/interfaces/IGoghMarketplaceAdapter.sol";

interface TestVm {
    function addr(uint256 privateKey) external returns (address);
    function chainId(uint256 newChainId) external;
    function deal(address account, uint256 newBalance) external;
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function expectRevert() external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function startPrank(address sender) external;
    function stopPrank() external;
    function store(address target, bytes32 slot, bytes32 value) external;
    function warp(uint256 newTimestamp) external;
}

/// @dev Exact canonical ERC-6551 reference registry algorithm and proxy footer layout.
contract ERC6551RegistryHarness is IERC6551Registry {
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address) {
        assembly {
            pop(chainId)
            calldatacopy(0x8c, 0x24, 0x80)
            mstore(0x6c, 0x5af43d82803e903d91602b57fd5bf3)
            mstore(0x5d, implementation)
            mstore(0x49, 0x3d60ad80600a3d3981f3363d3d373d3d3d363d73)
            mstore(0x35, keccak256(0x55, 0xb7))
            mstore(0x15, salt)
            mstore(0x01, shl(96, address()))
            mstore8(0x00, 0xff)
            let computed := keccak256(0x00, 0x55)

            if iszero(extcodesize(computed)) {
                let deployed := create2(0, 0x55, 0xb7, salt)
                if iszero(deployed) {
                    mstore(0x00, 0x20188a59)
                    revert(0x1c, 0x04)
                }
                mstore(0x6c, deployed)
                log4(
                    0x6c,
                    0x60,
                    0x79f19b3655ee38b1ce526556b7731a20c8f218fbda4a3990b6cc4172fdf88722,
                    implementation,
                    tokenContract,
                    tokenId
                )
                return(0x6c, 0x20)
            }

            mstore(0x00, shr(96, shl(96, computed)))
            return(0x00, 0x20)
        }
    }

    function account(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external view returns (address) {
        assembly {
            pop(chainId)
            pop(tokenContract)
            pop(tokenId)
            calldatacopy(0x8c, 0x24, 0x80)
            mstore(0x6c, 0x5af43d82803e903d91602b57fd5bf3)
            mstore(0x5d, implementation)
            mstore(0x49, 0x3d60ad80600a3d3981f3363d3d373d3d3d363d73)
            mstore(0x35, keccak256(0x55, 0xb7))
            mstore(0x15, salt)
            mstore(0x01, shl(96, address()))
            mstore8(0x00, 0xff)
            mstore(0x00, shr(96, shl(96, keccak256(0x00, 0x55))))
            return(0x00, 0x20)
        }
    }
}

/// @dev Slot zero is intentionally the owners mapping so tests can etch it at the canonical address.
contract MockCanonicalGoghPunks {
    mapping(uint256 tokenId => address owner) private _owners;
    mapping(uint256 tokenId => address approved) private _approvals;

    error NotAuthorized();
    error MissingToken();
    error InvalidRecipient();

    function mint(address recipient, uint256 tokenId) external {
        if (recipient == address(0) || _owners[tokenId] != address(0)) revert InvalidRecipient();
        _owners[tokenId] = recipient;
    }

    function ownerOf(uint256 tokenId) external view returns (address tokenOwner) {
        tokenOwner = _owners[tokenId];
        if (tokenOwner == address(0)) revert MissingToken();
    }

    function approve(address approved, uint256 tokenId) external {
        if (msg.sender != _owners[tokenId]) revert NotAuthorized();
        _approvals[tokenId] = approved;
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (msg.sender != from && msg.sender != _approvals[tokenId]) revert NotAuthorized();
        if (_owners[tokenId] != from) revert NotAuthorized();
        if (to == address(0)) revert InvalidRecipient();
        _owners[tokenId] = to;
        delete _approvals[tokenId];
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length != 0) {
            bytes4 response = IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data);
            require(response == IERC721Receiver.onERC721Received.selector, "unsafe recipient");
        }
    }
}

contract MockERC721 {
    mapping(uint256 tokenId => address owner) private _owners;
    mapping(uint256 tokenId => address approved) private _approvals;
    mapping(address owner => mapping(address operator => bool approved)) public isApprovedForAll;

    function mint(address recipient, uint256 tokenId) external {
        require(recipient != address(0) && _owners[tokenId] == address(0), "invalid mint");
        _owners[tokenId] = recipient;
    }

    function ownerOf(uint256 tokenId) external view returns (address tokenOwner) {
        tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "missing");
    }

    function approve(address approved, uint256 tokenId) external {
        require(msg.sender == _owners[tokenId], "not owner");
        _approvals[tokenId] = approved;
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        return _approvals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(
            msg.sender == from || msg.sender == _approvals[tokenId]
                || isApprovedForAll[from][msg.sender],
            "not approved"
        );
        require(_owners[tokenId] == from && to != address(0), "invalid transfer");
        _owners[tokenId] = to;
        delete _approvals[tokenId];
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
        if (to.code.length != 0) {
            require(
                IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, "")
                    == IERC721Receiver.onERC721Received.selector,
                "unsafe"
            );
        }
    }
}

/// @dev A hostile collection can claim ownership without implementing a real transferable NFT.
///      It exists to prove that an unreviewed collection is stopped before venue execution.
contract MockLyingERC721 {
    address public claimedOwner;

    function ownerOf(uint256) external view returns (address) {
        require(claimedOwner != address(0), "missing");
        return claimedOwner;
    }

    function safeTransferFrom(address, address recipient, uint256) external {
        claimedOwner = recipient;
    }
}

contract MockERC1155 {
    mapping(address account => mapping(uint256 id => uint256 amount)) private _balances;

    function mint(address recipient, uint256 id, uint256 amount) external {
        _balances[recipient][id] += amount;
        if (recipient.code.length != 0) {
            require(
                IERC1155Receiver(recipient)
                        .onERC1155Received(msg.sender, address(0), id, amount, "")
                    == IERC1155Receiver.onERC1155Received.selector,
                "unsafe"
            );
        }
    }

    function balanceOf(address account, uint256 id) external view returns (uint256) {
        return _balances[account][id];
    }
}

contract MockERC20 is IERC20 {
    string public constant name = "Mock Token";
    string public constant symbol = "MOCK";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address account => mapping(address spender => uint256 amount)) public allowance;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
        totalSupply += amount;
        emit Transfer(address(0), recipient, amount);
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount)
        external
        returns (bool)
    {
        uint256 approved = allowance[sender][msg.sender];
        require(approved >= amount, "allowance");
        allowance[sender][msg.sender] = approved - amount;
        _transfer(sender, recipient, amount);
        return true;
    }

    function _transfer(address sender, address recipient, uint256 amount) private {
        require(balanceOf[sender] >= amount, "balance");
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(sender, recipient, amount);
    }
}

contract MockMarketplace {
    bool public reenter;
    bytes public reentryCall;

    function purchaseNative(address collection, uint256 tokenId, address recipient, uint256 price)
        external
        payable
    {
        require(msg.value == price, "price");
        MockERC721(collection).safeTransferFrom(address(this), recipient, tokenId);
    }

    function purchaseERC20(
        address collection,
        uint256 tokenId,
        address recipient,
        address currency,
        uint256 price
    ) external {
        require(IERC20(currency).transferFrom(msg.sender, address(this), price), "payment");
        MockERC721(collection).safeTransferFrom(address(this), recipient, tokenId);
    }

    function takePaymentWithoutDelivery(uint256 price) external payable {
        require(msg.value == price, "price");
    }

    function mintERC721(address collection, uint256 tokenId, address recipient, uint256 price)
        external
        payable
    {
        require(msg.value == price, "price");
        MockERC721(collection).mint(recipient, tokenId);
    }

    function reentrantPurchase(address account, uint256 price) external payable {
        require(msg.value == price, "price");
        (bool success,) = account.call(reentryCall);
        require(success, "reentry rejected");
    }

    function configureReentry(bytes calldata callData) external {
        reentryCall = callData;
        reenter = true;
    }
}

contract MockMarketplaceAdapter is IGoghMarketplaceAdapter {
    enum Behavior {
        NATIVE_PURCHASE,
        ERC20_PURCHASE,
        NO_DELIVERY,
        MINT_ERC721,
        REENTRANT
    }

    address public immutable override venue;
    GoghBrokerTypes.AdapterKind public immutable override kind;

    constructor(address venue_, GoghBrokerTypes.AdapterKind kind_) {
        venue = venue_;
        kind = kind_;
    }

    /// @dev adapterData = abi.encode(Behavior behavior, uint256 price, uint256 allowanceAmount).
    function buildExecution(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        bytes calldata adapterData
    ) external view returns (GoghBrokerTypes.AdapterExecution memory execution) {
        (Behavior behavior, uint256 price, uint256 allowanceAmount) =
            abi.decode(adapterData, (Behavior, uint256, uint256));
        bytes memory callData;
        address spender;
        uint256 allowance;
        uint256 value;
        if (behavior == Behavior.NATIVE_PURCHASE) {
            callData = abi.encodeCall(
                MockMarketplace.purchaseNative,
                (intent.collection, intent.tokenId, intent.account, price)
            );
            value = price;
        } else if (behavior == Behavior.ERC20_PURCHASE) {
            callData = abi.encodeCall(
                MockMarketplace.purchaseERC20,
                (intent.collection, intent.tokenId, intent.account, intent.currency, price)
            );
            spender = venue;
            allowance = allowanceAmount;
        } else if (behavior == Behavior.NO_DELIVERY) {
            callData = abi.encodeCall(MockMarketplace.takePaymentWithoutDelivery, (price));
            value = price;
        } else if (behavior == Behavior.MINT_ERC721) {
            callData = abi.encodeCall(
                MockMarketplace.mintERC721,
                (intent.collection, intent.tokenId, intent.account, price)
            );
            value = price;
        } else {
            callData = abi.encodeCall(MockMarketplace.reentrantPurchase, (intent.account, price));
            value = price;
        }
        execution = GoghBrokerTypes.AdapterExecution({
            target: venue,
            value: value,
            currency: intent.currency,
            allowanceSpender: spender,
            allowanceAmount: allowance,
            paymentAmount: price,
            callData: callData
        });
    }
}
