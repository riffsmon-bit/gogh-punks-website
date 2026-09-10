// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {
    ERC721Enumerable
} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {
    IERC721Metadata
} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { GoghOwnershipEpochRegistry } from "./GoghOwnershipEpochRegistry.sol";

/// @notice Opt-in escrow of one original Punk per transferable receipt with the same ID.
/// @dev New deployment; NOT an upgrade to original Punks or existing token-bound accounts.
/// Owner-authorized wrap/unwrap only. No admin withdrawal or arbitrary external calls.
contract GoghPunkSessionWrapper is ERC721Enumerable, IERC721Receiver, ReentrancyGuard {
    uint256 public constant CHAIN_ID = 4663;
    address public constant COLLECTION = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    IERC721 public constant underlying = IERC721(COLLECTION);
    GoghOwnershipEpochRegistry public immutable epochs;
    uint256 private _depositId;
    address private _depositor;

    error InvalidConfiguration();
    error NotPunkOwner();
    error InvalidDeposit();
    error InvalidRecipient();
    event PunkWrapped(uint256 indexed tokenId, address indexed owner);
    event PunkUnwrapped(uint256 indexed tokenId, address indexed owner);

    constructor(address guardian) ERC721("Gogh Punk Session Receipt", "GOGH-S") {
        if (block.chainid != CHAIN_ID || COLLECTION.code.length == 0) {
            revert InvalidConfiguration();
        }
        epochs = new GoghOwnershipEpochRegistry(address(this), guardian);
    }

    function wrap(uint256 tokenId) external nonReentrant {
        if (block.chainid != CHAIN_ID || underlying.ownerOf(tokenId) != msg.sender) {
            revert NotPunkOwner();
        }
        if (_ownerOf(tokenId) != address(0)) revert InvalidDeposit();
        _depositId = tokenId;
        _depositor = msg.sender;
        underlying.safeTransferFrom(msg.sender, address(this), tokenId);
        if (underlying.ownerOf(tokenId) != address(this) || _depositor != address(0)) {
            revert InvalidDeposit();
        }
        // Receipt delivery cannot execute a receiver callback during deposit.
        // The caller explicitly opts in and receives its own receipt.
        _mint(msg.sender, tokenId);
        emit PunkWrapped(tokenId, msg.sender);
    }

    function unwrap(uint256 tokenId) external nonReentrant {
        // A marketplace approval may transfer the receipt, but may not redeem the original.
        if (ownerOf(tokenId) != msg.sender || !isWrapped(tokenId)) revert NotPunkOwner();
        _burn(tokenId); // Epoch advances before calling the original collection/receiver.
        underlying.safeTransferFrom(address(this), msg.sender, tokenId);
        if (underlying.ownerOf(tokenId) != msg.sender) revert InvalidDeposit();
        emit PunkUnwrapped(tokenId, msg.sender);
    }

    function onERC721Received(address operator, address from, uint256 id, bytes calldata)
        external
        returns (bytes4)
    {
        if (
            msg.sender != COLLECTION || operator != address(this) || from != _depositor
                || from == address(0) || id != _depositId
        ) revert InvalidDeposit();
        delete _depositor;
        delete _depositId;
        return IERC721Receiver.onERC721Received.selector;
    }

    function isWrapped(uint256 tokenId) public view returns (bool) {
        if (block.chainid != CHAIN_ID || _ownerOf(tokenId) == address(0)) return false;
        try underlying.ownerOf(tokenId) returns (address currentOwner) {
            return currentOwner == address(this);
        } catch {
            return false;
        }
    }

    /// @notice Beneficial owner while wrapped; original owner for recovery after unwrap.
    function resolveOwner(uint256 tokenId) external view returns (address) {
        if (block.chainid != CHAIN_ID) return address(0);
        try underlying.ownerOf(tokenId) returns (address currentOwner) {
            return currentOwner == address(this) ? _ownerOf(tokenId) : currentOwner;
        } catch {
            return address(0);
        }
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return IERC721Metadata(COLLECTION).tokenURI(tokenId);
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address from)
    {
        if (block.chainid != CHAIN_ID || to == address(this) || to == address(epochs)) {
            revert InvalidRecipient();
        }
        if (to.code.length != 0) {
            // Reject known token-bound nesting, including raw transferFrom to an account.
            // This is not a claim that arbitrary hostile contracts can be safely recovered.
            (bool ok, bytes memory data) = to.staticcall(abi.encodeWithSignature("token()"));
            if (ok && data.length == 96) {
                (, address collection,) = abi.decode(data, (uint256, address, uint256));
                if (collection == COLLECTION || collection == address(this)) {
                    revert InvalidRecipient();
                }
            }
        }
        from = super._update(to, tokenId, auth);
        epochs.advance(tokenId, from, to); // All mint, burn, direct, safe and approved transfers.
    }
}
