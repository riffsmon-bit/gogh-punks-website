// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface IGoghPunkAccount {
    function token() external view returns (uint256 chainId, address tokenContract, uint256 tokenId);
    function owner() external view returns (address);
    function state() external view returns (uint256);
    function acquisitionNonce() external view returns (uint256);
    function isCanonicalGoghPunkAccount() external view returns (bool);
}
