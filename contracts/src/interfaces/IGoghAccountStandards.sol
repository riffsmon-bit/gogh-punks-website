// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface IERC6551Account {
    receive() external payable;

    function token() external view returns (uint256 chainId, address tokenContract, uint256 tokenId);
    function state() external view returns (uint256);
    function isValidSigner(address signer, bytes calldata context) external view returns (bytes4);
}

interface IERC6551Executable {
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory result);
}

interface IGoghAccountBatch {
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    function executeBatch(Call[] calldata calls) external payable returns (bytes[] memory results);
}
