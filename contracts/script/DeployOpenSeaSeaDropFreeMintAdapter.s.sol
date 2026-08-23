// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import {
    IOpenSeaSeaDrop,
    IOpenSeaSeaDropCollection,
    OpenSeaSeaDropFreeMintAdapter
} from "../src/adapters/OpenSeaSeaDropFreeMintAdapter.sol";

interface SeaDropAdapterDeploymentVm {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Deploys only one reviewed, collection/account-bound SeaDrop free-mint adapter.
/// @dev This script does not register the adapter, configure a policy, authorize an agent, mint,
///      or enable any protocol feature. Without `--broadcast` it is a read-only simulation.
contract DeployOpenSeaSeaDropFreeMintAdapter {
    SeaDropAdapterDeploymentVm private constant VM =
        SeaDropAdapterDeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant ROBINHOOD_CHAIN_ID = 4663;
    address private constant SEA_DROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;
    address private constant OPEN_SEA_FEE_RECIPIENT = 0x0000a26b00c1F0DF003000390027140000fAa719;
    bytes32 private constant SEA_DROP_CODE_HASH =
        0x53e4b9339cf624803c9a7d0195576cca5b917920813508d86b3eb93dcbabeb5c;
    bytes32 private constant COLLECTION_CLONE_CODE_HASH =
        0xe3e252831cdd0c11e1327d04a57ddd9bfa11ef49d50edb524040d98bfb228bc4;
    bytes32 private constant CLONE_IMPLEMENTATION_CODE_HASH =
        0xda60742d810ae5de9c087af2e82b05fb84e9112cfade927fca0db6490ea52519;

    error WrongChain(uint256 supplied);
    error InvalidDeployment();

    event SeaDropFreeMintAdapterPrepared(
        address indexed adapter,
        address indexed collection,
        address indexed account,
        bytes32 adapterCodeHash,
        uint256 observedNextTokenId
    );

    function run() external returns (OpenSeaSeaDropFreeMintAdapter adapter) {
        if (block.chainid != ROBINHOOD_CHAIN_ID) revert WrongChain(block.chainid);
        address collection = VM.envAddress("OPENSEA_SEADROP_TEST_COLLECTION");
        address account = VM.envAddress("GOGH_SEADROP_TEST_ACCOUNT");

        VM.startBroadcast();
        adapter = new OpenSeaSeaDropFreeMintAdapter(
            collection,
            account,
            SEA_DROP_CODE_HASH,
            COLLECTION_CLONE_CODE_HASH,
            CLONE_IMPLEMENTATION_CODE_HASH
        );
        VM.stopBroadcast();

        (, uint256 currentTotalMinted,) =
            IOpenSeaSeaDropCollection(collection).getMintStats(account);
        uint256 nextTokenId = currentTotalMinted + 1;
        GoghBrokerTypes.AcquisitionIntent memory probe = GoghBrokerTypes.AcquisitionIntent({
            account: account,
            chainId: ROBINHOOD_CHAIN_ID,
            expectedOwner: address(1),
            nonce: 0,
            policyVersion: 0,
            opportunityType: GoghBrokerTypes.OpportunityType.FREE_MINT,
            assetStandard: GoghBrokerTypes.AssetStandard.ERC721,
            adapter: address(adapter),
            venue: SEA_DROP,
            collection: collection,
            tokenId: nextTokenId,
            assetAmount: 1,
            currency: address(0),
            expectedPrice: 0,
            maxPrice: 0,
            maxSlippageBps: 0,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 120),
            opportunityId: keccak256("deployment-probe"),
            reasoningHash: keccak256("deployment-probe"),
            adapterCodeHash: address(adapter).codehash
        });
        GoghBrokerTypes.AdapterExecution memory execution = adapter.buildExecution(probe, "");
        bytes memory expectedData = abi.encodeCall(
            IOpenSeaSeaDrop.mintPublic, (collection, OPEN_SEA_FEE_RECIPIENT, address(0), uint256(1))
        );
        if (
            adapter.collection() != collection || adapter.boundAccount() != account
                || execution.target != SEA_DROP || execution.value != 0
                || execution.currency != address(0) || execution.allowanceSpender != address(0)
                || execution.allowanceAmount != 0 || execution.paymentAmount != 0
                || keccak256(execution.callData) != keccak256(expectedData)
        ) revert InvalidDeployment();

        emit SeaDropFreeMintAdapterPrepared(
            address(adapter), collection, account, address(adapter).codehash, nextTokenId
        );
    }
}
