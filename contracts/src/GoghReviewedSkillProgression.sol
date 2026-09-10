// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghRaritySkillProgression } from "./GoghRaritySkillProgression.sol";

/// @notice Additive, NEW-DEPLOYMENT training boundary for original-NFT owners.
/// @dev No burn implementation, wallet module, delegate authority or funds transfer.
/// Reviews expire on chain and consume a per-token nonce. This is NOT an NFT
/// ownership epoch: an undetected away-and-back transfer does not change the nonce.
/// The original-NFT continuity guard remains required before wallet submission.
contract GoghReviewedSkillProgression is GoghRaritySkillProgression {
    bytes32 public constant REVIEW_DOMAIN = keccak256("GOGH_ORIGINAL_PUNK_TRAINING_REVIEW_V1");
    uint64 public constant MAX_REVIEW_LIFETIME = 60;

    enum Operation {
        LEARN,
        UNLOCK,
        EQUIP,
        UNEQUIP,
        CLAIM_RARITY
    }

    struct TrainingReview {
        uint256 tokenId;
        Operation operation;
        bytes32 skillKey;
        uint8 slot;
        uint8 startingSlots;
        bytes32[] rarityProof;
        uint256 nonce;
        bytes32 stateHash;
        uint64 deadline;
    }

    mapping(uint256 tokenId => uint256 nonce) public trainingReviewNonce;
    bool private _reviewActive;
    uint256 private _reviewToken;
    address private _reviewOwner;

    error TrainingReviewRequired();
    error ReviewReentrancy();
    error ReviewExpired();
    error ReviewDeadlineTooFar();
    error ReviewNonceChanged();
    error ReviewStateChanged();
    error InvalidReviewArguments();

    event TrainingReviewApplied(
        uint256 indexed tokenId, uint256 indexed nonce, Operation operation
    );
    event TrainingReviewsInvalidated(uint256 indexed tokenId, uint256 nonce);

    constructor(
        address collection_,
        address registry_,
        address trainingSource_,
        bytes32 root_,
        bytes32 snapshotHash_
    ) GoghRaritySkillProgression(collection_, registry_, trainingSource_, root_, snapshotHash_) { }

    function trainingReviewStateHash(uint256 tokenId) public view returns (bytes32) {
        // Every owner mutation MUST use applyTrainingReview and increment this nonce.
        // Credits can also arrive via the immutable training source; include the balance
        // so a credit arrival invalidates a previously displayed cost/balance review.
        return keccak256(
            abi.encode(
                REVIEW_DOMAIN,
                block.chainid,
                address(this),
                address(collection),
                tokenId,
                collection.ownerOf(tokenId),
                trainingReviewNonce[tokenId],
                trainingCredits[tokenId],
                unlockedSlots(tokenId),
                claimedStartingSlots[tokenId]
            )
        );
    }

    function applyTrainingReview(TrainingReview calldata review) external {
        if (_reviewActive) revert ReviewReentrancy();
        if (collection.ownerOf(review.tokenId) != msg.sender) revert NotCurrentOwner();
        if (block.timestamp > review.deadline) revert ReviewExpired();
        if (uint256(review.deadline) > block.timestamp + MAX_REVIEW_LIFETIME) {
            revert ReviewDeadlineTooFar();
        }
        if (review.nonce != trainingReviewNonce[review.tokenId]) revert ReviewNonceChanged();
        if (review.stateHash != trainingReviewStateHash(review.tokenId)) {
            revert ReviewStateChanged();
        }
        _validateArguments(review);

        _reviewActive = true;
        _reviewOwner = msg.sender;
        _reviewToken = review.tokenId;
        ++trainingReviewNonce[review.tokenId];

        // Fixed self-calls reuse the existing learning/prerequisite/rarity/credit logic.
        // The inherited owner entry points cannot be called outside this exact context.
        // No caller-supplied target, calldata, ETH value or delegatecall is accepted.
        if (review.operation == Operation.LEARN) {
            this.learnSkill(review.tokenId, review.skillKey);
        } else if (review.operation == Operation.UNLOCK) {
            this.unlockSlot(review.tokenId);
        } else if (review.operation == Operation.EQUIP) {
            this.equipSkill(review.tokenId, review.slot, review.skillKey);
        } else if (review.operation == Operation.UNEQUIP) {
            this.unequipSkill(review.tokenId, review.slot);
        } else {
            this.claimRaritySlots(review.tokenId, review.startingSlots, review.rarityProof);
        }
        delete _reviewOwner;
        delete _reviewToken;
        _reviewActive = false;
        emit TrainingReviewApplied(review.tokenId, review.nonce, review.operation);
    }

    /// @notice Current owner can invalidate outstanding training reviews, not skills or funds.
    function invalidateTrainingReviews(uint256 tokenId) external {
        if (_reviewActive) revert ReviewReentrancy();
        if (collection.ownerOf(tokenId) != msg.sender) revert NotCurrentOwner();
        emit TrainingReviewsInvalidated(tokenId, ++trainingReviewNonce[tokenId]);
    }

    function _requireOwner(uint256 tokenId) internal view override {
        if (!_reviewActive || msg.sender != address(this) || tokenId != _reviewToken) {
            revert TrainingReviewRequired();
        }
        if (collection.ownerOf(tokenId) != _reviewOwner) revert NotCurrentOwner();
    }

    function _validateArguments(TrainingReview calldata review) private pure {
        bool keyRequired =
            review.operation == Operation.LEARN || review.operation == Operation.EQUIP;
        bool slotRequired =
            review.operation == Operation.EQUIP || review.operation == Operation.UNEQUIP;
        bool claim = review.operation == Operation.CLAIM_RARITY;
        if (
            (keyRequired ? review.skillKey == bytes32(0) : review.skillKey != bytes32(0))
                || (slotRequired ? review.slot >= 7 : review.slot != 0)
                || (claim
                        ? review.startingSlots < 1 || review.startingSlots > 3
                        : review.startingSlots != 0)
                || (claim ? review.rarityProof.length > 32 : review.rarityProof.length != 0)
        ) revert InvalidReviewArguments();
    }
}
