// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ERC721Burnable } from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { GoghReviewedSkillProgression } from "../../src/GoghReviewedSkillProgression.sol";
import { GoghForgeSupplyPolicy } from "../../src/GoghForgeSupplyPolicy.sol";

/// @dev Disposable fixtures only. No production deployment or asset attestation.
contract LocalBurnPunks is ERC721Burnable {
    uint256 public totalSupply;
    mapping(uint256 => uint256) public ownershipEpoch;

    constructor() ERC721("DISPOSABLE BURN PRACTICE", "TEST") {
        require(block.chainid == 31_337, "LOCAL_ONLY");
    }

    function mint(address owner, uint256 id) external {
        _mint(owner, id);
    }

    function mintReserve(address owner, uint256 first, uint256 count) external {
        require(count <= 100, "FIXTURE_BATCH_LIMIT");
        for (uint256 id = first; id < first + count; ++id) {
            _mint(owner, id);
        }
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address from)
    {
        from = super._update(to, tokenId, auth);
        if (from == address(0)) ++totalSupply;
        if (to == address(0)) --totalSupply;
        ++ownershipEpoch[tokenId];
    }
}

contract LocalReviewedBurnSource {
    LocalBurnPunks public immutable collection;
    address private immutable creator;
    GoghReviewedSkillProgression public progression;

    constructor(LocalBurnPunks collection_) {
        require(block.chainid == 31_337, "LOCAL_ONLY");
        collection = collection_;
        creator = msg.sender;
    }

    function bind(GoghReviewedSkillProgression progression_) external {
        require(msg.sender == creator && address(progression) == address(0), "BIND_ONCE");
        require(address(progression_.collection()) == address(collection), "COLLECTION");
        require(progression_.trainingSource() == address(this), "SOURCE");
        progression = progression_;
    }

    function sacrifice(
        uint256 source,
        uint256 target,
        bytes32 targetState,
        uint256 sourceEpoch,
        uint256 targetEpoch,
        uint64 deadline
    ) external {
        require(block.timestamp <= deadline && deadline <= block.timestamp + 60, "REVIEW_EXPIRED");
        require(source != target, "DISTINCT_PUNKS");
        require(
            collection.ownerOf(source) == msg.sender && collection.ownerOf(target) == msg.sender,
            "OWN_BOTH"
        );
        require(
            collection.ownershipEpoch(source) == sourceEpoch
                && collection.ownershipEpoch(target) == targetEpoch,
            "OWNERSHIP_CHANGED"
        );
        require(progression.trainingReviewStateHash(target) == targetState, "TRAINING_CHANGED");
        uint256 supply = GoghForgeSupplyPolicy.beforeSacrifice(address(collection));
        collection.burn(source);
        GoghForgeSupplyPolicy.afterSacrifice(address(collection), supply);
        progression.awardTrainingCredit(source, target);
    }
}

/// @dev Demonstrates the parent-owner loss with native assets only. Not a V1/V2/V3 implementation.
contract LocalBurnWallet {
    LocalBurnPunks public immutable collection;
    uint256 public immutable tokenId;

    constructor(LocalBurnPunks collection_, uint256 tokenId_) {
        require(block.chainid == 31_337, "LOCAL_ONLY");
        collection = collection_;
        tokenId = tokenId_;
    }

    function owner() public view returns (address) {
        try collection.ownerOf(tokenId) returns (address current) {
            return current;
        } catch {
            return address(0);
        }
    }

    function withdraw() external {
        require(msg.sender == owner(), "NO_OWNER_ACCESS");
        (bool ok,) = payable(msg.sender).call{ value: address(this).balance }("");
        require(ok, "WITHDRAW_FAILED");
    }

    receive() external payable { }
}
