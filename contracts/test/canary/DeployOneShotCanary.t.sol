// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { DeployOneShotCanary } from "../../script/DeployOneShotCanary.s.sol";
import { GoghBrokerTypes } from "../../src/GoghBrokerTypes.sol";
import { GoghOneShotCanaryMintAdapter } from "../../src/adapters/GoghOneShotCanaryMintAdapter.sol";
import {
    GoghOneShotCanaryArt,
    IGoghPunkCanaryAccountRegistry
} from "../../src/canary/GoghOneShotCanaryArt.sol";
import { ArtBrokerTestBase } from "../ArtBrokerTestBase.sol";
import { MockCanonicalGoghPunks } from "../mocks/TestInfrastructure.sol";

contract InvalidCanaryRegistryConfiguration {
    function ROBINHOOD_CHAIN_ID() external pure returns (uint256) {
        return 1;
    }

    function GOGH_PUNKS() external pure returns (address) {
        return 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    }

    function CANONICAL_ERC6551_REGISTRY() external pure returns (address) {
        return 0x000000006551c19487814612e58FE06813775758;
    }

    function account(uint256) external pure returns (address) {
        return address(0xBEEF);
    }
}

interface CanaryDeploymentTestVm {
    function envAddress(string calldata name) external view returns (address);

    function setEnv(string calldata name, string calldata value) external;

    function toString(address value) external pure returns (string memory);

    function toString(uint256 value) external pure returns (string memory);
}

contract DeployOneShotCanaryTest is ArtBrokerTestBase {
    uint256 internal constant CANARY_ART_TOKEN_ID = 9001;
    CanaryDeploymentTestVm internal constant CANARY_VM =
        CanaryDeploymentTestVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    DeployOneShotCanary internal deploymentScript;

    function setUp() public override {
        super.setUp();
        deploymentScript = new DeployOneShotCanary();
    }

    function testValidationAcceptsExactActivatedAccountAndReturnsLiveOwner() public view {
        address currentOwner = deploymentScript.validatePreparation(
            IGoghPunkCanaryAccountRegistry(address(accountRegistry)),
            TOKEN_ID,
            address(account),
            alice,
            CANARY_ART_TOKEN_ID
        );
        require(currentOwner == alice, "wrong live owner");
    }

    function testRunReadsEnvironmentAndCreatesOnlyBoundUnmintedCanaryContracts() public {
        _setRunEnvironment(alice);

        uint64 policyVersionBefore = policy.policyVersion(address(account));
        uint256 accountStateBefore = account.state();
        DeployOneShotCanary.Deployment memory deployment = deploymentScript.run();

        GoghOneShotCanaryArt canaryArt = deployment.canaryArt;
        GoghOneShotCanaryMintAdapter canaryAdapter = deployment.canaryAdapter;
        require(address(canaryArt).code.length != 0, "canary art not created");
        require(address(canaryAdapter).code.length != 0, "canary adapter not created");
        require(deployment.currentOwnerAtPreparation == alice, "owner not bound");
        require(
            address(canaryArt.punkAccountRegistry()) == address(accountRegistry),
            "wrong account registry"
        );
        require(canaryArt.punkAccount() == address(account), "wrong Punk Account");
        require(canaryArt.controllingPunkTokenId() == TOKEN_ID, "wrong controlling Punk");
        require(canaryArt.canaryTokenId() == CANARY_ART_TOKEN_ID, "wrong canary token");
        require(!canaryArt.minted(), "deployment minted unexpectedly");
        require(address(canaryAdapter.canaryCollection()) == address(canaryArt), "wrong target");
        require(canaryAdapter.boundAccount() == address(account), "wrong adapter account");
        require(canaryAdapter.boundTokenId() == CANARY_ART_TOKEN_ID, "wrong adapter token");
        require(canaryAdapter.venue() == address(canaryArt), "wrong adapter venue");
        require(canaryAdapter.collection() == address(canaryArt), "wrong adapter collection");
        require(
            canaryAdapter.assetStandard() == GoghBrokerTypes.AssetStandard.ERC721,
            "wrong asset standard"
        );
        require(
            !adapters.validateAdapter(
                address(canaryAdapter),
                GoghBrokerTypes.AdapterKind.MINT,
                address(canaryArt),
                address(canaryAdapter).codehash
            ),
            "adapter was registered"
        );
        require(
            policy.policyVersion(address(account)) == policyVersionBefore, "policy was configured"
        );
        require(account.state() == accountStateBefore, "Punk Account was called");
    }

    function testRunRejectsEnvironmentOwnerThatIsNotCurrentOwner() public {
        _setRunEnvironment(bob);
        require(
            CANARY_VM.envAddress("GOGH_CANARY_EXPECTED_OWNER") == bob,
            "expected owner environment not set"
        );

        VM.expectRevert(
            abi.encodeWithSelector(DeployOneShotCanary.ExpectedOwnerMismatch.selector, bob, alice)
        );
        deploymentScript.run();
    }

    function testValidationRejectsWrongChainBeforePreparation() public {
        VM.chainId(1);
        VM.expectRevert(
            abi.encodeWithSelector(
                DeployOneShotCanary.WrongDeploymentChain.selector, uint256(4663), uint256(1)
            )
        );
        deploymentScript.validatePreparation(
            IGoghPunkCanaryAccountRegistry(address(accountRegistry)),
            TOKEN_ID,
            address(account),
            alice,
            CANARY_ART_TOKEN_ID
        );
        VM.chainId(4663);
    }

    function testValidationRejectsZeroAndNonContractRegistry() public {
        VM.expectRevert(DeployOneShotCanary.ZeroAccountRegistry.selector);
        deploymentScript.validatePreparation(
            IGoghPunkCanaryAccountRegistry(address(0)),
            TOKEN_ID,
            address(account),
            alice,
            CANARY_ART_TOKEN_ID
        );

        address eoa = address(0x1212);
        VM.expectRevert(
            abi.encodeWithSelector(DeployOneShotCanary.AccountRegistryHasNoCode.selector, eoa)
        );
        deploymentScript.validatePreparation(
            IGoghPunkCanaryAccountRegistry(eoa),
            TOKEN_ID,
            address(account),
            alice,
            CANARY_ART_TOKEN_ID
        );
    }

    function testValidationRejectsInvalidRegistryConfiguration() public {
        InvalidCanaryRegistryConfiguration invalidRegistry =
            new InvalidCanaryRegistryConfiguration();
        VM.expectRevert(
            abi.encodeWithSelector(
                DeployOneShotCanary.InvalidAccountRegistryConfiguration.selector,
                address(invalidRegistry)
            )
        );
        deploymentScript.validatePreparation(
            IGoghPunkCanaryAccountRegistry(address(invalidRegistry)),
            TOKEN_ID,
            address(account),
            alice,
            CANARY_ART_TOKEN_ID
        );
    }

    function testValidationRejectsZeroOrMismatchedExpectedAccount() public {
        VM.expectRevert(DeployOneShotCanary.ZeroExpectedAccount.selector);
        deploymentScript.validatePreparation(
            IGoghPunkCanaryAccountRegistry(address(accountRegistry)),
            TOKEN_ID,
            address(0),
            alice,
            CANARY_ART_TOKEN_ID
        );

        VM.expectRevert(
            abi.encodeWithSelector(
                DeployOneShotCanary.ExpectedAccountMismatch.selector, bob, address(account)
            )
        );
        deploymentScript.validatePreparation(
            IGoghPunkCanaryAccountRegistry(address(accountRegistry)),
            TOKEN_ID,
            bob,
            alice,
            CANARY_ART_TOKEN_ID
        );
    }

    function testValidationRejectsCounterfactualAccountWithoutCode() public {
        uint256 unactivatedPunkTokenId = TOKEN_ID + 1;
        MockCanonicalGoghPunks(GOGH_PUNKS).mint(bob, unactivatedPunkTokenId);
        address counterfactual = accountRegistry.account(unactivatedPunkTokenId);

        VM.expectRevert(
            abi.encodeWithSelector(
                DeployOneShotCanary.ActivatedAccountCodeMissing.selector, counterfactual
            )
        );
        deploymentScript.validatePreparation(
            IGoghPunkCanaryAccountRegistry(address(accountRegistry)),
            unactivatedPunkTokenId,
            counterfactual,
            bob,
            CANARY_ART_TOKEN_ID
        );
    }

    function testValidationRejectsActivatedAccountWithoutResolvableOwner() public {
        uint256 nestedPunkTokenId = TOKEN_ID + 2;
        address nestedAccount = accountRegistry.account(nestedPunkTokenId);
        MockCanonicalGoghPunks(GOGH_PUNKS).mint(nestedAccount, nestedPunkTokenId);
        VM.prank(nestedAccount);
        accountRegistry.createAccount(nestedPunkTokenId);

        VM.expectRevert(
            abi.encodeWithSelector(DeployOneShotCanary.AccountOwnerMissing.selector, nestedAccount)
        );
        deploymentScript.validatePreparation(
            IGoghPunkCanaryAccountRegistry(address(accountRegistry)),
            nestedPunkTokenId,
            nestedAccount,
            bob,
            CANARY_ART_TOKEN_ID
        );
    }

    function testValidationRejectsUnexpectedLiveOwner() public {
        VM.expectRevert(
            abi.encodeWithSelector(DeployOneShotCanary.ExpectedOwnerMismatch.selector, bob, alice)
        );
        deploymentScript.validatePreparation(
            IGoghPunkCanaryAccountRegistry(address(accountRegistry)),
            TOKEN_ID,
            address(account),
            bob,
            CANARY_ART_TOKEN_ID
        );
    }

    function _setRunEnvironment(address expectedOwner) private {
        CANARY_VM.setEnv(
            "GOGH_CANARY_ACCOUNT_REGISTRY", CANARY_VM.toString(address(accountRegistry))
        );
        CANARY_VM.setEnv("GOGH_CANARY_PUNK_TOKEN_ID", CANARY_VM.toString(TOKEN_ID));
        CANARY_VM.setEnv("GOGH_CANARY_EXPECTED_ACCOUNT", CANARY_VM.toString(address(account)));
        CANARY_VM.setEnv("GOGH_CANARY_EXPECTED_OWNER", CANARY_VM.toString(expectedOwner));
        CANARY_VM.setEnv("GOGH_CANARY_ART_TOKEN_ID", CANARY_VM.toString(CANARY_ART_TOKEN_ID));
    }
}
