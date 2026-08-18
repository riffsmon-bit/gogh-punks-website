// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ArtAgentRegistry } from "../src/ArtAgentRegistry.sol";
import { BrokerPolicyModule } from "../src/BrokerPolicyModule.sol";
import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import { GoghPunkAccountV1 } from "../src/GoghPunkAccountV1.sol";
import { ArtBrokerTestBase } from "./ArtBrokerTestBase.sol";
import {
    MockCanonicalGoghPunks,
    MockMarketplace,
    MockMarketplaceAdapter
} from "./mocks/TestInfrastructure.sol";

contract AgentSecurityTest is ArtBrokerTestBase {
    function testAutonomousModeCannotBeConfiguredWhileFeatureIsDisabled() public {
        GoghBrokerTypes.PolicyConfig memory config = GoghBrokerTypes.PolicyConfig({
            mode: GoghBrokerTypes.BrokerMode.AUTONOMOUS,
            maxSpendPerTransaction: 1,
            maxSpendPerDay: 1,
            maxSpendPerWeek: 1,
            maxMintPrice: 1,
            maxSecondaryPurchasePrice: 1,
            minimumNativeReserve: 0,
            maxAcquisitionsPerDay: 1,
            maxIntentAge: 60,
            maxSlippageBps: 0,
            requireCollectionAllowlist: true,
            allowUnknownCollections: false
        });
        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.FeatureDisabled.selector, bytes32("AUTONOMOUS_PURCHASES")
            )
        );
        VM.prank(alice);
        policy.configurePolicy(address(account), config);
    }

    function testAuthorizedAgentCanOnlyExecuteTypedAcquisition() public {
        _setFeatures(true, true, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.AUTONOMOUS);
        _authorizeAgent();
        _list(2001);
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(2001, 0.02 ether);
        VM.prank(agent);
        account.executeAutonomousAcquisition(
            intent, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.02 ether)
        );
        require(art.ownerOf(2001) == address(account), "agent purchase failed");

        VM.expectRevert(
            abi.encodeWithSelector(GoghPunkAccountV1.NotAuthorized.selector, agent, alice)
        );
        VM.prank(agent);
        account.execute(recipient, 0.1 ether, "", 0);
    }

    function testRevokedExpiredAndGloballyPausedAgentCannotExecute() public {
        _setFeatures(true, true, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.AUTONOMOUS);
        _authorizeAgent();
        _list(2010);
        VM.prank(alice);
        agents.revokeAgent(address(account), agent);
        GoghBrokerTypes.AcquisitionIntent memory revokedIntent = _intent(2010, 0.01 ether);
        VM.expectRevert(
            abi.encodeWithSelector(GoghPunkAccountV1.AgentNotAuthorized.selector, agent)
        );
        VM.prank(agent);
        account.executeAutonomousAcquisition(
            revokedIntent, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.01 ether)
        );

        _authorizeAgent();
        VM.prank(guardian);
        agents.setGloballyPaused(true);
        GoghBrokerTypes.AcquisitionIntent memory pausedIntent = _intent(2010, 0.01 ether);
        VM.expectRevert(
            abi.encodeWithSelector(GoghPunkAccountV1.AgentNotAuthorized.selector, agent)
        );
        VM.prank(agent);
        account.executeAutonomousAcquisition(
            pausedIntent, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.01 ether)
        );
    }

    function testPunkTransferImmediatelyInvalidatesAgent() public {
        _setFeatures(true, true, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.AUTONOMOUS);
        _authorizeAgent();
        _list(2020);
        VM.prank(alice);
        MockCanonicalGoghPunks(GOGH_PUNKS).transferFrom(alice, bob, TOKEN_ID);
        require(!agents.isAuthorized(address(account), agent), "old authorization survived");
        GoghBrokerTypes.AcquisitionIntent memory transferredIntent = _intent(2020, 0.01 ether);
        VM.expectRevert(
            abi.encodeWithSelector(GoghPunkAccountV1.AgentNotAuthorized.selector, agent)
        );
        VM.prank(agent);
        account.executeAutonomousAcquisition(
            transferredIntent,
            _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.01 ether)
        );
    }

    function testAgentExpirationIsHardBounded() public {
        _setFeatures(true, true, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.AUTONOMOUS);
        VM.prank(guardian);
        agents.configureGlobalAgent(
            agent,
            true,
            uint64(block.timestamp),
            uint64(block.timestamp + 2 days),
            keccak256("short"),
            bytes32(0)
        );
        VM.prank(alice);
        agents.authorizeAgent(address(account), agent, uint64(block.timestamp + 1 days));
        VM.warp(block.timestamp + 1 days + 1);
        require(!agents.isAuthorized(address(account), agent), "expired agent authorized");
    }

    function testAutonomousMintRequiresSeparateGlobalAndOwnerPermissions() public {
        _setFeatures(true, true, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.AUTONOMOUS);
        _authorizeAgent();
        MockMarketplaceAdapter mintAdapter =
            new MockMarketplaceAdapter(address(marketplace), GoghBrokerTypes.AdapterKind.MINT);
        VM.prank(guardian);
        adapters.registerAdapter(
            address(mintAdapter),
            GoghBrokerTypes.AdapterKind.MINT,
            address(marketplace),
            keccak256("mint-v1"),
            bytes32(0)
        );
        VM.startPrank(alice);
        policy.setAdapterPermission(address(account), address(mintAdapter), true);
        policy.setVenuePermission(
            address(account), address(marketplace), GoghBrokerTypes.AdapterKind.MINT, true
        );
        policy.setSelectorPermission(
            address(account), MockMarketplace.mintERC721.selector, true, false
        );
        VM.stopPrank();

        GoghBrokerTypes.AcquisitionIntent memory mintIntent = _intent(2030, 0.01 ether);
        mintIntent.opportunityType = GoghBrokerTypes.OpportunityType.MINT;
        mintIntent.adapter = address(mintAdapter);
        mintIntent.adapterCodeHash = address(mintAdapter).codehash;
        mintIntent.policyVersion = policy.policyVersion(address(account));
        bytes memory data = _adapterData(MockMarketplaceAdapter.Behavior.MINT_ERC721, 0.01 ether);
        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.FeatureDisabled.selector, bytes32("AUTONOMOUS_MINTS")
            )
        );
        VM.prank(agent);
        account.executeAutonomousAcquisition(mintIntent, data);

        _setFeatures(true, true, true);
        VM.prank(agent);
        account.executeAutonomousAcquisition(mintIntent, data);
        require(art.ownerOf(2030) == address(account), "mint failed");
    }

    function testAdapterKillSwitchStopsAuthorizedAgent() public {
        _setFeatures(true, true, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.AUTONOMOUS);
        _authorizeAgent();
        _list(2040);
        VM.prank(guardian);
        adapters.setAdapterActive(address(marketplaceAdapter), false);
        GoghBrokerTypes.AcquisitionIntent memory disabledAdapterIntent = _intent(2040, 0.01 ether);
        VM.expectRevert(GoghPunkAccountV1.AdapterExecutionInvalid.selector);
        VM.prank(agent);
        account.executeAutonomousAcquisition(
            disabledAdapterIntent,
            _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.01 ether)
        );
    }

    function testReentrantVenueCannotReachAccountExecution() public {
        _setFeatures(true, true, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.AUTONOMOUS);
        _authorizeAgent();
        VM.prank(alice);
        policy.setSelectorPermission(
            address(account), MockMarketplace.reentrantPurchase.selector, true, false
        );
        bytes memory nested = abi.encodeCall(
            GoghPunkAccountV1.executeAutonomousAcquisition,
            (
                _intent(2050, 0.01 ether),
                _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.01 ether)
            )
        );
        marketplace.configureReentry(nested);
        GoghBrokerTypes.AcquisitionIntent memory outer = _intent(2050, 0.01 ether);
        VM.expectRevert();
        VM.prank(agent);
        account.executeAutonomousAcquisition(
            outer, _adapterData(MockMarketplaceAdapter.Behavior.REENTRANT, 0.01 ether)
        );
        require(account.acquisitionNonce() == 0, "nonce consumed");
    }

    function testOnlyCurrentOwnerCanAuthorizeOrChangePolicy() public {
        _setFeatures(true, true, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.AUTONOMOUS);
        VM.expectRevert(
            abi.encodeWithSelector(ArtAgentRegistry.NotCurrentPunkOwner.selector, bob, alice)
        );
        VM.prank(bob);
        agents.authorizeAgent(address(account), agent, uint64(block.timestamp + 1 days));

        BrokerPolicyModule.PolicyState memory stored = policy.policy(address(account));
        VM.expectRevert(
            abi.encodeWithSelector(BrokerPolicyModule.NotCurrentPunkOwner.selector, bob, alice)
        );
        VM.prank(bob);
        policy.configurePolicy(address(account), stored.config);
    }
}
