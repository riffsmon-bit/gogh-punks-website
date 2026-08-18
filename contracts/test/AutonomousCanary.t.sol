// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { BrokerPolicyModule } from "../src/BrokerPolicyModule.sol";
import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import { GoghPunkAccountV1 } from "../src/GoghPunkAccountV1.sol";
import { ArtBrokerTestBase } from "./ArtBrokerTestBase.sol";
import { MockMarketplace, MockMarketplaceAdapter } from "./mocks/TestInfrastructure.sol";

/// @notice A deliberately tiny, local-only rehearsal of the complete autonomous acquisition path.
/// @dev This test never reaches Robinhood RPC, never uses a production key, and never broadcasts.
contract AutonomousCanaryTest is ArtBrokerTestBase {
    uint256 private constant CANARY_BALANCE = 0.01 ether;
    uint256 private constant CANARY_PRICE = 0.0004 ether;
    uint256 private constant CANARY_MAXIMUM = 0.0005 ether;
    uint256 private constant CANARY_RESERVE = 0.0096 ether;
    uint256 private constant CANARY_TOKEN_ID = 4001;

    function testOnePunkAutonomousCanaryLifecycle() public {
        GoghBrokerTypes.FeatureFlags memory defaults = policy.featureFlags();
        require(!defaults.autonomousPurchases, "autonomy did not start disabled");
        require(!defaults.autonomousMints, "autonomous mint did not start disabled");
        require(!defaults.unknownCollectionExecution, "unknown execution did not start disabled");
        require(!defaults.autonomousSelling, "autonomous selling did not start disabled");

        VM.deal(address(account), CANARY_BALANCE);
        _enableCanaryFeature();
        _configureCanaryPolicy();
        _authorizeCanaryAgent();

        _list(CANARY_TOKEN_ID);
        GoghBrokerTypes.AcquisitionIntent memory intent =
            _canaryIntent(CANARY_TOKEN_ID, CANARY_PRICE);
        bytes memory adapterData =
            _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, CANARY_PRICE);

        VM.prank(agent);
        account.executeAutonomousAcquisition(intent, adapterData);

        require(art.ownerOf(CANARY_TOKEN_ID) == address(account), "canary NFT not delivered");
        require(address(account).balance == CANARY_RESERVE, "canary reserve changed");
        require(account.acquisitionNonce() == 1, "canary nonce not consumed exactly once");
        BrokerPolicyModule.Usage memory used = policy.usage(address(account), address(0));
        require(used.spentToday == CANARY_PRICE, "canary daily spend mismatch");
        require(used.spentThisWeek == CANARY_PRICE, "canary weekly spend mismatch");
        require(used.acquisitionsToday == 1, "canary acquisition count mismatch");

        _assertSecondAutonomousAcquisitionIsBlocked();
        _assertRevocationStopsAgent();
        _assertEmergencyPausePreservesOwnerRecovery();
    }

    function testCanaryRejectsPriceAboveTinyMaximumBeforeFundsMove() public {
        VM.deal(address(account), CANARY_BALANCE);
        _enableCanaryFeature();
        _configureCanaryPolicy();
        _authorizeCanaryAgent();

        uint256 excessivePrice = CANARY_MAXIMUM + 1;
        _list(CANARY_TOKEN_ID);
        GoghBrokerTypes.AcquisitionIntent memory intent =
            _canaryIntent(CANARY_TOKEN_ID, excessivePrice);
        uint256 balanceBefore = address(account).balance;

        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.PriceLimitExceeded.selector, CANARY_MAXIMUM, excessivePrice
            )
        );
        VM.prank(agent);
        account.executeAutonomousAcquisition(
            intent, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, excessivePrice)
        );

        require(address(account).balance == balanceBefore, "rejected price moved funds");
        require(account.acquisitionNonce() == 0, "rejected price consumed nonce");
        require(art.ownerOf(CANARY_TOKEN_ID) == address(marketplace), "rejected NFT moved");
    }

    function testCanaryRejectsReserveViolationBeforeFundsMove() public {
        VM.deal(address(account), CANARY_BALANCE);
        _enableCanaryFeature();
        _configureCanaryPolicy();
        _authorizeCanaryAgent();

        _list(CANARY_TOKEN_ID);
        GoghBrokerTypes.AcquisitionIntent memory intent =
            _canaryIntent(CANARY_TOKEN_ID, CANARY_MAXIMUM);
        uint256 balanceBefore = address(account).balance;

        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.MinimumReserveViolated.selector,
                CANARY_RESERVE,
                CANARY_BALANCE - CANARY_MAXIMUM
            )
        );
        VM.prank(agent);
        account.executeAutonomousAcquisition(
            intent, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, CANARY_MAXIMUM)
        );

        require(address(account).balance == balanceBefore, "reserve rejection moved funds");
        require(account.acquisitionNonce() == 0, "reserve rejection consumed nonce");
        require(art.ownerOf(CANARY_TOKEN_ID) == address(marketplace), "reserve rejection moved NFT");
    }

    function _enableCanaryFeature() private {
        GoghBrokerTypes.FeatureFlags memory flags = GoghBrokerTypes.FeatureFlags({
            scoutMode: true,
            approvalPurchases: false,
            autonomousPurchases: true,
            autonomousMints: false,
            unknownCollectionExecution: false,
            selling: false,
            autonomousSelling: false
        });
        VM.prank(guardian);
        policy.setFeatureFlags(flags);
    }

    function _configureCanaryPolicy() private {
        GoghBrokerTypes.PolicyConfig memory config = GoghBrokerTypes.PolicyConfig({
            mode: GoghBrokerTypes.BrokerMode.AUTONOMOUS,
            maxSpendPerTransaction: CANARY_MAXIMUM,
            maxSpendPerDay: CANARY_MAXIMUM,
            maxSpendPerWeek: CANARY_MAXIMUM,
            maxMintPrice: 0,
            maxSecondaryPurchasePrice: CANARY_MAXIMUM,
            minimumNativeReserve: CANARY_RESERVE,
            maxAcquisitionsPerDay: 1,
            maxIntentAge: 2 minutes,
            maxSlippageBps: 0,
            requireCollectionAllowlist: true,
            allowUnknownCollections: false
        });

        VM.startPrank(alice);
        policy.configurePolicy(address(account), config);
        policy.setAdapterPermission(address(account), address(marketplaceAdapter), true);
        policy.setVenuePermission(
            address(account), address(marketplace), GoghBrokerTypes.AdapterKind.MARKETPLACE, true
        );
        policy.setCollectionPermission(address(account), address(art), true, false);
        policy.setCurrencyPolicy(
            address(account),
            address(0),
            BrokerPolicyModule.CurrencyPolicy({
                allowed: true,
                maxSpendPerTransaction: 0,
                maxSpendPerDay: 0,
                maxSpendPerWeek: 0,
                maxMintPrice: 0,
                maxSecondaryPurchasePrice: 0
            })
        );
        policy.setVenueCurrencyMaximum(
            address(account), address(marketplace), address(0), CANARY_MAXIMUM
        );
        policy.setSelectorPermission(
            address(account), MockMarketplace.purchaseNative.selector, true, false
        );
        VM.stopPrank();
    }

    function _authorizeCanaryAgent() private {
        VM.prank(guardian);
        agents.configureGlobalAgent(
            agent,
            true,
            uint64(block.timestamp),
            uint64(block.timestamp + 2 hours),
            keccak256("local-canary-agent-v1"),
            keccak256("local-test-only")
        );
        VM.prank(alice);
        agents.authorizeAgent(address(account), agent, uint64(block.timestamp + 30 minutes));
    }

    function _canaryIntent(uint256 tokenId, uint256 price)
        private
        view
        returns (GoghBrokerTypes.AcquisitionIntent memory intent)
    {
        intent = _intent(tokenId, price);
        intent.expiresAt = uint64(block.timestamp + 2 minutes);
    }

    function _assertSecondAutonomousAcquisitionIsBlocked() private {
        uint256 secondTokenId = CANARY_TOKEN_ID + 1;
        _list(secondTokenId);
        GoghBrokerTypes.AcquisitionIntent memory second = _canaryIntent(secondTokenId, 0);
        VM.expectRevert(
            abi.encodeWithSelector(BrokerPolicyModule.DailyAcquisitionLimitExceeded.selector, 1)
        );
        VM.prank(agent);
        account.executeAutonomousAcquisition(
            second, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0)
        );
        require(art.ownerOf(secondTokenId) == address(marketplace), "second NFT escaped");
        require(account.acquisitionNonce() == 1, "blocked acquisition consumed nonce");
    }

    function _assertRevocationStopsAgent() private {
        VM.prank(alice);
        agents.revokeAgent(address(account), agent);
        uint256 thirdTokenId = CANARY_TOKEN_ID + 2;
        _list(thirdTokenId);
        GoghBrokerTypes.AcquisitionIntent memory third = _canaryIntent(thirdTokenId, 0);
        VM.expectRevert(
            abi.encodeWithSelector(GoghPunkAccountV1.AgentNotAuthorized.selector, agent)
        );
        VM.prank(agent);
        account.executeAutonomousAcquisition(
            third, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0)
        );
        require(art.ownerOf(thirdTokenId) == address(marketplace), "revoked agent moved NFT");
    }

    function _assertEmergencyPausePreservesOwnerRecovery() private {
        VM.prank(guardian);
        policy.setGloballyPaused(true);
        uint256 withdrawal = 0.0001 ether;
        uint256 recipientBefore = recipient.balance;
        VM.prank(alice);
        account.execute(recipient, withdrawal, "", 0);
        require(recipient.balance == recipientBefore + withdrawal, "owner recovery blocked");
    }
}
