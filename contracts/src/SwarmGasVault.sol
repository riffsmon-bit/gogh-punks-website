// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISwarmPunks {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface ISwarmAgentRegistry {
    function ROBINHOOD_CHAIN_ID() external view returns (uint256);
    function GOGH_PUNKS() external view returns (address);
    function canonicalRegistry() external view returns (address);
    function implementation() external view returns (address);
    function accountSalt() external view returns (bytes32);
    function account(uint256 tokenId) external view returns (address);
    function isAccountCreated(uint256 tokenId) external view returns (bool);
}

interface ISwarmAgentAccount {
    function owner() external view returns (address);
    function token() external view returns (uint256, address, uint256);
}

/// @dev Immutable configuration shared with the factory. Deployment must pin the reviewed
///      Robinhood addresses; configurable constructor arguments also allow isolated local tests.
abstract contract SwarmGasVaultConfig {
    uint256 public immutable chainId;
    address public immutable collection;
    address public immutable registry;
    address public immutable implementation;
    address public immutable canonicalRegistry;
    bytes32 public immutable accountSalt;
    bytes32 public immutable registryCodeHash;
    bytes32 public immutable implementationCodeHash;

    error InvalidConfiguration();
    error WrongChain();
    error DependencyChanged();

    constructor(uint256 chainId_, address collection_, address registry_, address implementation_) {
        if (chainId_ != block.chainid) revert WrongChain();
        if (
            collection_.code.length == 0 || registry_.code.length == 0
                || implementation_.code.length == 0
        ) revert InvalidConfiguration();
        ISwarmAgentRegistry facade = ISwarmAgentRegistry(registry_);
        address canonical = facade.canonicalRegistry();
        if (
            facade.ROBINHOOD_CHAIN_ID() != chainId_ || facade.GOGH_PUNKS() != collection_
                || facade.implementation() != implementation_ || canonical.code.length == 0
        ) revert InvalidConfiguration();
        chainId = chainId_;
        collection = collection_;
        registry = registry_;
        implementation = implementation_;
        canonicalRegistry = canonical;
        accountSalt = facade.accountSalt();
        registryCodeHash = registry_.codehash;
        implementationCodeHash = implementation_.codehash;
    }

    function _requireChain() internal view {
        if (block.chainid != chainId) revert WrongChain();
    }

    function _requireDependencies() internal view {
        _requireChain();
        ISwarmAgentRegistry facade = ISwarmAgentRegistry(registry);
        if (
            registry.codehash != registryCodeHash
                || implementation.codehash != implementationCodeHash
                || facade.ROBINHOOD_CHAIN_ID() != chainId || facade.GOGH_PUNKS() != collection
                || facade.implementation() != implementation || facade.accountSalt() != accountSalt
                || facade.canonicalRegistry() != canonicalRegistry
        ) revert DependencyChanged();
    }
}

/// @notice A holder-owned ETH wallet for explicit, atomic batches of Punk gas deposits.
/// @dev No worker permission, automatic refill, arbitrary call, upgrade, or project withdrawal.
///      Funds already sent to a Punk belong to that account and follow its NFT ownership.
contract SwarmGasVault is SwarmGasVaultConfig, ReentrancyGuard {
    uint256 public constant MAX_BATCH_SIZE = 10;
    uint256 public constant MAX_PER_PUNK = 1 ether;
    uint256 public constant MAX_BATCH_TOTAL = 10 ether;
    uint256 public constant MAX_DEADLINE_DELAY = 15 minutes;

    address public immutable owner;
    uint256 public nonce;

    struct Allocation {
        uint256 tokenId;
        uint256 amountWei;
    }

    error NotOwner();
    error InvalidBatch();
    error InvalidAmount();
    error InsufficientBalance();
    error InvalidNonce();
    error InvalidDeadline();
    error PunkNotOwned(uint256 tokenId);
    error InvalidAccount(uint256 tokenId);
    error TransferFailed(address recipient);

    event Deposit(address indexed sender, uint256 amountWei);
    event PunkFunded(
        uint256 indexed nonce, uint256 indexed tokenId, address indexed account, uint256 amountWei
    );
    event BatchFunded(uint256 indexed nonce, uint256 count, uint256 totalWei);
    event Withdrawn(uint256 indexed nonce, address indexed owner, uint256 amountWei);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address owner_,
        uint256 chainId_,
        address collection_,
        address registry_,
        address implementation_
    ) SwarmGasVaultConfig(chainId_, collection_, registry_, implementation_) {
        if (owner_ == address(0)) revert InvalidConfiguration();
        owner = owner_;
    }

    receive() external payable {
        _deposit();
    }

    function deposit() external payable {
        _deposit();
    }

    /// @notice Send existing vault ETH to 1–10 currently owned, activated Agent Accounts.
    /// @param allocations Unique Punk IDs in strictly increasing order and exact wei amounts.
    /// @dev Any invalid account or failed transfer reverts the entire batch, including its nonce.
    function fundBatch(Allocation[] calldata allocations, uint256 expectedNonce, uint256 deadline)
        external
        onlyOwner
        nonReentrant
    {
        _requireDependencies();
        uint256 length = allocations.length;
        if (length == 0 || length > MAX_BATCH_SIZE) revert InvalidBatch();
        address[] memory accounts = new address[](length);
        uint256 total;
        for (uint256 i; i < length; ++i) {
            Allocation calldata allocation = allocations[i];
            if (i != 0 && allocation.tokenId <= allocations[i - 1].tokenId) revert InvalidBatch();
            if (allocation.amountWei == 0 || allocation.amountWei > MAX_PER_PUNK) {
                revert InvalidAmount();
            }
            total += allocation.amountWei;
            accounts[i] = _account(allocation.tokenId);
        }
        if (total > MAX_BATCH_TOTAL) revert InvalidAmount();
        if (total > address(this).balance) revert InsufficientBalance();
        _consumeNonce(expectedNonce, deadline);
        for (uint256 i; i < length; ++i) {
            (bool success,) = accounts[i].call{ value: allocations[i].amountWei }("");
            if (!success) revert TransferFailed(accounts[i]);
            emit PunkFunded(
                expectedNonce, allocations[i].tokenId, accounts[i], allocations[i].amountWei
            );
        }
        // Fail atomically even if an external receive hook changed ownership during this batch.
        _requireDependencies();
        for (uint256 i; i < length; ++i) {
            if (_account(allocations[i].tokenId) != accounts[i]) {
                revert InvalidAccount(allocations[i].tokenId);
            }
        }
        emit BatchFunded(expectedNonce, length, total);
    }

    /// @notice Return unused vault ETH only to this vault's immutable holder.
    /// @dev Remains available if the holder owns no Punks or a registry dependency stops working.
    function withdrawToOwner(uint256 amountWei, uint256 expectedNonce, uint256 deadline)
        external
        onlyOwner
        nonReentrant
    {
        _requireChain();
        if (amountWei == 0) revert InvalidAmount();
        if (amountWei > address(this).balance) revert InsufficientBalance();
        _consumeNonce(expectedNonce, deadline);
        (bool success,) = owner.call{ value: amountWei }("");
        if (!success) revert TransferFailed(owner);
        emit Withdrawn(expectedNonce, owner, amountWei);
    }

    function _deposit() private {
        _requireChain();
        if (msg.value == 0) revert InvalidAmount();
        emit Deposit(msg.sender, msg.value);
    }

    function _consumeNonce(uint256 expectedNonce, uint256 deadline) private {
        if (expectedNonce != nonce) revert InvalidNonce();
        if (deadline <= block.timestamp || deadline - block.timestamp > MAX_DEADLINE_DELAY) {
            revert InvalidDeadline();
        }
        nonce = expectedNonce + 1;
    }

    function _account(uint256 tokenId) private view returns (address accountAddress) {
        try ISwarmPunks(collection).ownerOf(tokenId) returns (address tokenOwner) {
            if (tokenOwner != owner) revert PunkNotOwned(tokenId);
        } catch {
            revert PunkNotOwned(tokenId);
        }
        ISwarmAgentRegistry facade = ISwarmAgentRegistry(registry);
        accountAddress = facade.account(tokenId);
        bytes memory runtime = abi.encodePacked(
            hex"363d3d373d3d3d363d73",
            implementation,
            hex"5af43d82803e903d91602b57fd5bf3",
            abi.encode(accountSalt, chainId, collection, tokenId)
        );
        address canonical = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff),
                            canonicalRegistry,
                            accountSalt,
                            keccak256(abi.encodePacked(hex"3d60ad80600a3d3981f3", runtime))
                        )
                    )
                )
            )
        );
        if (
            accountAddress != canonical || !facade.isAccountCreated(tokenId)
                || accountAddress.codehash != keccak256(runtime)
        ) revert InvalidAccount(tokenId);
        (uint256 accountChain, address accountCollection, uint256 accountToken) =
            ISwarmAgentAccount(accountAddress).token();
        if (
            accountChain != chainId || accountCollection != collection || accountToken != tokenId
                || ISwarmAgentAccount(accountAddress).owner() != owner
        ) revert InvalidAccount(tokenId);
    }
}
