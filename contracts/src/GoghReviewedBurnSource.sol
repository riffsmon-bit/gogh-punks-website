// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { GoghReviewedSkillProgression } from "./GoghReviewedSkillProgression.sol";
import { GoghForgeSupplyPolicy } from "./GoghForgeSupplyPolicy.sol";

interface IGoghBurnablePunks is IERC721 {
    function burn(uint256 tokenId) external;
    function totalSupply() external view returns (uint256);
}

/// @notice Owner-reviewed, atomic original-Punk burn and one training credit.
/// @dev Candidate for a NEW deployment. Does not attest wallet inventories or recover
/// assets. Original NFT transfers have no synchronous epoch hook: the client must
/// verify both tokens' canonical Transfer history before requesting a transaction.
contract GoghReviewedBurnSource {
    bytes32 public constant REVIEW_DOMAIN = keccak256("GOGH_ORIGINAL_PUNK_BURN_REVIEW_V1");
    uint64 public constant MAX_REVIEW_LIFETIME = 60;
    IGoghBurnablePunks public immutable collection;
    bytes32 public immutable collectionCodeHash;
    address private immutable creator;
    GoghReviewedSkillProgression public progression;
    bytes32 public progressionCodeHash;
    bytes32 public registryCodeHash;
    mapping(uint256 sourceTokenId => uint256 nonce) public burnReviewNonce;
    bool private entered;

    struct BurnReview {
        uint256 sourceTokenId;
        uint256 targetTokenId;
        uint256 nonce;
        bytes32 stateHash;
        uint64 deadline;
    }

    error InvalidConfiguration();
    error AlreadyBound();
    error NotCurrentOwner();
    error DistinctPunksRequired();
    error TokenSpecificApprovalRequired();
    error ReviewExpired();
    error ReviewDeadlineTooFar();
    error ReviewNonceChanged();
    error ReviewStateChanged();
    error RuntimeChanged();
    error TrainingPaused();
    error BurnReentrancy();
    error CreditMismatch();

    event ProgressionBound(address indexed progression, bytes32 runtimeHash);
    event BurnReviewsInvalidated(uint256 indexed sourceTokenId, uint256 nonce);
    event PunkBurnReviewed(
        uint256 indexed sourceTokenId,
        uint256 indexed targetTokenId,
        address indexed owner,
        uint256 nonce,
        bytes32 stateHash
    );

    constructor(address collection_) {
        if (collection_.code.length == 0) revert InvalidConfiguration();
        collection = IGoghBurnablePunks(collection_);
        collectionCodeHash = collection_.codehash;
        creator = msg.sender;
    }

    /// @dev Resolves the constructor cycle once. The creator has no authority after binding.
    function bindProgression(address progression_) external {
        if (msg.sender != creator) revert NotCurrentOwner();
        if (address(progression) != address(0)) revert AlreadyBound();
        if (progression_.code.length == 0) revert InvalidConfiguration();
        GoghReviewedSkillProgression candidate = GoghReviewedSkillProgression(progression_);
        if (
            address(candidate.collection()) != address(collection)
                || candidate.trainingSource() != address(this)
                || address(candidate.registry()).code.length == 0
        ) revert InvalidConfiguration();
        progression = candidate;
        progressionCodeHash = progression_.codehash;
        registryCodeHash = address(candidate.registry()).codehash;
        emit ProgressionBound(progression_, progressionCodeHash);
    }

    function burnReviewStateHash(uint256 sourceTokenId, uint256 targetTokenId)
        public
        view
        returns (bytes32)
    {
        _requireRuntime();
        return keccak256(
            abi.encode(
                REVIEW_DOMAIN,
                block.chainid,
                address(this),
                address(collection),
                address(progression),
                sourceTokenId,
                targetTokenId,
                collection.ownerOf(sourceTokenId),
                collection.ownerOf(targetTokenId),
                burnReviewNonce[sourceTokenId],
                progression.trainingReviewStateHash(sourceTokenId),
                progression.trainingReviewStateHash(targetTokenId),
                collection.totalSupply()
            )
        );
    }

    /// @notice Requires a separate owner transaction; an NFT approval alone cannot burn.
    function applyBurnReview(BurnReview calldata review) external {
        if (entered) revert BurnReentrancy();
        entered = true;
        _requireRuntime();
        if (progression.registry().globallyDisabled()) revert TrainingPaused();
        if (review.sourceTokenId == review.targetTokenId) revert DistinctPunksRequired();
        if (
            collection.ownerOf(review.sourceTokenId) != msg.sender
                || collection.ownerOf(review.targetTokenId) != msg.sender
        ) revert NotCurrentOwner();
        if (
            collection.getApproved(review.sourceTokenId) != address(this)
                || collection.isApprovedForAll(msg.sender, address(this))
        ) revert TokenSpecificApprovalRequired();
        if (block.timestamp > review.deadline) revert ReviewExpired();
        if (uint256(review.deadline) > block.timestamp + MAX_REVIEW_LIFETIME) {
            revert ReviewDeadlineTooFar();
        }
        if (review.nonce != burnReviewNonce[review.sourceTokenId]) revert ReviewNonceChanged();
        if (review.stateHash != burnReviewStateHash(review.sourceTokenId, review.targetTokenId)) {
            revert ReviewStateChanged();
        }

        uint256 supply = GoghForgeSupplyPolicy.beforeSacrifice(address(collection));
        uint256 priorCredits = progression.trainingCredits(review.targetTokenId);
        ++burnReviewNonce[review.sourceTokenId];
        collection.burn(review.sourceTokenId);
        GoghForgeSupplyPolicy.afterSacrifice(address(collection), supply);
        if (collection.ownerOf(review.targetTokenId) != msg.sender) revert NotCurrentOwner();
        progression.awardTrainingCredit(review.sourceTokenId, review.targetTokenId);
        if (
            !progression.sacrificeCredited(review.sourceTokenId)
                || progression.trainingCredits(review.targetTokenId) != priorCredits + 1
        ) revert CreditMismatch();
        emit PunkBurnReviewed(
            review.sourceTokenId, review.targetTokenId, msg.sender, review.nonce, review.stateHash
        );
        entered = false;
    }

    function invalidateBurnReviews(uint256 sourceTokenId) external {
        if (entered) revert BurnReentrancy();
        if (collection.ownerOf(sourceTokenId) != msg.sender) revert NotCurrentOwner();
        emit BurnReviewsInvalidated(sourceTokenId, ++burnReviewNonce[sourceTokenId]);
    }

    function _requireRuntime() private view {
        if (address(progression) == address(0)) revert InvalidConfiguration();
        if (
            address(collection).codehash != collectionCodeHash
                || address(progression).codehash != progressionCodeHash
                || address(progression.registry()).codehash != registryCodeHash
        ) revert RuntimeChanged();
    }
}
