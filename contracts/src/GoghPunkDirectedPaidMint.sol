// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { GoghBrokerTypes } from "./GoghBrokerTypes.sol";
import {
    AutomatedSeaDropStudioPaidMintAdapter
} from "./adapters/AutomatedSeaDropStudioPaidMintAdapter.sol";
import { IOpenSeaSeaDropCollection } from "./adapters/OpenSeaSeaDropFreeMintAdapter.sol";

interface IPaidMintAgentRegistry {
    function account(uint256 tokenId) external view returns (address);
}

/// @notice A stable per-Punk escrow for one exact-price, quantity-one directed mint.
/// @dev An owner funds and authorizes a mission once. The reviewed worker executes it later.
///      This is separate from the existing free-only ERC-4337 account and its session.
///      The original collection has no ownership epoch: the worker must also check transfer
///      history. Current ownership alone cannot detect a transfer away and back.
contract GoghPunkDirectedPaidMint is IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    uint256 public constant MAX_DURATION = 10 minutes;
    uint256 public immutable punkTokenId;
    address public immutable factory;
    address public immutable recipient;
    AutomatedSeaDropStudioPaidMintAdapter public immutable adapter;
    bytes32 public immutable adapterCodeHash;

    enum Status {
        EMPTY,
        ACTIVE,
        COMPLETED,
        CANCELLED
    }

    struct Mission {
        address authorizingOwner;
        address executor;
        address collection;
        bytes32 collectionCodeHash;
        uint256 priceWei;
        uint256 executionFeeWei;
        uint64 generation;
        uint48 deadline;
        Status status;
    }
    Mission public mission;
    // Escrow always belongs to the funder; it does not pass to a buyer of the Punk.
    mapping(address funder => uint256 amount) public refundable;
    uint256 public refundLiability;

    error Unauthorized();
    error InvalidMission();
    error MissionUnavailable();
    error ExecutionMismatch();
    error PaymentFailed();

    event MissionAuthorized(
        uint64 indexed generation,
        address indexed owner,
        address indexed collection,
        address executor,
        address recipient,
        uint256 priceWei,
        uint256 executionFeeWei,
        uint48 deadline
    );
    event MissionCompleted(
        uint64 indexed generation,
        address indexed collection,
        uint256 indexed tokenId,
        address recipient,
        uint256 priceWei,
        uint256 executionFeeWei
    );
    event MissionCancelled(uint64 indexed generation, address indexed funder, uint256 refundWei);
    event RefundWithdrawn(address indexed funder, address indexed recipient, uint256 amount);

    constructor(
        uint256 tokenId,
        address recipient_,
        AutomatedSeaDropStudioPaidMintAdapter adapter_
    ) {
        if (
            block.chainid != 4663 || recipient_.code.length == 0
                || address(adapter_).code.length == 0
        ) {
            revert InvalidMission();
        }
        factory = msg.sender;
        punkTokenId = tokenId;
        recipient = recipient_;
        adapter = adapter_;
        adapterCodeHash = address(adapter_).codehash;
    }

    function authorize(
        address owner,
        address executor,
        address collection,
        bytes32 collectionHash,
        uint256 priceWei,
        uint256 executionFeeWei,
        uint64 expectedGeneration,
        uint48 deadline
    ) external payable nonReentrant {
        if (msg.sender != factory || IERC721(PUNKS).ownerOf(punkTokenId) != owner) {
            revert Unauthorized();
        }
        if (
            mission.status == Status.ACTIVE || mission.generation != expectedGeneration
                || executor == address(0) || executor == address(this) || collection == PUNKS
                || collection.code.length == 0 || collection.codehash != collectionHash
                || !adapter.isReviewedCollectionRuntime(collection) || priceWei == 0
                || msg.value != priceWei + executionFeeWei || deadline <= block.timestamp
                || deadline > block.timestamp + MAX_DURATION
        ) revert InvalidMission();
        mission = Mission(
            owner,
            executor,
            collection,
            collectionHash,
            priceWei,
            executionFeeWei,
            expectedGeneration + 1,
            deadline,
            Status.ACTIVE
        );
        // Simulates the adapter at authorization too; a stale price cannot create a mission.
        _execution();
        emit MissionAuthorized(
            mission.generation,
            owner,
            collection,
            executor,
            recipient,
            priceWei,
            executionFeeWei,
            deadline
        );
    }

    function _execution()
        private
        view
        returns (uint256 tokenId, GoghBrokerTypes.AdapterExecution memory execution)
    {
        Mission memory m = mission;
        if (
            address(adapter).codehash != adapterCodeHash
                || m.collection.codehash != m.collectionCodeHash
        ) {
            revert ExecutionMismatch();
        }
        (, uint256 minted,) = IOpenSeaSeaDropCollection(m.collection).getMintStats(address(this));
        tokenId = minted + 1;
        GoghBrokerTypes.AcquisitionIntent memory intent;
        intent.account = address(this);
        intent.chainId = block.chainid;
        intent.expectedOwner = m.authorizingOwner;
        intent.nonce = m.generation;
        intent.opportunityType = GoghBrokerTypes.OpportunityType.MINT;
        intent.assetStandard = GoghBrokerTypes.AssetStandard.ERC721;
        intent.adapter = address(adapter);
        intent.venue = adapter.SEA_DROP();
        intent.collection = m.collection;
        intent.tokenId = tokenId;
        intent.assetAmount = 1;
        intent.expectedPrice = m.priceWei;
        intent.maxPrice = m.priceWei;
        intent.createdAt = uint64(block.timestamp);
        intent.expiresAt = m.deadline;
        intent.adapterCodeHash = adapterCodeHash;
        execution = adapter.buildExecution(intent, "");
        if (
            execution.target != adapter.SEA_DROP() || execution.value != m.priceWei
                || execution.paymentAmount != m.priceWei || execution.currency != address(0)
                || execution.allowanceSpender != address(0) || execution.allowanceAmount != 0
        ) revert ExecutionMismatch();
    }

    function execute(uint64 generation) external nonReentrant {
        Mission memory m = mission;
        if (msg.sender != m.executor) revert Unauthorized();
        if (
            m.status != Status.ACTIVE || generation != m.generation || block.timestamp > m.deadline
                || IERC721(PUNKS).ownerOf(punkTokenId) != m.authorizingOwner
        ) revert MissionUnavailable();
        (uint256 tokenId, GoghBrokerTypes.AdapterExecution memory e) = _execution();
        mission.status = Status.COMPLETED;
        uint256 beforeBalance = IERC721(m.collection).balanceOf(address(this));
        (bool ok,) = e.target.call{ value: e.value }(e.callData);
        if (
            !ok || IERC721(m.collection).ownerOf(tokenId) != address(this)
                || IERC721(m.collection).balanceOf(address(this)) != beforeBalance + 1
        ) revert ExecutionMismatch();
        IERC721(m.collection).safeTransferFrom(address(this), recipient, tokenId);
        if (
            IERC721(m.collection).ownerOf(tokenId) != recipient
                || IERC721(PUNKS).ownerOf(punkTokenId) != m.authorizingOwner
        ) revert ExecutionMismatch();
        if (m.executionFeeWei != 0) {
            (ok,) = payable(m.executor).call{ value: m.executionFeeWei }("");
            if (!ok) revert PaymentFailed();
        }
        // The fee recipient may itself be a contract. Include its callback in
        // the final ownership postcondition, just like the NFT receiver callback.
        if (
            IERC721(m.collection).ownerOf(tokenId) != recipient
                || IERC721(PUNKS).ownerOf(punkTokenId) != m.authorizingOwner
        ) revert ExecutionMismatch();
        emit MissionCompleted(
            generation, m.collection, tokenId, recipient, m.priceWei, m.executionFeeWei
        );
    }

    /// @notice Cancelling never pays a new owner with the prior owner's unused budget.
    function cancel(uint64 generation) external nonReentrant {
        Mission memory m = mission;
        if (m.status != Status.ACTIVE || m.generation != generation) revert MissionUnavailable();
        bool currentOwner;
        try IERC721(PUNKS).ownerOf(punkTokenId) returns (address owner) {
            currentOwner = owner == m.authorizingOwner;
        } catch { }
        if (msg.sender != m.authorizingOwner && currentOwner && block.timestamp <= m.deadline) {
            revert Unauthorized();
        }
        mission.status = Status.CANCELLED;
        uint256 amount = m.priceWei + m.executionFeeWei;
        refundable[m.authorizingOwner] += amount;
        refundLiability += amount;
        emit MissionCancelled(generation, m.authorizingOwner, amount);
    }

    function withdrawRefund(address payable to) external nonReentrant {
        uint256 amount = refundable[msg.sender];
        if (amount == 0 || to == address(0) || to == address(this)) revert InvalidMission();
        refundable[msg.sender] = 0;
        refundLiability -= amount;
        (bool ok,) = to.call{ value: amount }("");
        if (!ok) revert PaymentFailed();
        emit RefundWithdrawn(msg.sender, to, amount);
    }

    // Recovery for accidentally transferred assets; no worker recovery or arbitrary execution.
    function recoverNFT(address collection, uint256 tokenId, address to) external nonReentrant {
        _ownerRecovery(to);
        IERC721(collection).safeTransferFrom(address(this), to, tokenId);
    }

    function recoverToken(address token, uint256 amount, address to) external nonReentrant {
        _ownerRecovery(to);
        IERC20(token).safeTransfer(to, amount);
    }

    function recoverNative(address payable to) external nonReentrant {
        _ownerRecovery(to);
        uint256 reserved = refundLiability;
        if (mission.status == Status.ACTIVE) {
            reserved += mission.priceWei + mission.executionFeeWei;
        }
        (bool ok,) = to.call{ value: address(this).balance - reserved }("");
        if (!ok) revert PaymentFailed();
    }

    function _ownerRecovery(address to) private view {
        if (
            to == address(0) || to == address(this)
                || msg.sender != IERC721(PUNKS).ownerOf(punkTokenId)
        ) revert Unauthorized();
    }

    function onERC721Received(address, address from, uint256, bytes calldata)
        external
        view
        returns (bytes4)
    {
        if (
            !_reentrancyGuardEntered() || mission.status != Status.COMPLETED
                || msg.sender != mission.collection || from != address(0)
        ) revert Unauthorized();
        return IERC721Receiver.onERC721Received.selector;
    }
}

/// @notice Permissionless immutable factory. One wallet transaction creates, funds and
///         authorizes a mission; collection, price, execution fee and expiry are explicit.
contract GoghPunkDirectedPaidMintFactory {
    address public constant PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    IPaidMintAgentRegistry public immutable agentRegistry;
    bytes32 public immutable agentRegistryCodeHash;
    AutomatedSeaDropStudioPaidMintAdapter public immutable adapter;
    mapping(uint256 tokenId => GoghPunkDirectedPaidMint vault) public vaults;
    error InvalidConfiguration();
    event VaultCreated(
        uint256 indexed punkTokenId, address indexed vault, address indexed recipient
    );

    constructor(
        address agentRegistry_,
        bytes32 registryHash,
        bytes32 seaDropHash,
        bytes32 cloneImplementationHash,
        bytes32 studioHash
    ) {
        if (
            block.chainid != 4663 || agentRegistry_.code.length == 0
                || agentRegistry_.codehash != registryHash
        ) revert InvalidConfiguration();
        agentRegistry = IPaidMintAgentRegistry(agentRegistry_);
        agentRegistryCodeHash = registryHash;
        adapter = new AutomatedSeaDropStudioPaidMintAdapter(
            seaDropHash, cloneImplementationHash, studioHash
        );
    }

    function authorize(
        uint256 punkTokenId,
        address executor,
        address collection,
        bytes32 collectionHash,
        uint256 priceWei,
        uint256 executionFeeWei,
        uint64 expectedGeneration,
        uint48 deadline
    ) external payable returns (GoghPunkDirectedPaidMint vault) {
        if (
            IERC721(PUNKS).ownerOf(punkTokenId) != msg.sender
                || address(agentRegistry).codehash != agentRegistryCodeHash
        ) revert InvalidConfiguration();
        vault = vaults[punkTokenId];
        if (address(vault) == address(0)) {
            if (expectedGeneration != 0) revert InvalidConfiguration();
            address recipient = agentRegistry.account(punkTokenId);
            vault = new GoghPunkDirectedPaidMint{ salt: bytes32(punkTokenId) }(
                punkTokenId, recipient, adapter
            );
            vaults[punkTokenId] = vault;
            emit VaultCreated(punkTokenId, address(vault), recipient);
        }
        vault.authorize{ value: msg.value }(
            msg.sender,
            executor,
            collection,
            collectionHash,
            priceWei,
            executionFeeWei,
            expectedGeneration,
            deadline
        );
    }
}
