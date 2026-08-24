// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ArtAgentRegistry } from "../src/ArtAgentRegistry.sol";
import { BrokerPolicyModule } from "../src/BrokerPolicyModule.sol";
import { BrokerPolicyModuleV3 } from "../src/BrokerPolicyModuleV3.sol";
import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import { GoghPunkAccountRegistryV3 } from "../src/GoghPunkAccountRegistryV3.sol";
import { GoghPunkAccountV3 } from "../src/GoghPunkAccountV3.sol";

interface AutomatedV3SetupVm {
    function envAddress(string calldata name) external view returns (address);
    function envUint(string calldata name) external view returns (uint256);
    function envUint(string calldata name, string calldata delimiter)
        external
        view
        returns (uint256[] memory values);
    function startBroadcast() external;
    function stopBroadcast() external;
}

interface IERC721CurrentOwner {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title SetupAutomatedSeaDropV3Punks
/// @notice Owner-only batch preparation for multiple V3 Punk Accounts.
/// @dev Each call remains a separate, inspectable transaction. Running without --broadcast is a
///      simulation. The script cannot enable global features, register adapters, submit a mint,
///      approve tokens, move Punk assets, or permit paid execution.
contract SetupAutomatedSeaDropV3Punks {
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    uint256 public constant MAX_PUNKS = 32;
    address public constant GOGH_PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address public constant ACCOUNT_REGISTRY = 0x7d4f654cD95104dc22c64Fc8C70937F32FcbAc52;
    address public constant POLICY_MODULE = 0x555A0533B2575F765Fe7A8c7BcF604120e76e1cd;
    address public constant AGENT_REGISTRY = 0xbffbccd20E796e0f3E745B274De60EF17a485Dde;
    bytes32 public constant ACCOUNT_REGISTRY_CODE_HASH =
        0x6aa5390e63f46d3712dad94040d41b8051d8d6c273c7bfb28ac7308bae63c645;
    bytes32 public constant POLICY_MODULE_CODE_HASH =
        0x6b6e2ca26fb3c02bb620b05a21799b17f4d93a1c4d8b2af5ee83724c0b3cd88d;
    bytes32 public constant AGENT_REGISTRY_CODE_HASH =
        0x3915ea566fa7b6fb11769f2b3109f69a4b65142e5140cc574b063cb608ff76b0;

    AutomatedV3SetupVm private constant VM =
        AutomatedV3SetupVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error WrongChain(uint256 actual);
    error InvalidOwner(address owner);
    error InvalidAgent(address agent);
    error InvalidPunkSet();
    error DuplicatePunk(uint256 tokenId);
    error OwnershipMismatch(uint256 tokenId, address expected, address actual);
    error InvalidDailyCap(uint256 cap);
    error InvalidAuthorizationDays(uint256 daysRequested);
    error InfrastructureHashMismatch(address target, bytes32 expected, bytes32 actual);
    error GlobalAgentUnavailable(address agent);
    error PostSetupMismatch(uint256 tokenId);

    event AutomatedV3PunkSetupPrepared(
        uint256 indexed tokenId,
        address indexed account,
        address indexed owner,
        address agent,
        uint32 dailyCap,
        uint64 authorizationValidUntil
    );

    function run() external {
        address expectedOwner = VM.envAddress("GOGH_V3_EXPECTED_OWNER");
        address agent = VM.envAddress("GOGH_V3_AGENT");
        uint256[] memory tokenIds = VM.envUint("GOGH_V3_PUNK_IDS", ",");
        uint256 capValue = VM.envUint("GOGH_V3_DAILY_CAP");
        uint256 daysValue = VM.envUint("GOGH_V3_AUTHORIZATION_DAYS");
        if (capValue != 1 && capValue != 3 && capValue != 5 && capValue != 10) {
            revert InvalidDailyCap(capValue);
        }
        if (daysValue != 7 && daysValue != 14 && daysValue != 30) {
            revert InvalidAuthorizationDays(daysValue);
        }
        uint32 dailyCap = uint32(capValue);
        uint64 validUntil = uint64(block.timestamp + daysValue * 1 days);

        _validatePreparation(expectedOwner, agent, tokenIds, validUntil);

        GoghPunkAccountRegistryV3 registry = GoghPunkAccountRegistryV3(ACCOUNT_REGISTRY);
        BrokerPolicyModuleV3 policy = BrokerPolicyModuleV3(POLICY_MODULE);
        ArtAgentRegistry agentRegistry = ArtAgentRegistry(AGENT_REGISTRY);
        VM.startBroadcast();
        for (uint256 index; index < tokenIds.length; ++index) {
            address account = registry.createAccount(tokenIds[index]);
            policy.configureAutomatedSeaDropPolicy(account, dailyCap);
            agentRegistry.authorizeAgent(account, agent, validUntil);
        }
        VM.stopBroadcast();

        for (uint256 index; index < tokenIds.length; ++index) {
            uint256 tokenId = tokenIds[index];
            address account = registry.account(tokenId);
            _assertSetup(tokenId, account, expectedOwner, agent, dailyCap, validUntil);
            emit AutomatedV3PunkSetupPrepared(
                tokenId, account, expectedOwner, agent, dailyCap, validUntil
            );
        }
    }

    function _validatePreparation(
        address expectedOwner,
        address agent,
        uint256[] memory tokenIds,
        uint64 validUntil
    ) private view {
        if (block.chainid != ROBINHOOD_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        if (expectedOwner == address(0)) revert InvalidOwner(expectedOwner);
        if (agent == address(0) || agent == expectedOwner || agent.code.length != 0) {
            revert InvalidAgent(agent);
        }
        if (tokenIds.length == 0 || tokenIds.length > MAX_PUNKS) revert InvalidPunkSet();
        _requireCodeHash(ACCOUNT_REGISTRY, ACCOUNT_REGISTRY_CODE_HASH);
        _requireCodeHash(POLICY_MODULE, POLICY_MODULE_CODE_HASH);
        _requireCodeHash(AGENT_REGISTRY, AGENT_REGISTRY_CODE_HASH);

        ArtAgentRegistry agentRegistry = ArtAgentRegistry(AGENT_REGISTRY);
        ArtAgentRegistry.GlobalAgent memory globalAgent = agentRegistry.globalAgent(agent);
        if (
            agentRegistry.globallyPaused() || !globalAgent.approved
                || block.timestamp < globalAgent.validAfter || validUntil > globalAgent.validUntil
        ) revert GlobalAgentUnavailable(agent);

        for (uint256 index; index < tokenIds.length; ++index) {
            uint256 tokenId = tokenIds[index];
            if (tokenId > 9999) revert InvalidPunkSet();
            for (uint256 prior; prior < index; ++prior) {
                if (tokenIds[prior] == tokenId) revert DuplicatePunk(tokenId);
            }
            address currentOwner = IERC721CurrentOwner(GOGH_PUNKS).ownerOf(tokenId);
            if (currentOwner != expectedOwner) {
                revert OwnershipMismatch(tokenId, expectedOwner, currentOwner);
            }
        }
    }

    function _assertSetup(
        uint256 tokenId,
        address account,
        address expectedOwner,
        address agent,
        uint32 dailyCap,
        uint64 validUntil
    ) private view {
        if (
            account.code.length == 0 || GoghPunkAccountV3(payable(account)).owner() != expectedOwner
                || address(GoghPunkAccountV3(payable(account)).policyModule()) != POLICY_MODULE
        ) revert PostSetupMismatch(tokenId);

        BrokerPolicyModule.PolicyState memory current =
            BrokerPolicyModuleV3(POLICY_MODULE).policy(account);
        if (
            current.configuredBy != expectedOwner || current.accountPaused
                || current.config.mode != GoghBrokerTypes.BrokerMode.AUTONOMOUS
                || current.config.maxSpendPerTransaction != 0 || current.config.maxSpendPerDay != 0
                || current.config.maxSpendPerWeek != 0 || current.config.maxMintPrice != 0
                || current.config.maxSecondaryPurchasePrice != 0
                || current.config.minimumNativeReserve != 0
                || current.config.maxAcquisitionsPerDay != dailyCap
                || current.config.maxIntentAge != 120 || current.config.maxSlippageBps != 0
                || current.config.requireCollectionAllowlist
                || !current.config.allowUnknownCollections
        ) revert PostSetupMismatch(tokenId);

        ArtAgentRegistry.AccountAuthorization memory authorization =
            ArtAgentRegistry(AGENT_REGISTRY).accountAuthorization(account, agent);
        if (
            !authorization.active || authorization.authorizingOwner != expectedOwner
                || authorization.validUntil != validUntil
                || !ArtAgentRegistry(AGENT_REGISTRY).isAuthorized(account, agent)
        ) revert PostSetupMismatch(tokenId);
    }

    function _requireCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert InfrastructureHashMismatch(target, expected, actual);
    }
}
