// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Append-only, version-pinned skill definitions. No wallet or fund authority.
/// @dev READY is an accountable governance attestation, not an automatic security audit.
contract GoghSkillRegistry is Ownable2Step {
    enum Status {
        DISCOVERED,
        UNDER_REVIEW,
        ADAPTING,
        TESTING,
        READY,
        BLOCKED,
        REJECTED
    }

    struct Definition {
        bytes32 manifestHash;
        bytes32 instructionHash;
        bytes32 prerequisite;
        uint256 capabilities;
        uint32 skillId;
        uint16 version;
        uint8 riskTier;
        Status status;
        bool disabled;
        bool deprecated;
        bytes32 replacement;
        bytes32 reviewEvidenceHash;
    }

    mapping(bytes32 key => Definition definition) private _definitions;
    bytes32[] private _keys;
    bool public globallyDisabled;
    uint256 public disabledCapabilities;

    error InvalidDefinition();
    error UnknownSkill();
    error AlreadyRegistered();
    error InvalidTransition();

    event SkillRegistered(
        bytes32 indexed key, uint32 indexed skillId, uint16 version, bytes32 manifestHash
    );
    event SkillStatusChanged(bytes32 indexed key, Status status, bytes32 reviewEvidenceHash);
    event SkillDisabled(bytes32 indexed key, bool disabled);
    event SkillDeprecated(bytes32 indexed key, bytes32 replacement);
    event EmergencyControlsChanged(bool globallyDisabled, uint256 disabledCapabilities);

    constructor(address guardian) Ownable(guardian) { }

    function skillKey(uint32 skillId, uint16 version) public pure returns (bytes32) {
        return keccak256(abi.encode("GOGH_SKILL", skillId, version));
    }

    /// @dev No overwrite/migration of a previously learned version is possible.
    function register(
        uint32 skillId,
        uint16 version,
        bytes32 manifestHash,
        bytes32 instructionHash,
        bytes32 prerequisite,
        uint256 capabilities,
        uint8 riskTier
    ) external onlyOwner returns (bytes32 key) {
        if (
            skillId == 0 || version == 0 || manifestHash == bytes32(0)
                || instructionHash == bytes32(0) || capabilities == 0 || riskTier > 3
        ) revert InvalidDefinition();
        key = skillKey(skillId, version);
        if (_definitions[key].manifestHash != bytes32(0)) revert AlreadyRegistered();
        // Prerequisites must preexist; append-only edges cannot introduce a cycle.
        if (prerequisite != bytes32(0) && _definitions[prerequisite].manifestHash == bytes32(0)) {
            revert UnknownSkill();
        }
        _definitions[key] = Definition(
            manifestHash,
            instructionHash,
            prerequisite,
            capabilities,
            skillId,
            version,
            riskTier,
            Status.DISCOVERED,
            false,
            false,
            bytes32(0),
            bytes32(0)
        );
        _keys.push(key);
        emit SkillRegistered(key, skillId, version, manifestHash);
    }

    function setStatus(bytes32 key, Status status, bytes32 evidenceHash) external onlyOwner {
        Definition storage item = _known(key);
        if (item.deprecated || item.status == Status.REJECTED) revert InvalidTransition();
        if (status == Status.READY && (item.status != Status.TESTING || evidenceHash == bytes32(0)))
        {
            revert InvalidTransition();
        }
        item.status = status;
        item.reviewEvidenceHash = evidenceHash;
        emit SkillStatusChanged(key, status, evidenceHash);
    }

    function setDisabled(bytes32 key, bool disabled) external onlyOwner {
        _known(key).disabled = disabled;
        emit SkillDisabled(key, disabled);
    }

    function deprecate(bytes32 key, bytes32 replacement) external onlyOwner {
        Definition storage item = _known(key);
        if (replacement == key) revert InvalidDefinition();
        if (replacement != bytes32(0)) _known(replacement);
        item.deprecated = true;
        item.replacement = replacement;
        emit SkillDeprecated(key, replacement);
    }

    function setEmergencyControls(bool disabled, uint256 capabilityMask) external onlyOwner {
        globallyDisabled = disabled;
        disabledCapabilities = capabilityMask;
        emit EmergencyControlsChanged(disabled, capabilityMask);
    }

    function definition(bytes32 key) external view returns (Definition memory) {
        return _known(key);
    }

    function skillCount() external view returns (uint256) {
        return _keys.length;
    }

    function keyAt(uint256 index) external view returns (bytes32) {
        return _keys[index];
    }

    function available(bytes32 key) public view returns (bool) {
        if (globallyDisabled || key == bytes32(0)) return false;
        // Bound traversal and propagate disabled prerequisites through the entire chain.
        for (uint256 depth; depth < 16; ++depth) {
            Definition storage item = _definitions[key];
            if (
                item.manifestHash == bytes32(0) || item.status != Status.READY || item.disabled
                    || item.deprecated || (item.capabilities & disabledCapabilities) != 0
            ) return false;
            key = item.prerequisite;
            if (key == bytes32(0)) return true;
        }
        return false;
    }

    function _known(bytes32 key) private view returns (Definition storage item) {
        item = _definitions[key];
        if (item.manifestHash == bytes32(0)) revert UnknownSkill();
    }
}
