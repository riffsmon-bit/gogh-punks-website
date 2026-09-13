// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @dev Owned-disposable-chain fixture only; deliberately unrestricted mint.
contract MarketplaceTestNFT is ERC721 {
    constructor() ERC721("Gogh Marketplace Test Art", "GMTA") { }

    function mint(address recipient, uint256 tokenId) external {
        _mint(recipient, tokenId);
    }
}
