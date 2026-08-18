// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ArtAdapterRegistry } from "../src/ArtAdapterRegistry.sol";
import { ArtAgentRegistry } from "../src/ArtAgentRegistry.sol";
import { BrokerPolicyModule } from "../src/BrokerPolicyModule.sol";
import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import { GoghPunkAccountRegistry } from "../src/GoghPunkAccountRegistry.sol";
import { GoghPunkAccountV1 } from "../src/GoghPunkAccountV1.sol";

interface DeploymentVm {
    function envAddress(string calldata name) external view returns (address);
    function envOr(string calldata name, bytes32 defaultValue) external view returns (bytes32);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @title DeployArtBroker
/// @notice Robinhood-only deployment script. Running without --broadcast performs simulation only.
/// @dev Constructors assign governance directly to PROTOCOL_GUARDIAN; the deployer receives no
///      account authority. No adapters or agents are registered and execution flags remain off.
contract DeployArtBroker {
    DeploymentVm private constant VM =
        DeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Deployment {
        ArtAdapterRegistry adapterRegistry;
        ArtAgentRegistry agentRegistry;
        BrokerPolicyModule policyModule;
        GoghPunkAccountV1 accountImplementation;
        GoghPunkAccountRegistry accountRegistry;
    }

    event ArtBrokerDeploymentPrepared(
        address indexed guardian,
        address adapterRegistry,
        address agentRegistry,
        address policyModule,
        address accountImplementation,
        address accountRegistry,
        bytes32 accountSalt
    );

    function run() external returns (Deployment memory deployment) {
        address guardian = VM.envAddress("PROTOCOL_GUARDIAN");
        require(guardian != address(0), "PROTOCOL_GUARDIAN is zero");
        bytes32 accountSalt = VM.envOr("GOGH_ACCOUNT_SALT", bytes32(0));

        VM.startBroadcast();
        deployment.adapterRegistry = new ArtAdapterRegistry(guardian);
        deployment.agentRegistry = new ArtAgentRegistry(guardian);
        deployment.policyModule =
            new BrokerPolicyModule(guardian, address(deployment.adapterRegistry));
        deployment.accountImplementation = new GoghPunkAccountV1(
            address(deployment.policyModule),
            address(deployment.agentRegistry),
            address(deployment.adapterRegistry)
        );
        deployment.accountRegistry =
            new GoghPunkAccountRegistry(address(deployment.accountImplementation), accountSalt);
        VM.stopBroadcast();

        GoghBrokerTypes.FeatureFlags memory flags = deployment.policyModule.featureFlags();
        require(flags.scoutMode, "scout default off");
        require(!flags.approvalPurchases, "approval unexpectedly enabled");
        require(!flags.autonomousPurchases, "autonomy unexpectedly enabled");
        require(!flags.autonomousMints, "mint autonomy unexpectedly enabled");
        require(!flags.unknownCollectionExecution, "unknown execution unexpectedly enabled");
        require(!flags.selling && !flags.autonomousSelling, "selling unexpectedly enabled");

        emit ArtBrokerDeploymentPrepared(
            guardian,
            address(deployment.adapterRegistry),
            address(deployment.agentRegistry),
            address(deployment.policyModule),
            address(deployment.accountImplementation),
            address(deployment.accountRegistry),
            accountSalt
        );
    }
}
