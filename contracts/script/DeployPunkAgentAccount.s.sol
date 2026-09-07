// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ArtAdapterRegistry } from "../src/ArtAdapterRegistry.sol";
import { GoghPunkAgentAccountRegistry } from "../src/GoghPunkAgentAccountRegistry.sol";
import { GoghPunkAgentAccount } from "../src/GoghPunkAgentAccount.sol";

interface PunkAgentAccountDeploymentVm {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @title DeployPunkAgentAccount
/// @notice Deploys the Punk Agent Account path without activating a Punk or session.
/// @dev The two CREATEs are the only broadcast-scoped actions. Adapter registration, Punk account
///      activation, session authorization, funding, UserOperation signing, and minting are separate.
contract DeployPunkAgentAccount {
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    address public constant ENTRY_POINT_V08 = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;

    PunkAgentAccountDeploymentVm private constant VM =
        PunkAgentAccountDeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Deployment {
        GoghPunkAgentAccount accountImplementation;
        GoghPunkAgentAccountRegistry accountRegistry;
    }

    error WrongDeploymentChain(uint256 expected, uint256 actual);
    error InvalidContract(address target);
    error RegistryPaused(address registry);
    error PostDeploymentAssertionFailed();

    event PunkAgentAccountDeploymentPrepared(
        address indexed adapterRegistry,
        address indexed entryPoint,
        address accountImplementation,
        address accountRegistry,
        bytes32 accountSalt
    );

    function run() external returns (Deployment memory deployment) {
        ArtAdapterRegistry adapterRegistry =
            ArtAdapterRegistry(VM.envAddress("GOGH_AGENT_ACCOUNT_ADAPTER_REGISTRY"));
        validatePreparation(adapterRegistry);

        VM.startBroadcast();
        deployment.accountImplementation =
            new GoghPunkAgentAccount(ENTRY_POINT_V08, address(adapterRegistry));
        deployment.accountRegistry =
            new GoghPunkAgentAccountRegistry(address(deployment.accountImplementation), bytes32(0));
        VM.stopBroadcast();

        if (
            address(deployment.accountImplementation.entryPoint()) != ENTRY_POINT_V08
                || address(deployment.accountImplementation.adapterRegistry())
                    != address(adapterRegistry)
                || deployment.accountRegistry.implementation()
                    != address(deployment.accountImplementation)
                || deployment.accountRegistry.accountSalt() != bytes32(0)
                || deployment.accountRegistry.implementationForVersion(4)
                    != address(deployment.accountImplementation)
        ) revert PostDeploymentAssertionFailed();
        emit PunkAgentAccountDeploymentPrepared(
            address(adapterRegistry),
            ENTRY_POINT_V08,
            address(deployment.accountImplementation),
            address(deployment.accountRegistry),
            bytes32(0)
        );
    }

    function validatePreparation(ArtAdapterRegistry adapterRegistry) public view {
        if (block.chainid != ROBINHOOD_CHAIN_ID) {
            revert WrongDeploymentChain(ROBINHOOD_CHAIN_ID, block.chainid);
        }
        if (ENTRY_POINT_V08.code.length == 0) revert InvalidContract(ENTRY_POINT_V08);
        if (address(adapterRegistry).code.length == 0) {
            revert InvalidContract(address(adapterRegistry));
        }
        if (adapterRegistry.globallyPaused()) revert RegistryPaused(address(adapterRegistry));
    }
}
