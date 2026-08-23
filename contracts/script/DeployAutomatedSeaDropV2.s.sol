// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ArtAdapterRegistry } from "../src/ArtAdapterRegistry.sol";
import { ArtAgentRegistry } from "../src/ArtAgentRegistry.sol";
import { BrokerPolicyModuleV2 } from "../src/BrokerPolicyModuleV2.sol";
import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import { GoghPunkAccountRegistryV2 } from "../src/GoghPunkAccountRegistryV2.sol";
import { GoghPunkAccountV2 } from "../src/GoghPunkAccountV2.sol";
import {
    AutomatedSeaDropFreeMintAdapter
} from "../src/adapters/AutomatedSeaDropFreeMintAdapter.sol";

interface AutomatedV2DeploymentVm {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @title DeployAutomatedSeaDropV2
/// @notice Deploys the separate V2 automation account path without configuring or enabling it.
/// @dev This reuses the deployed V1 adapter and agent registries, but deploys a new adapter,
///      policy, account implementation, and version-two activation facade. Running without
///      `--broadcast` is simulation only. It never registers the adapter, approves an agent,
///      enables autonomy, activates a Punk, configures a Punk policy, or submits a mint.
contract DeployAutomatedSeaDropV2 {
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    address public constant SEA_DROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;
    address public constant CLONE_IMPLEMENTATION = 0x09a26fC8FCEF18192E267D7A6da9dFb4be81Dd6A;
    bytes32 public constant SEA_DROP_CODE_HASH =
        0x53e4b9339cf624803c9a7d0195576cca5b917920813508d86b3eb93dcbabeb5c;
    bytes32 public constant CLONE_IMPLEMENTATION_CODE_HASH =
        0xda60742d810ae5de9c087af2e82b05fb84e9112cfade927fca0db6490ea52519;

    AutomatedV2DeploymentVm private constant VM =
        AutomatedV2DeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Deployment {
        AutomatedSeaDropFreeMintAdapter automatedAdapter;
        BrokerPolicyModuleV2 policyModule;
        GoghPunkAccountV2 accountImplementation;
        GoghPunkAccountRegistryV2 accountRegistry;
    }

    error WrongDeploymentChain(uint256 expected, uint256 actual);
    error InvalidGuardian(address guardian);
    error InvalidRegistry(address registry);
    error RegistryOwnerMismatch(address registry, address expected, address actual);
    error RegistryPaused(address registry);
    error InfrastructureHashMismatch(address target, bytes32 expected, bytes32 actual);
    error PostDeploymentAssertionFailed();

    event AutomatedSeaDropV2DeploymentPrepared(
        address indexed guardian,
        address indexed adapterRegistry,
        address indexed agentRegistry,
        address automatedAdapter,
        address policyModule,
        address accountImplementation,
        address accountRegistry,
        bytes32 accountSalt
    );

    function run() external returns (Deployment memory deployment) {
        address guardian = VM.envAddress("PROTOCOL_GUARDIAN");
        ArtAdapterRegistry adapterRegistry =
            ArtAdapterRegistry(VM.envAddress("GOGH_V2_ADAPTER_REGISTRY"));
        ArtAgentRegistry agentRegistry = ArtAgentRegistry(VM.envAddress("GOGH_V2_AGENT_REGISTRY"));
        validatePreparation(guardian, adapterRegistry, agentRegistry);

        VM.startBroadcast();
        deployment.automatedAdapter = new AutomatedSeaDropFreeMintAdapter(
            SEA_DROP_CODE_HASH, CLONE_IMPLEMENTATION_CODE_HASH
        );
        deployment.policyModule = new BrokerPolicyModuleV2(
            guardian, address(adapterRegistry), address(deployment.automatedAdapter)
        );
        deployment.accountImplementation = new GoghPunkAccountV2(
            address(deployment.policyModule), address(agentRegistry), address(adapterRegistry)
        );
        deployment.accountRegistry =
            new GoghPunkAccountRegistryV2(address(deployment.accountImplementation), bytes32(0));
        VM.stopBroadcast();

        _assertDeployment(deployment, guardian, adapterRegistry, agentRegistry);
        emit AutomatedSeaDropV2DeploymentPrepared(
            guardian,
            address(adapterRegistry),
            address(agentRegistry),
            address(deployment.automatedAdapter),
            address(deployment.policyModule),
            address(deployment.accountImplementation),
            address(deployment.accountRegistry),
            bytes32(0)
        );
    }

    function validatePreparation(
        address guardian,
        ArtAdapterRegistry adapterRegistry,
        ArtAgentRegistry agentRegistry
    ) public view {
        if (block.chainid != ROBINHOOD_CHAIN_ID) {
            revert WrongDeploymentChain(ROBINHOOD_CHAIN_ID, block.chainid);
        }
        if (guardian == address(0)) revert InvalidGuardian(guardian);
        if (address(adapterRegistry).code.length == 0) {
            revert InvalidRegistry(address(adapterRegistry));
        }
        if (address(agentRegistry).code.length == 0) {
            revert InvalidRegistry(address(agentRegistry));
        }
        if (adapterRegistry.owner() != guardian) {
            revert RegistryOwnerMismatch(
                address(adapterRegistry), guardian, adapterRegistry.owner()
            );
        }
        if (agentRegistry.owner() != guardian) {
            revert RegistryOwnerMismatch(address(agentRegistry), guardian, agentRegistry.owner());
        }
        if (adapterRegistry.globallyPaused()) revert RegistryPaused(address(adapterRegistry));
        if (agentRegistry.globallyPaused()) revert RegistryPaused(address(agentRegistry));
        _requireCodeHash(SEA_DROP, SEA_DROP_CODE_HASH);
        _requireCodeHash(CLONE_IMPLEMENTATION, CLONE_IMPLEMENTATION_CODE_HASH);
    }

    function _assertDeployment(
        Deployment memory deployment,
        address guardian,
        ArtAdapterRegistry adapterRegistry,
        ArtAgentRegistry agentRegistry
    ) private view {
        GoghBrokerTypes.FeatureFlags memory flags = deployment.policyModule.featureFlags();
        if (
            deployment.automatedAdapter.kind() != GoghBrokerTypes.AdapterKind.MINT
                || deployment.automatedAdapter.venue() != SEA_DROP
                || deployment.automatedAdapter.expectedSeaDropCodeHash() != SEA_DROP_CODE_HASH
                || deployment.automatedAdapter.expectedCloneImplementationCodeHash()
                    != CLONE_IMPLEMENTATION_CODE_HASH || deployment.policyModule.owner() != guardian
                || address(deployment.policyModule.adapterRegistry()) != address(adapterRegistry)
                || deployment.policyModule.automatedSeaDropAdapter()
                    != address(deployment.automatedAdapter)
                || address(deployment.accountImplementation.policyModule())
                    != address(deployment.policyModule)
                || address(deployment.accountImplementation.agentRegistry())
                    != address(agentRegistry)
                || address(deployment.accountImplementation.adapterRegistry())
                    != address(adapterRegistry)
                || deployment.accountRegistry.implementation()
                    != address(deployment.accountImplementation)
                || deployment.accountRegistry.accountSalt() != bytes32(0)
                || deployment.accountRegistry.implementationForVersion(2)
                    != address(deployment.accountImplementation) || !flags.scoutMode
                || flags.approvalPurchases || flags.autonomousPurchases || flags.autonomousMints
                || flags.unknownCollectionExecution || flags.selling || flags.autonomousSelling
        ) revert PostDeploymentAssertionFailed();
    }

    function _requireCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert InfrastructureHashMismatch(target, expected, actual);
    }
}
