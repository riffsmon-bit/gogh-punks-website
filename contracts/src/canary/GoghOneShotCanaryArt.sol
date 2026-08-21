// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";

interface ICanonicalGoghPunkAccount {
    function isCanonicalGoghPunkAccount() external view returns (bool);

    function token() external view returns (uint256 chainId, address tokenContract, uint256 tokenId);

    function owner() external view returns (address);
}

interface IGoghPunkCanaryAccountRegistry {
    function ROBINHOOD_CHAIN_ID() external view returns (uint256);

    function GOGH_PUNKS() external view returns (address);

    function CANONICAL_ERC6551_REGISTRY() external view returns (address);

    function account(uint256 tokenId) external view returns (address);
}

/// @title GoghOneShotCanaryArt
/// @notice Test-only ERC-721 target for one controlled, zero-cost Punk Account mint.
/// @dev The constructor permanently binds this collection to one already-deployed Punk Account,
///      its GoghPunkAccountRegistry and controlling Punk token ID, and one art token ID. It checks
///      the registry's exact chain/collection/ERC-6551 singleton configuration, requires the
///      registry-derived account to match, and checks the account footer and live owner. There is
///      no owner, admin, permission setter, second mint path, or withdrawal path. The bound Punk
///      Account must call `mint` itself and is the only permitted recipient.
///
///      `isCanonicalGoghPunkAccount()` is checked at construction. Before any non-local use, the
///      account and collection runtime hashes, deterministic account derivation, controlling Punk,
///      and deployment chain still need independent preflight verification. This contract is a
///      narrow canary fixture, not a general-purpose production mint collection.
contract GoghOneShotCanaryArt is ERC721 {
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    address public constant GOGH_PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address public constant CANONICAL_ERC6551_REGISTRY = 0x000000006551c19487814612e58FE06813775758;

    string public constant CANARY_DESCRIPTION =
        "A controlled one-shot test artwork collected by a Gogh Punk Account.";

    IGoghPunkCanaryAccountRegistry public immutable punkAccountRegistry;
    address public immutable punkAccount;
    uint256 public immutable controllingPunkTokenId;
    uint256 public immutable canaryTokenId;

    bool public minted;

    error WrongDeploymentChain(uint256 supplied);
    error ZeroAccountRegistry();
    error AccountRegistryHasNoCode(address supplied);
    error InvalidAccountRegistryConfiguration(address supplied);
    error ZeroPunkAccount();
    error PunkAccountHasNoCode(address supplied);
    error AccountDoesNotMatchRegistry(address supplied, address expected);
    error NonCanonicalPunkAccount(address supplied);
    error WrongPunkAccountToken(
        uint256 chainId, address collection, uint256 tokenId, uint256 expectedTokenId
    );
    error PunkAccountHasNoOwner(address supplied);
    error NonZeroPayment(uint256 supplied);
    error UnauthorizedCaller(address supplied, address expected);
    error WrongRecipient(address supplied, address expected);
    error WrongTokenId(uint256 supplied, uint256 expected);
    error AlreadyMinted();

    constructor(
        IGoghPunkCanaryAccountRegistry punkAccountRegistry_,
        address punkAccount_,
        uint256 controllingPunkTokenId_,
        uint256 canaryTokenId_
    ) ERC721("Gogh One-Shot Canary Art", "GOCART") {
        if (block.chainid != ROBINHOOD_CHAIN_ID) {
            revert WrongDeploymentChain(block.chainid);
        }
        if (address(punkAccountRegistry_) == address(0)) revert ZeroAccountRegistry();
        if (address(punkAccountRegistry_).code.length == 0) {
            revert AccountRegistryHasNoCode(address(punkAccountRegistry_));
        }
        if (punkAccount_ == address(0)) revert ZeroPunkAccount();
        if (punkAccount_.code.length == 0) revert PunkAccountHasNoCode(punkAccount_);

        if (!_hasExpectedRegistryConfiguration(punkAccountRegistry_)) {
            revert InvalidAccountRegistryConfiguration(address(punkAccountRegistry_));
        }

        address expectedAccount;
        try punkAccountRegistry_.account(controllingPunkTokenId_) returns (address derivedAccount) {
            expectedAccount = derivedAccount;
        } catch {
            revert InvalidAccountRegistryConfiguration(address(punkAccountRegistry_));
        }
        if (punkAccount_ != expectedAccount) {
            revert AccountDoesNotMatchRegistry(punkAccount_, expectedAccount);
        }

        bool canonical;
        try ICanonicalGoghPunkAccount(punkAccount_).isCanonicalGoghPunkAccount() returns (
            bool isCanonical
        ) {
            canonical = isCanonical;
        } catch {
            revert NonCanonicalPunkAccount(punkAccount_);
        }
        if (!canonical) revert NonCanonicalPunkAccount(punkAccount_);

        try ICanonicalGoghPunkAccount(punkAccount_).token() returns (
            uint256 chainId, address collection, uint256 tokenId
        ) {
            if (
                chainId != ROBINHOOD_CHAIN_ID || collection != GOGH_PUNKS
                    || tokenId != controllingPunkTokenId_
            ) {
                revert WrongPunkAccountToken(chainId, collection, tokenId, controllingPunkTokenId_);
            }
        } catch (bytes memory reason) {
            if (reason.length != 0) {
                assembly ("memory-safe") {
                    revert(add(reason, 0x20), mload(reason))
                }
            }
            revert NonCanonicalPunkAccount(punkAccount_);
        }

        try ICanonicalGoghPunkAccount(punkAccount_).owner() returns (address currentOwner) {
            if (currentOwner == address(0)) revert PunkAccountHasNoOwner(punkAccount_);
        } catch {
            revert NonCanonicalPunkAccount(punkAccount_);
        }

        punkAccountRegistry = punkAccountRegistry_;
        punkAccount = punkAccount_;
        controllingPunkTokenId = controllingPunkTokenId_;
        canaryTokenId = canaryTokenId_;
    }

    /// @notice Mints the single configured test-art NFT to its configured Punk Account.
    /// @dev The exact ABI shape intentionally matches the strict zero-cost mint adapter base.
    function mint(address recipient, uint256 tokenId) external payable {
        if (msg.value != 0) revert NonZeroPayment(msg.value);
        if (msg.sender != punkAccount) revert UnauthorizedCaller(msg.sender, punkAccount);
        if (recipient != punkAccount) revert WrongRecipient(recipient, punkAccount);
        if (tokenId != canaryTokenId) revert WrongTokenId(tokenId, canaryTokenId);
        if (minted) revert AlreadyMinted();

        minted = true;
        _safeMint(recipient, tokenId);
    }

    /// @notice Fully deterministic, self-contained metadata for indexer and gallery canary tests.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        string memory tokenNumber = Strings.toString(tokenId);
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">',
            '<rect width="800" height="800" fill="#101018"/>',
            '<rect x="52" y="52" width="696" height="696" rx="28" fill="#f6c453"/>',
            '<rect x="82" y="82" width="636" height="636" rx="20" fill="#17223b"/>',
            '<text x="400" y="340" fill="#f6c453" font-family="monospace" font-size="84" text-anchor="middle">GOGH</text>',
            '<text x="400" y="440" fill="#ffffff" font-family="monospace" font-size="62" text-anchor="middle">CANARY #',
            tokenNumber,
            "</text></svg>"
        );
        string memory image = string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(svg)));
        bytes memory json = abi.encodePacked(
            '{"name":"Gogh Punks One-Shot Canary #',
            tokenNumber,
            '","description":"',
            CANARY_DESCRIPTION,
            '","image":"',
            image,
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    function _hasExpectedRegistryConfiguration(IGoghPunkCanaryAccountRegistry registry)
        private
        view
        returns (bool)
    {
        try registry.ROBINHOOD_CHAIN_ID() returns (uint256 chainId) {
            if (chainId != ROBINHOOD_CHAIN_ID) return false;
        } catch {
            return false;
        }
        try registry.GOGH_PUNKS() returns (address collection) {
            if (collection != GOGH_PUNKS) return false;
        } catch {
            return false;
        }
        try registry.CANONICAL_ERC6551_REGISTRY() returns (address singleton) {
            if (singleton != CANONICAL_ERC6551_REGISTRY) return false;
        } catch {
            return false;
        }
        return true;
    }
}
