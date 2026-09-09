// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { GoghSkillProgression } from "./GoghSkillProgression.sol";

/// @notice Fixed rarity starting capacity. Claims follow token ID, never grant economic authority.
/// @dev New deployment only; does not modify or migrate an existing progression contract.
contract GoghRaritySkillProgression is GoghSkillProgression {
    bytes32 public constant ALLOCATION_DOMAIN = keccak256("GOGH_RARITY_SLOTS_V1");
    bytes32 public immutable allocationRoot;
    bytes32 public immutable snapshotHash;
    uint256 public immutable allocationChainId;
    mapping(uint256 tokenId => uint8 slots) public claimedStartingSlots;

    error InvalidAllocation();
    error AlreadyClaimed();
    error RarityClaimRequired();

    event RaritySlotsClaimed(uint256 indexed tokenId, uint8 startingSlots, bytes32 snapshotHash);

    constructor(
        address collection_,
        address registry_,
        address trainingSource_,
        bytes32 root_,
        bytes32 snapshotHash_
    ) GoghSkillProgression(collection_, registry_, trainingSource_, 1, 7) {
        if (root_ == bytes32(0) || snapshotHash_ == bytes32(0)) {
            revert InvalidAllocation();
        }
        allocationRoot = root_;
        snapshotHash = snapshotHash_;
        allocationChainId = block.chainid;
    }

    function allocationLeaf(uint256 tokenId, uint8 startingSlots) public view returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        ALLOCATION_DOMAIN,
                        allocationChainId,
                        address(collection),
                        snapshotHash,
                        tokenId,
                        startingSlots
                    )
                )
            )
        );
    }

    function claimRaritySlots(uint256 tokenId, uint8 startingSlots, bytes32[] calldata proof)
        external
    {
        if (collection.ownerOf(tokenId) != msg.sender) revert NotCurrentOwner();
        if (claimedStartingSlots[tokenId] != 0) revert AlreadyClaimed();
        if (
            block.chainid != allocationChainId || startingSlots < 1 || startingSlots > 3
                || !MerkleProof.verifyCalldata(
                    proof, allocationRoot, allocationLeaf(tokenId, startingSlots)
                )
        ) {
            revert InvalidAllocation();
        }
        claimedStartingSlots[tokenId] = startingSlots;
        emit RaritySlotsClaimed(tokenId, startingSlots, snapshotHash);
    }

    function unlockedSlots(uint256 tokenId) public view override returns (uint8) {
        uint8 starting = claimedStartingSlots[tokenId];
        return super.unlockedSlots(tokenId) + (starting == 0 ? 0 : starting - 1);
    }

    function _beforeUnlockSlot(uint256 tokenId) internal view override {
        // Claim first, including one-slot Punks: late bonuses cannot consume a paid unlock
        // or push an already-trained Punk above the fixed seven-slot cap.
        if (claimedStartingSlots[tokenId] == 0) revert RarityClaimRequired();
    }
}
