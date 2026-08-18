// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC6551Registry } from "./interfaces/IERC6551Registry.sol";

interface IERC721Owner {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title GoghPunkAccountRegistry
/// @notice Immutable Gogh-specific facade over the canonical ERC-6551 singleton registry.
/// @dev This facade has no administrator and owns no Punk Account or assets.
contract GoghPunkAccountRegistry {
    uint256 public constant IMPLEMENTATION_VERSION = 1;
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    address public constant GOGH_PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address public constant CANONICAL_ERC6551_REGISTRY = 0x000000006551c19487814612e58FE06813775758;

    IERC6551Registry public constant canonicalRegistry =
        IERC6551Registry(CANONICAL_ERC6551_REGISTRY);
    address public immutable implementation;
    bytes32 public immutable accountSalt;

    error ZeroAddress();
    error InvalidContract(address target);
    error WrongDeploymentChain(uint256 expected, uint256 actual);
    error InvalidConfiguration();
    error TokenDoesNotExist(uint256 tokenId);
    error NotTokenOwner(address caller, address currentOwner);
    error AccountCreationMismatch(address expected, address returnedAddress);
    error AccountCodeMissing(address accountAddress);

    event GoghPunkAccountActivated(
        address indexed account,
        uint256 indexed chainId,
        address indexed collection,
        uint256 tokenId,
        address owner,
        address implementation,
        uint256 implementationVersion
    );

    constructor(address implementation_, bytes32 accountSalt_) {
        if (implementation_ == address(0)) revert ZeroAddress();
        if (block.chainid != ROBINHOOD_CHAIN_ID) {
            revert WrongDeploymentChain(ROBINHOOD_CHAIN_ID, block.chainid);
        }
        if (CANONICAL_ERC6551_REGISTRY.code.length == 0) {
            revert InvalidContract(CANONICAL_ERC6551_REGISTRY);
        }
        if (GOGH_PUNKS.code.length == 0) revert InvalidContract(GOGH_PUNKS);
        if (implementation_.code.length == 0) revert InvalidContract(implementation_);
        implementation = implementation_;
        accountSalt = accountSalt_;
    }

    function account(uint256 tokenId) public view returns (address accountAddress) {
        accountAddress = canonicalRegistry.account(
            implementation, accountSalt, ROBINHOOD_CHAIN_ID, GOGH_PUNKS, tokenId
        );
    }

    function account(
        address implementation_,
        bytes32 salt_,
        uint256 chainId_,
        address collection_,
        uint256 tokenId
    ) external view returns (address accountAddress) {
        _validateConfiguration(implementation_, salt_, chainId_, collection_);
        return account(tokenId);
    }

    function implementationForVersion(uint256 version) external view returns (address) {
        if (version != IMPLEMENTATION_VERSION) revert InvalidConfiguration();
        return implementation;
    }

    function isAccountCreated(uint256 tokenId) external view returns (bool) {
        return account(tokenId).code.length != 0;
    }

    function createAccount(uint256 tokenId) public returns (address accountAddress) {
        address currentOwner = _ownerOf(tokenId);
        if (msg.sender != currentOwner) revert NotTokenOwner(msg.sender, currentOwner);

        address expected = account(tokenId);
        if (expected.code.length != 0) return expected;

        accountAddress = canonicalRegistry.createAccount(
            implementation, accountSalt, ROBINHOOD_CHAIN_ID, GOGH_PUNKS, tokenId
        );
        if (accountAddress != expected) {
            revert AccountCreationMismatch(expected, accountAddress);
        }
        if (accountAddress.code.length == 0) revert AccountCodeMissing(accountAddress);
        emit GoghPunkAccountActivated(
            accountAddress,
            ROBINHOOD_CHAIN_ID,
            GOGH_PUNKS,
            tokenId,
            currentOwner,
            implementation,
            IMPLEMENTATION_VERSION
        );
    }

    function createAccount(
        address implementation_,
        bytes32 salt_,
        uint256 chainId_,
        address collection_,
        uint256 tokenId
    ) external returns (address accountAddress) {
        _validateConfiguration(implementation_, salt_, chainId_, collection_);
        return createAccount(tokenId);
    }

    function _ownerOf(uint256 tokenId) private view returns (address currentOwner) {
        try IERC721Owner(GOGH_PUNKS).ownerOf(tokenId) returns (address tokenOwner) {
            if (tokenOwner == address(0)) revert TokenDoesNotExist(tokenId);
            return tokenOwner;
        } catch {
            revert TokenDoesNotExist(tokenId);
        }
    }

    function _validateConfiguration(
        address implementation_,
        bytes32 salt_,
        uint256 chainId_,
        address collection_
    ) private view {
        if (
            implementation_ != implementation || salt_ != accountSalt
                || chainId_ != ROBINHOOD_CHAIN_ID || collection_ != GOGH_PUNKS
        ) revert InvalidConfiguration();
    }
}
