// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { GoghSkillRegistry } from "./GoghSkillRegistry.sol";

/// @notice Permanent collection/token progression, separate from owner strategy and custody.
/// @dev There is deliberately NO production burn implementation in this contract.
/// An immutable, separately reviewed training source must prove safe atomic sacrifice.
contract GoghSkillProgression {
    IERC721 public immutable collection;
    GoghSkillRegistry public immutable registry;
    address public immutable trainingSource;
    uint8 public immutable baseSlots;
    uint8 public immutable slotCap;

    mapping(uint256 tokenId => uint256 credits) public trainingCredits;
    mapping(uint256 tokenId => uint8 slots) private _additionalSlots;
    mapping(uint256 tokenId => mapping(bytes32 key => uint8 level)) public learnedLevel;
    mapping(uint256 tokenId => bytes32[] keys) private _learned;
    mapping(uint256 tokenId => mapping(uint8 slot => bytes32 key)) public equipped;
    mapping(uint256 sacrificedTokenId => bool consumed) public sacrificeCredited;
    uint256 public creditsCreated;
    uint256 public creditsSpent;

    error InvalidConfiguration();
    error NotCurrentOwner();
    error InvalidTrainingSource();
    error InvalidSacrifice();
    error NoCredit();
    error SkillUnavailable();
    error AlreadyLearned();
    error PrerequisiteMissing();
    error SlotUnavailable();
    error NotLearned();
    error DuplicateEquipment();

    event TrainingCreditEarned(uint256 indexed tokenId, uint256 indexed sacrificedTokenId);
    event SkillLearned(uint256 indexed tokenId, bytes32 indexed key, uint8 level);
    event SlotUnlocked(uint256 indexed tokenId, uint8 totalSlots);
    event SkillEquipped(uint256 indexed tokenId, uint8 indexed slot, bytes32 indexed key);
    event SkillUnequipped(uint256 indexed tokenId, uint8 indexed slot, bytes32 indexed key);

    constructor(
        address collection_,
        address registry_,
        address trainingSource_,
        uint8 baseSlots_,
        uint8 slotCap_
    ) {
        if (
            collection_.code.length == 0 || registry_.code.length == 0
                || trainingSource_.code.length == 0 || baseSlots_ == 0 || slotCap_ < baseSlots_
                || slotCap_ > 32
        ) revert InvalidConfiguration();
        collection = IERC721(collection_);
        registry = GoghSkillRegistry(registry_);
        trainingSource = trainingSource_;
        baseSlots = baseSlots_;
        slotCap = slotCap_;
    }

    /// @dev Only the reviewed source can call this. Source must establish ownership of BOTH
    /// tokens before burn, prevent stranded assets and burn atomically before credit issuance.
    function awardTrainingCredit(uint256 sacrificedTokenId, uint256 tokenId) external {
        if (msg.sender != trainingSource) revert InvalidTrainingSource();
        if (sacrificedTokenId == tokenId || sacrificeCredited[sacrificedTokenId]) {
            revert InvalidSacrifice();
        }
        if (collection.ownerOf(tokenId) == address(0)) revert InvalidSacrifice();
        // A still-existing parent is never a sacrifice. Nonexistence alone is NOT proof of a
        // prior burn: the immutable source must supply that provenance, as documented above.
        try collection.ownerOf(sacrificedTokenId) returns (address) {
            revert InvalidSacrifice();
        } catch { }
        sacrificeCredited[sacrificedTokenId] = true;
        ++trainingCredits[tokenId];
        ++creditsCreated;
        emit TrainingCreditEarned(tokenId, sacrificedTokenId);
    }

    function learnSkill(uint256 tokenId, bytes32 key) external {
        _requireOwner(tokenId);
        if (!registry.available(key)) revert SkillUnavailable();
        if (learnedLevel[tokenId][key] != 0) revert AlreadyLearned();
        GoghSkillRegistry.Definition memory item = registry.definition(key);
        if (item.prerequisite != bytes32(0) && learnedLevel[tokenId][item.prerequisite] == 0) {
            revert PrerequisiteMissing();
        }
        _spend(tokenId);
        learnedLevel[tokenId][key] = 1;
        _learned[tokenId].push(key);
        emit SkillLearned(tokenId, key, 1);
    }

    function unlockSlot(uint256 tokenId) external {
        _requireOwner(tokenId);
        _beforeUnlockSlot(tokenId);
        if (unlockedSlots(tokenId) >= slotCap) revert SlotUnavailable();
        _spend(tokenId);
        ++_additionalSlots[tokenId];
        emit SlotUnlocked(tokenId, unlockedSlots(tokenId));
    }

    function equipSkill(uint256 tokenId, uint8 slot, bytes32 key) external {
        _requireOwner(tokenId);
        if (slot >= unlockedSlots(tokenId)) revert SlotUnavailable();
        if (learnedLevel[tokenId][key] == 0) revert NotLearned();
        if (!registry.available(key)) revert SkillUnavailable();
        GoghSkillRegistry.Definition memory item = registry.definition(key);
        if (item.prerequisite != bytes32(0) && learnedLevel[tokenId][item.prerequisite] == 0) {
            revert PrerequisiteMissing();
        }
        for (uint8 i; i < unlockedSlots(tokenId); ++i) {
            if (equipped[tokenId][i] == key) revert DuplicateEquipment();
        }
        bytes32 prior = equipped[tokenId][slot];
        if (prior != bytes32(0)) emit SkillUnequipped(tokenId, slot, prior);
        equipped[tokenId][slot] = key;
        emit SkillEquipped(tokenId, slot, key);
    }

    function unequipSkill(uint256 tokenId, uint8 slot) external {
        _requireOwner(tokenId);
        if (slot >= unlockedSlots(tokenId)) revert SlotUnavailable();
        bytes32 prior = equipped[tokenId][slot];
        delete equipped[tokenId][slot];
        if (prior != bytes32(0)) emit SkillUnequipped(tokenId, slot, prior);
    }

    /// @notice Possession is necessary but never sufficient for economic authorization.
    /// Owner mode, policy, session, budgets, code/adapter checks and simulation still apply.
    function effectiveCapabilities(uint256 tokenId) external view returns (uint256 mask) {
        try collection.ownerOf(tokenId) returns (address owner) {
            if (owner == address(0)) return 0;
        } catch {
            return 0;
        }
        for (uint8 i; i < unlockedSlots(tokenId); ++i) {
            bytes32 key = equipped[tokenId][i];
            if (key == bytes32(0) || learnedLevel[tokenId][key] == 0 || !registry.available(key)) {
                continue;
            }
            GoghSkillRegistry.Definition memory item = registry.definition(key);
            if (item.prerequisite != bytes32(0) && !registry.available(item.prerequisite)) {
                continue;
            }
            mask |= item.capabilities;
        }
    }

    function unlockedSlots(uint256 tokenId) public view virtual returns (uint8) {
        return baseSlots + _additionalSlots[tokenId];
    }

    function learnedCount(uint256 tokenId) external view returns (uint256) {
        return _learned[tokenId].length;
    }

    function learnedKeyAt(uint256 tokenId, uint256 index) external view returns (bytes32) {
        return _learned[tokenId][index];
    }

    function _requireOwner(uint256 tokenId) private view {
        if (collection.ownerOf(tokenId) != msg.sender) revert NotCurrentOwner();
    }

    function _spend(uint256 tokenId) private {
        if (trainingCredits[tokenId] == 0) revert NoCredit();
        --trainingCredits[tokenId];
        ++creditsSpent;
    }

    /// @dev Additive extensions may require a fixed starting allocation before paid unlocks.
    function _beforeUnlockSlot(uint256 tokenId) internal view virtual { }
}
