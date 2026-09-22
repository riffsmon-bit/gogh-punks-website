// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { GoghSkillRegistry } from "./GoghSkillRegistry.sol";
import { GoghReviewedSkillProgression } from "./GoghReviewedSkillProgression.sol";

/// @notice Optional paid credits alongside the unchanged burn-credit ledger.
/// @dev New deployment only. Credits and canonical loadout follow the original token ID.
/// Current ownership and short reviews are NOT an ownership epoch: off-chain canonical
/// Transfer-history checks remain required before submission, including away-and-back.
contract GoghPaidSkillTraining is Ownable2Step {
    uint256 public constant creditPriceWei = 500_000_000_000_000;
    uint256 public constant READ_ONLY_CAPABILITIES = 205;
    uint8 public constant slotCap = 7;
    uint64 public constant MAX_REVIEW_LIFETIME = 60;
    bytes32 public constant REVIEW_DOMAIN = keccak256("GOGH_PAID_TRAINING_REVIEW_V1");

    struct Configuration {
        uint256 chainId;
        address collection;
        address registry;
        address legacyProgression;
        address payable treasury;
        address guardian;
        bytes32 collectionCodeHash;
        bytes32 registryCodeHash;
        bytes32 legacyProgressionCodeHash;
    }

    enum Operation {
        BUY,
        ACTIVATE,
        LEARN,
        UNLOCK,
        EQUIP,
        UNEQUIP
    }

    struct Review {
        uint256 tokenId;
        Operation operation;
        bytes32 skillKey;
        uint8 slot;
        uint256 nonce;
        bytes32 stateHash;
        uint64 deadline;
    }

    IERC721 public immutable collection;
    GoghSkillRegistry public immutable registry;
    GoghReviewedSkillProgression public immutable legacyProgression;
    address payable public immutable treasury;
    uint256 public immutable deploymentChainId;
    bytes32 public immutable collectionCodeHash;
    bytes32 public immutable registryCodeHash;
    bytes32 public immutable legacyProgressionCodeHash;

    bool public purchasesPaused = true;
    uint256 public policyNonce;
    mapping(bytes32 key => bool allowed) public allowedSkill;
    bytes32[] private _allowedKeys;
    mapping(uint256 tokenId => bool active) public activated;
    mapping(uint256 tokenId => uint256 credits) public purchasedCredits;
    mapping(uint256 tokenId => uint256 nonce) public reviewNonce;
    mapping(uint256 tokenId => mapping(bytes32 key => uint8 level)) private _paidLearned;
    mapping(uint256 tokenId => uint8 slots) private _paidExtraSlots;
    mapping(uint256 tokenId => mapping(uint8 slot => bytes32 key)) private _equipped;
    bool private _entered;

    error InvalidConfiguration();
    error RuntimeChanged();
    error NotCurrentOwner();
    error ReviewReentrancy();
    error ReviewExpired();
    error ReviewDeadlineTooFar();
    error ReviewNonceChanged();
    error ReviewStateChanged();
    error InvalidReviewArguments();
    error IncorrectPayment();
    error PurchasesPaused();
    error TreasuryTransferFailed();
    error ActivationRequired();
    error AlreadyActivated();
    error UnsupportedLegacyLoadout();
    error NoPurchasedCredit();
    error NoCreditUseAvailable();
    error SkillUnavailable();
    error AlreadyLearned();
    error NotLearned();
    error SlotUnavailable();
    error DuplicateEquipment();
    error RarityClaimRequired();
    error TrainingPaused();
    error BurnApprovalActive();

    event PaidTrainingReviewApplied(
        uint256 indexed tokenId, uint256 indexed nonce, Operation operation
    );
    event TrainingCreditPurchased(uint256 indexed tokenId, address indexed buyer, uint256 value);
    event PaidLoadoutActivated(uint256 indexed tokenId);
    event PaidSkillLearned(uint256 indexed tokenId, bytes32 indexed key);
    event PaidSlotUnlocked(uint256 indexed tokenId, uint8 totalSlots);
    event PaidSkillEquipped(uint256 indexed tokenId, uint8 indexed slot, bytes32 indexed key);
    event PaidSkillUnequipped(uint256 indexed tokenId, uint8 indexed slot, bytes32 indexed key);
    event PurchasesPauseChanged(bool paused, uint256 policyNonce);

    modifier guarded() {
        if (_entered) revert ReviewReentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(Configuration memory config, bytes32[] memory allowedKeys)
        Ownable(config.guardian)
    {
        if (
            block.chainid != config.chainId || (config.chainId != 4663 && config.chainId != 31_337)
                || config.collection.code.length == 0 || config.registry.code.length == 0
                || config.legacyProgression.code.length == 0 || config.treasury == address(0)
                || config.treasury == address(this) || allowedKeys.length == 0
                || allowedKeys.length > 32
                || config.collection.codehash != config.collectionCodeHash
                || config.registry.codehash != config.registryCodeHash
                || config.legacyProgression.codehash != config.legacyProgressionCodeHash
        ) revert InvalidConfiguration();
        collection = IERC721(config.collection);
        registry = GoghSkillRegistry(config.registry);
        legacyProgression = GoghReviewedSkillProgression(config.legacyProgression);
        treasury = config.treasury;
        deploymentChainId = config.chainId;
        collectionCodeHash = config.collectionCodeHash;
        registryCodeHash = config.registryCodeHash;
        legacyProgressionCodeHash = config.legacyProgressionCodeHash;
        if (
            address(legacyProgression.collection()) != config.collection
                || address(legacyProgression.registry()) != config.registry
                || legacyProgression.baseSlots() != 1 || legacyProgression.slotCap() != slotCap
                || legacyProgression.allocationChainId() != config.chainId
                || legacyProgression.MAX_REVIEW_LIFETIME() != MAX_REVIEW_LIFETIME
        ) revert InvalidConfiguration();
        for (uint256 i; i < allowedKeys.length; ++i) {
            bytes32 key = allowedKeys[i];
            if (key == bytes32(0) || allowedSkill[key] || !_readOnly(registry.definition(key))) {
                revert InvalidConfiguration();
            }
            allowedSkill[key] = true;
            _allowedKeys.push(key);
        }
    }

    /// @notice Only future purchases are paused. Unequipping and adopted state remain available.
    /// Changing this setting invalidates outstanding reviews, including a pause/unpause round trip.
    function setPurchasesPaused(bool paused) external onlyOwner guarded {
        purchasesPaused = paused;
        emit PurchasesPauseChanged(paused, ++policyNonce);
    }

    function reviewStateHash(uint256 tokenId) public view returns (bytes32) {
        _requireRuntime();
        return keccak256(
            abi.encode(
                REVIEW_DOMAIN,
                block.chainid,
                address(this),
                address(collection),
                address(registry),
                address(legacyProgression),
                treasury,
                creditPriceWei,
                tokenId,
                collection.ownerOf(tokenId),
                legacyProgression.trainingReviewStateHash(tokenId),
                reviewNonce[tokenId],
                activated[tokenId],
                purchasedCredits[tokenId],
                _paidExtraSlots[tokenId],
                policyNonce,
                purchasesPaused,
                registry.globallyDisabled(),
                registry.disabledCapabilities()
            )
        );
    }

    /// @notice The only holder mutation entry point. No arbitrary calls, approvals or sender exist.
    function applyReview(Review calldata review) external payable guarded {
        _requireRuntime();
        if (collection.ownerOf(review.tokenId) != msg.sender) revert NotCurrentOwner();
        if (block.timestamp > review.deadline) revert ReviewExpired();
        if (uint256(review.deadline) > block.timestamp + MAX_REVIEW_LIFETIME) {
            revert ReviewDeadlineTooFar();
        }
        if (review.nonce != reviewNonce[review.tokenId]) revert ReviewNonceChanged();
        if (review.stateHash != reviewStateHash(review.tokenId)) revert ReviewStateChanged();
        _validateArguments(review);
        if (msg.value != (review.operation == Operation.BUY ? creditPriceWei : 0)) {
            revert IncorrectPayment();
        }
        ++reviewNonce[review.tokenId];
        if (review.operation == Operation.BUY) {
            if (purchasesPaused || registry.globallyDisabled()) revert PurchasesPaused();
            _requireNoBurnApproval(review.tokenId, msg.sender);
            if (purchasedCredits[review.tokenId] >= remainingCreditUses(review.tokenId)) {
                revert NoCreditUseAvailable();
            }
            ++purchasedCredits[review.tokenId];
            bytes32 beforeTreasuryState = reviewStateHash(review.tokenId);
            (bool sent,) = treasury.call{ value: msg.value }("");
            if (!sent) revert TreasuryTransferFailed();
            // A treasury callback cannot alter ownership, runtime, policy or reviewed state.
            if (collection.ownerOf(review.tokenId) != msg.sender) revert NotCurrentOwner();
            if (reviewStateHash(review.tokenId) != beforeTreasuryState) {
                revert ReviewStateChanged();
            }
            _requireNoBurnApproval(review.tokenId, msg.sender);
            // Per-skill availability is mutable and is not part of the legacy state hash.
            if (purchasedCredits[review.tokenId] > remainingCreditUses(review.tokenId)) {
                revert NoCreditUseAvailable();
            }
            emit TrainingCreditPurchased(review.tokenId, msg.sender, msg.value);
        } else if (review.operation == Operation.ACTIVATE) {
            _activate(review.tokenId);
        } else {
            if (!activated[review.tokenId]) revert ActivationRequired();
            if (review.operation == Operation.LEARN) {
                _requireSkill(review.skillKey);
                if (learnedLevel(review.tokenId, review.skillKey) != 0) revert AlreadyLearned();
                _spend(review.tokenId);
                _paidLearned[review.tokenId][review.skillKey] = 1;
                emit PaidSkillLearned(review.tokenId, review.skillKey);
            } else if (review.operation == Operation.UNLOCK) {
                if (registry.globallyDisabled()) revert TrainingPaused();
                if (legacyProgression.claimedStartingSlots(review.tokenId) == 0) {
                    revert RarityClaimRequired();
                }
                if (unlockedSlots(review.tokenId) >= slotCap) revert SlotUnavailable();
                _spend(review.tokenId);
                ++_paidExtraSlots[review.tokenId];
                emit PaidSlotUnlocked(review.tokenId, unlockedSlots(review.tokenId));
            } else {
                if (review.slot >= unlockedSlots(review.tokenId)) revert SlotUnavailable();
                bytes32 prior = _equipped[review.tokenId][review.slot];
                if (review.operation == Operation.EQUIP) {
                    _requireSkill(review.skillKey);
                    if (learnedLevel(review.tokenId, review.skillKey) == 0) revert NotLearned();
                    for (uint8 i; i < unlockedSlots(review.tokenId); ++i) {
                        if (_equipped[review.tokenId][i] == review.skillKey) {
                            revert DuplicateEquipment();
                        }
                    }
                    if (prior != bytes32(0)) {
                        emit PaidSkillUnequipped(review.tokenId, review.slot, prior);
                    }
                    _equipped[review.tokenId][review.slot] = review.skillKey;
                    emit PaidSkillEquipped(review.tokenId, review.slot, review.skillKey);
                } else {
                    delete _equipped[review.tokenId][review.slot];
                    if (prior != bytes32(0)) {
                        emit PaidSkillUnequipped(review.tokenId, review.slot, prior);
                    }
                }
            }
        }
        emit PaidTrainingReviewApplied(review.tokenId, review.nonce, review.operation);
    }

    function learnedLevel(uint256 tokenId, bytes32 key) public view returns (uint8) {
        _requireRuntime();
        uint8 legacy = legacyProgression.learnedLevel(tokenId, key);
        return legacy > _paidLearned[tokenId][key] ? legacy : _paidLearned[tokenId][key];
    }

    /// @notice Bounded current uses, not a guarantee that governance will keep every skill READY.
    function remainingCreditUses(uint256 tokenId) public view returns (uint256 uses) {
        _requireRuntime();
        if (registry.globallyDisabled()) return 0;
        for (uint256 i; i < _allowedKeys.length; ++i) {
            bytes32 key = _allowedKeys[i];
            if (
                registry.available(key) && learnedLevel(tokenId, key) == 0
                    && _readOnly(registry.definition(key))
            ) ++uses;
        }
        if (legacyProgression.claimedStartingSlots(tokenId) != 0) {
            uses += slotCap - unlockedSlots(tokenId);
        }
    }

    function unlockedSlots(uint256 tokenId) public view returns (uint8) {
        _requireRuntime();
        uint256 legacy = legacyProgression.unlockedSlots(tokenId);
        if (legacy == 0 || legacy > slotCap) revert RuntimeChanged();
        uint256 total = legacy + _paidExtraSlots[tokenId];
        return uint8(total > slotCap ? slotCap : total);
    }

    function equipped(uint256 tokenId, uint8 slot) public view returns (bytes32) {
        _requireRuntime();
        return
            activated[tokenId]
                ? _equipped[tokenId][slot]
                : legacyProgression.equipped(tokenId, slot);
    }

    function effectiveCapabilities(uint256 tokenId) external view returns (uint256 mask) {
        _requireRuntime();
        if (!activated[tokenId]) return legacyProgression.effectiveCapabilities(tokenId);
        try collection.ownerOf(tokenId) returns (address holder) {
            if (holder == address(0)) return 0;
        } catch {
            return 0;
        }
        for (uint8 i; i < unlockedSlots(tokenId); ++i) {
            bytes32 key = _equipped[tokenId][i];
            if (!allowedSkill[key] || learnedLevel(tokenId, key) == 0 || !registry.available(key)) {
                continue;
            }
            GoghSkillRegistry.Definition memory item = registry.definition(key);
            if (_readOnly(item)) mask |= item.capabilities;
        }
    }

    function _activate(uint256 tokenId) private {
        if (activated[tokenId]) revert AlreadyActivated();
        uint8 slots = unlockedSlots(tokenId);
        for (uint8 i; i < slots; ++i) {
            bytes32 key = legacyProgression.equipped(tokenId, i);
            if (key != bytes32(0)) {
                if (
                    !allowedSkill[key] || !_readOnly(registry.definition(key))
                        || legacyProgression.learnedLevel(tokenId, key) == 0
                ) {
                    revert UnsupportedLegacyLoadout();
                }
                for (uint8 j; j < i; ++j) {
                    if (_equipped[tokenId][j] == key) revert UnsupportedLegacyLoadout();
                }
                _equipped[tokenId][i] = key;
            }
        }
        activated[tokenId] = true;
        emit PaidLoadoutActivated(tokenId);
    }

    function _spend(uint256 tokenId) private {
        if (purchasedCredits[tokenId] == 0) revert NoPurchasedCredit();
        --purchasedCredits[tokenId];
    }

    function _requireNoBurnApproval(uint256 tokenId, address holder) private view {
        address burnSource = legacyProgression.trainingSource();
        if (
            collection.getApproved(tokenId) == burnSource
                || collection.isApprovedForAll(holder, burnSource)
        ) revert BurnApprovalActive();
    }

    function _requireSkill(bytes32 key) private view {
        if (!allowedSkill[key] || !registry.available(key) || !_readOnly(registry.definition(key)))
        {
            revert SkillUnavailable();
        }
    }

    function _readOnly(GoghSkillRegistry.Definition memory item) private pure returns (bool) {
        return item.capabilities != 0 && (item.capabilities & ~READ_ONLY_CAPABILITIES) == 0
            && item.prerequisite == bytes32(0) && item.riskTier == 0;
    }

    function _validateArguments(Review calldata review) private pure {
        bool keyRequired =
            review.operation == Operation.LEARN || review.operation == Operation.EQUIP;
        bool slotRequired =
            review.operation == Operation.EQUIP || review.operation == Operation.UNEQUIP;
        if (
            (keyRequired ? review.skillKey == bytes32(0) : review.skillKey != bytes32(0))
                || (slotRequired ? review.slot >= slotCap : review.slot != 0)
        ) {
            revert InvalidReviewArguments();
        }
    }

    function _requireRuntime() private view {
        if (
            block.chainid != deploymentChainId || address(collection).codehash != collectionCodeHash
                || address(registry).codehash != registryCodeHash
                || address(legacyProgression).codehash != legacyProgressionCodeHash
        ) {
            revert RuntimeChanged();
        }
    }
}
