// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { ArtAdapterRegistry } from "../src/ArtAdapterRegistry.sol";
import { ArtAgentRegistry } from "../src/ArtAgentRegistry.sol";
import { BrokerPolicyModuleV3 } from "../src/BrokerPolicyModuleV3.sol";
import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import { GoghPunkAccountRegistryV3 } from "../src/GoghPunkAccountRegistryV3.sol";
import { GoghPunkAccountV3 } from "../src/GoghPunkAccountV3.sol";
import {
    AutomatedSeaDropStudioFreeMintAdapter
} from "../src/adapters/AutomatedSeaDropStudioFreeMintAdapter.sol";

interface AutomatedV3DeploymentVm {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @title DeployAutomatedSeaDropV3
/// @notice Deploys the separate V3 free-only OpenSea Studio account path without enabling it.
/// @dev The four CREATEs are the only broadcast-scoped actions. Registration, feature flags,
///      Punk activation, policy configuration, agent authorization, and minting remain separate.
contract DeployAutomatedSeaDropV3 {
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    address public constant SEA_DROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;
    address public constant CLONE_IMPLEMENTATION = 0x09a26fC8FCEF18192E267D7A6da9dFb4be81Dd6A;
    address public constant STUDIO_REFERENCE_COLLECTION =
        0xC73Ee4987FDAd897e691EEccfa65C80Efb97f6f4;
    bytes32 public constant SEA_DROP_CODE_HASH =
        0x53e4b9339cf624803c9a7d0195576cca5b917920813508d86b3eb93dcbabeb5c;
    bytes32 public constant CLONE_IMPLEMENTATION_CODE_HASH =
        0xda60742d810ae5de9c087af2e82b05fb84e9112cfade927fca0db6490ea52519;
    bytes32 public constant STUDIO_RUNTIME_CODE_HASH =
        0x69e7a7158f30acb817dc83a4e21af19a216c3a2ae57db423599ca82f321e3041;

    AutomatedV3DeploymentVm private constant VM =
        AutomatedV3DeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Deployment {
        AutomatedSeaDropStudioFreeMintAdapter automatedAdapter;
        BrokerPolicyModuleV3 policyModule;
        GoghPunkAccountV3 accountImplementation;
        GoghPunkAccountRegistryV3 accountRegistry;
    }

    error WrongDeploymentChain(uint256 expected, uint256 actual);
    error InvalidGuardian(address guardian);
    error InvalidRegistry(address registry);
    error RegistryOwnerMismatch(address registry, address expected, address actual);
    error RegistryPaused(address registry);
    error InfrastructureHashMismatch(address target, bytes32 expected, bytes32 actual);
    error ReferenceCollectionIsNotERC721(address collection);
    error PostDeploymentAssertionFailed();

    event AutomatedSeaDropV3DeploymentPrepared(
        address indexed guardian,
        address indexed adapterRegistry,
        address indexed agentRegistry,
        address automatedAdapter,
        address policyModule,
        address accountImplementation,
        address accountRegistry,
        bytes32 accountSalt,
        bytes32 studioRuntimeCodeHash
    );

    function run() external returns (Deployment memory deployment) {
        address guardian = VM.envAddress("PROTOCOL_GUARDIAN");
        ArtAdapterRegistry adapterRegistry =
            ArtAdapterRegistry(VM.envAddress("GOGH_V3_ADAPTER_REGISTRY"));
        ArtAgentRegistry agentRegistry = ArtAgentRegistry(VM.envAddress("GOGH_V3_AGENT_REGISTRY"));
        validatePreparation(guardian, adapterRegistry, agentRegistry);

        VM.startBroadcast();
        deployment.automatedAdapter = new AutomatedSeaDropStudioFreeMintAdapter(
            SEA_DROP_CODE_HASH, CLONE_IMPLEMENTATION_CODE_HASH, STUDIO_RUNTIME_CODE_HASH
        );
        deployment.policyModule = new BrokerPolicyModuleV3(
            guardian, address(adapterRegistry), address(deployment.automatedAdapter)
        );
        deployment.accountImplementation = new GoghPunkAccountV3(
            address(deployment.policyModule), address(agentRegistry), address(adapterRegistry)
        );
        deployment.accountRegistry =
            new GoghPunkAccountRegistryV3(address(deployment.accountImplementation), bytes32(0));
        VM.stopBroadcast();

        _assertDeployment(deployment, guardian, adapterRegistry, agentRegistry);
        emit AutomatedSeaDropV3DeploymentPrepared(
            guardian,
            address(adapterRegistry),
            address(agentRegistry),
            address(deployment.automatedAdapter),
            address(deployment.policyModule),
            address(deployment.accountImplementation),
            address(deployment.accountRegistry),
            bytes32(0),
            STUDIO_RUNTIME_CODE_HASH
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
        _requireCodeHash(STUDIO_REFERENCE_COLLECTION, STUDIO_RUNTIME_CODE_HASH);
        if (!IERC165(STUDIO_REFERENCE_COLLECTION).supportsInterface(0x80ac58cd)) {
            revert ReferenceCollectionIsNotERC721(STUDIO_REFERENCE_COLLECTION);
        }
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
                    != CLONE_IMPLEMENTATION_CODE_HASH
                || deployment.automatedAdapter.expectedStudioRuntimeCodeHash()
                    != STUDIO_RUNTIME_CODE_HASH || deployment.policyModule.owner() != guardian
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
                || deployment.accountRegistry.implementationForVersion(3)
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
