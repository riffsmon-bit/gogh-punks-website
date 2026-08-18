// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { BrokerPolicyModule } from "../src/BrokerPolicyModule.sol";
import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import { GoghPunkAccountV1 } from "../src/GoghPunkAccountV1.sol";
import { ArtBrokerTestBase } from "./ArtBrokerTestBase.sol";
import {
    MockCanonicalGoghPunks,
    MockMarketplace,
    MockMarketplaceAdapter
} from "./mocks/TestInfrastructure.sol";

contract BrokerPolicyTest is ArtBrokerTestBase {
    function testProductionFeatureDefaultsAreFailClosed() public view {
        GoghBrokerTypes.FeatureFlags memory flags = policy.featureFlags();
        require(flags.scoutMode, "scout should start on");
        require(!flags.approvalPurchases, "approval unexpectedly on");
        require(!flags.autonomousPurchases, "autonomy unexpectedly on");
        require(!flags.autonomousMints, "autonomous mint unexpectedly on");
        require(!flags.unknownCollectionExecution, "unknown execution unexpectedly on");
        require(!flags.selling && !flags.autonomousSelling, "selling unexpectedly on");
    }

    function testOwnerApprovedNativeAcquisition() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        _list(1001);
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(1001, 0.04 ether);
        bytes memory data =
            _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.04 ether);

        VM.prank(alice);
        account.executeApprovedAcquisition(intent, data, "");

        require(art.ownerOf(1001) == address(account), "NFT not acquired");
        require(address(account).balance == 0.96 ether, "wrong spend");
        require(account.acquisitionNonce() == 1, "nonce");
        BrokerPolicyModule.Usage memory used = policy.usage(address(account), address(0));
        require(used.spentToday == 0.04 ether, "daily usage");
        require(used.spentThisWeek == 0.04 ether, "weekly usage");
        require(used.acquisitionsToday == 1, "count");
    }

    function testRelayedOwnerSignatureExecutesExactIntent() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        _list(1002);
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(1002, 0.03 ether);
        bytes memory data =
            _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.03 ether);
        bytes memory signature = _signIntent(ALICE_KEY, intent, data);

        VM.prank(recipient);
        account.executeApprovedAcquisition(intent, data, signature);
        require(art.ownerOf(1002) == address(account), "relayed acquisition failed");
    }

    function testSignatureCannotAuthorizeDifferentAdapterData() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        _list(1003);
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(1003, 0.04 ether);
        bytes memory signedData =
            _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.04 ether);
        bytes memory alteredData =
            _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.05 ether);
        bytes memory signature = _signIntent(ALICE_KEY, intent, signedData);

        VM.expectRevert(GoghPunkAccountV1.InvalidOwnerApproval.selector);
        VM.prank(recipient);
        account.executeApprovedAcquisition(intent, alteredData, signature);
    }

    function testTransferInvalidatesOldOwnerProposalAndPolicy() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        _list(1004);
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(1004, 0.02 ether);
        bytes memory data =
            _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.02 ether);
        bytes memory signature = _signIntent(ALICE_KEY, intent, data);

        VM.prank(alice);
        MockCanonicalGoghPunks(GOGH_PUNKS).transferFrom(alice, bob, TOKEN_ID);
        VM.expectRevert(GoghPunkAccountV1.InvalidIntent.selector);
        VM.prank(recipient);
        account.executeApprovedAcquisition(intent, data, signature);
        require(
            policy.effectiveMode(address(account)) == GoghBrokerTypes.BrokerMode.DISABLED,
            "stale policy active"
        );
    }

    function testMaximumTransactionAndMinimumReserveAreEnforced() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        _list(1005);
        GoghBrokerTypes.AcquisitionIntent memory excessive = _intent(1005, 0.11 ether);
        excessive.maxPrice = 0.11 ether;
        VM.expectRevert();
        VM.prank(alice);
        account.executeApprovedAcquisition(
            excessive, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.11 ether), ""
        );

        BrokerPolicyModule.PolicyState memory stored = policy.policy(address(account));
        stored.config.minimumNativeReserve = 0.97 ether;
        VM.prank(alice);
        policy.configurePolicy(address(account), stored.config);
        GoghBrokerTypes.AcquisitionIntent memory reserveViolation = _intent(1005, 0.04 ether);
        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.MinimumReserveViolated.selector, 0.97 ether, 0.96 ether
            )
        );
        VM.prank(alice);
        account.executeApprovedAcquisition(
            reserveViolation,
            _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.04 ether),
            ""
        );
    }

    function testDailyBudgetCannotBeBypassedByTransactionSplitting() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        BrokerPolicyModule.PolicyState memory stored = policy.policy(address(account));
        stored.config.maxSpendPerDay = 0.1 ether;
        VM.prank(alice);
        policy.configurePolicy(address(account), stored.config);

        _list(1010);
        _list(1011);
        GoghBrokerTypes.AcquisitionIntent memory first = _intent(1010, 0.06 ether);
        VM.prank(alice);
        account.executeApprovedAcquisition(
            first, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.06 ether), ""
        );

        GoghBrokerTypes.AcquisitionIntent memory second = _intent(1011, 0.06 ether);
        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.DailyBudgetExceeded.selector, 0.1 ether, 0.12 ether
            )
        );
        VM.prank(alice);
        account.executeApprovedAcquisition(
            second, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.06 ether), ""
        );
    }

    function testWeeklyBudgetPersistsAcrossDailyReset() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        BrokerPolicyModule.PolicyState memory stored = policy.policy(address(account));
        stored.config.maxSpendPerDay = 0.1 ether;
        stored.config.maxSpendPerWeek = 0.1 ether;
        VM.prank(alice);
        policy.configurePolicy(address(account), stored.config);
        uint256 weekStart = (block.timestamp / 7 days) * 7 days;
        VM.warp(weekStart + 1 days);

        _list(1020);
        _list(1021);
        GoghBrokerTypes.AcquisitionIntent memory firstDay = _intent(1020, 0.06 ether);
        VM.prank(alice);
        account.executeApprovedAcquisition(
            firstDay, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.06 ether), ""
        );
        VM.warp(weekStart + 2 days);
        GoghBrokerTypes.AcquisitionIntent memory nextDay = _intent(1021, 0.06 ether);
        // The compiler may common-subexpression-eliminate block.timestamp around the VM cheatcode.
        nextDay.createdAt = uint64(weekStart + 2 days);
        nextDay.expiresAt = uint64(weekStart + 2 days + 10 minutes);
        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.WeeklyBudgetExceeded.selector, 0.1 ether, 0.12 ether
            )
        );
        VM.prank(alice);
        account.executeApprovedAcquisition(
            nextDay, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.06 ether), ""
        );
    }

    function testDailyAcquisitionCountAppliesToFreeSplitting() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        BrokerPolicyModule.PolicyState memory stored = policy.policy(address(account));
        stored.config.maxAcquisitionsPerDay = 1;
        VM.prank(alice);
        policy.configurePolicy(address(account), stored.config);
        _list(1030);
        _list(1031);

        GoghBrokerTypes.AcquisitionIntent memory firstFree = _intent(1030, 0);
        VM.prank(alice);
        account.executeApprovedAcquisition(
            firstFree, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0), ""
        );
        GoghBrokerTypes.AcquisitionIntent memory secondFree = _intent(1031, 0);
        VM.expectRevert(
            abi.encodeWithSelector(BrokerPolicyModule.DailyAcquisitionLimitExceeded.selector, 1)
        );
        VM.prank(alice);
        account.executeApprovedAcquisition(
            secondFree, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0), ""
        );
    }

    function testDailyAcquisitionCountCannotBeBypassedWithMultipleCurrencies() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        BrokerPolicyModule.PolicyState memory stored = policy.policy(address(account));
        stored.config.maxAcquisitionsPerDay = 1;
        VM.prank(alice);
        policy.configurePolicy(address(account), stored.config);

        VM.startPrank(alice);
        policy.setCurrencyPolicy(
            address(account),
            address(currency),
            BrokerPolicyModule.CurrencyPolicy(
                true, 100 ether, 200 ether, 500 ether, 50 ether, 100 ether
            )
        );
        policy.setVenueCurrencyMaximum(
            address(account), address(marketplace), address(currency), 100 ether
        );
        policy.setSelectorPermission(
            address(account), MockMarketplace.purchaseERC20.selector, true, false
        );
        VM.stopPrank();
        currency.mint(address(account), 100 ether);
        _list(1032);
        _list(1033);

        GoghBrokerTypes.AcquisitionIntent memory nativeIntent = _intent(1032, 0);
        VM.prank(alice);
        account.executeApprovedAcquisition(
            nativeIntent, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0), ""
        );

        GoghBrokerTypes.AcquisitionIntent memory erc20Intent = _intent(1033, 1 ether);
        erc20Intent.currency = address(currency);
        VM.expectRevert(
            abi.encodeWithSelector(BrokerPolicyModule.DailyAcquisitionLimitExceeded.selector, 1)
        );
        VM.prank(alice);
        account.executeApprovedAcquisition(
            erc20Intent, _adapterData(MockMarketplaceAdapter.Behavior.ERC20_PURCHASE, 1 ether), ""
        );
    }

    function testNewOwnerMustConfigureAndReauthorizeEveryPermission() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        BrokerPolicyModule.PolicyState memory alicePolicy = policy.policy(address(account));

        VM.prank(alice);
        MockCanonicalGoghPunks(GOGH_PUNKS).transferFrom(alice, bob, TOKEN_ID);

        VM.expectRevert(
            abi.encodeWithSelector(BrokerPolicyModule.PolicyOwnerChanged.selector, alice, bob)
        );
        VM.prank(bob);
        policy.setAdapterPermission(address(account), address(marketplaceAdapter), true);

        VM.expectRevert(
            abi.encodeWithSelector(BrokerPolicyModule.PolicyOwnerChanged.selector, alice, bob)
        );
        VM.prank(bob);
        policy.setAccountPaused(address(account), false);

        VM.prank(bob);
        policy.configurePolicy(address(account), alicePolicy.config);

        require(
            !policy.approvedAdapters(address(account), address(marketplaceAdapter)),
            "inherited adapter permission"
        );
        require(
            !policy.approvedMarketplaces(address(account), address(marketplace)),
            "inherited venue permission"
        );
        require(
            !policy.approvedCollections(address(account), address(art)),
            "inherited collection permission"
        );
        require(
            !policy.currencyPolicy(address(account), address(0)).allowed,
            "inherited currency permission"
        );
        require(
            policy.venueCurrencyMaximum(address(account), address(marketplace), address(0)) == 0,
            "inherited venue limit"
        );
    }

    function testDeniedSelectorOverridesAllowlist() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        VM.prank(alice);
        policy.setSelectorPermission(
            address(account), MockMarketplace.purchaseNative.selector, false, true
        );
        _list(1040);
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(1040, 0.01 ether);
        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.SelectorDenied.selector, MockMarketplace.purchaseNative.selector
            )
        );
        VM.prank(alice);
        account.executeApprovedAcquisition(
            intent, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.01 ether), ""
        );
    }

    function testExpiredAndSlippageViolatingIntentsRevert() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        _list(1050);
        GoghBrokerTypes.AcquisitionIntent memory expired = _intent(1050, 0.01 ether);
        expired.createdAt = uint64(block.timestamp - 20 minutes);
        expired.expiresAt = uint64(block.timestamp - 10 minutes);
        VM.expectRevert(BrokerPolicyModule.IntentExpired.selector);
        VM.prank(alice);
        account.executeApprovedAcquisition(
            expired, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.01 ether), ""
        );

        GoghBrokerTypes.AcquisitionIntent memory slipped = _intent(1050, 0.05 ether);
        slipped.maxPrice = 0.06 ether;
        slipped.maxSlippageBps = 500;
        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.SlippageExceeded.selector, 0.0525 ether, 0.06 ether
            )
        );
        VM.prank(alice);
        account.executeApprovedAcquisition(
            slipped, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.06 ether), ""
        );
    }

    function testMaliciousVenueCannotTakePaymentWithoutDeliveringNFT() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        VM.prank(alice);
        policy.setSelectorPermission(
            address(account), MockMarketplace.takePaymentWithoutDelivery.selector, true, false
        );
        uint256 balanceBefore = address(account).balance;
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(1060, 0.03 ether);
        VM.expectRevert();
        VM.prank(alice);
        account.executeApprovedAcquisition(
            intent, _adapterData(MockMarketplaceAdapter.Behavior.NO_DELIVERY, 0.03 ether), ""
        );
        require(address(account).balance == balanceBefore, "payment escaped");
        require(account.acquisitionNonce() == 0, "nonce consumed");
        require(policy.usage(address(account), address(0)).spentToday == 0, "budget consumed");
    }

    function testERC20PurchaseUsesExactAllowanceAndRevokesIt() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        VM.startPrank(alice);
        policy.setCurrencyPolicy(
            address(account),
            address(currency),
            BrokerPolicyModule.CurrencyPolicy({
                allowed: true,
                maxSpendPerTransaction: 100 ether,
                maxSpendPerDay: 200 ether,
                maxSpendPerWeek: 500 ether,
                maxMintPrice: 50 ether,
                maxSecondaryPurchasePrice: 100 ether
            })
        );
        policy.setVenueCurrencyMaximum(
            address(account), address(marketplace), address(currency), 100 ether
        );
        policy.setSelectorPermission(
            address(account), MockMarketplace.purchaseERC20.selector, true, false
        );
        VM.stopPrank();
        currency.mint(address(account), 100 ether);
        _list(1070);
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(1070, 25 ether);
        intent.currency = address(currency);
        intent.policyVersion = policy.policyVersion(address(account));
        bytes memory data = _adapterData(MockMarketplaceAdapter.Behavior.ERC20_PURCHASE, 25 ether);

        VM.prank(alice);
        account.executeApprovedAcquisition(intent, data, "");
        require(currency.balanceOf(address(marketplace)) == 25 ether, "payment missing");
        require(
            currency.allowance(address(account), address(marketplace)) == 0, "allowance remains"
        );
        require(art.ownerOf(1070) == address(account), "NFT missing");
    }

    function testUnlimitedApprovalAttemptIsRejectedBeforeExternalCall() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        VM.startPrank(alice);
        policy.setCurrencyPolicy(
            address(account),
            address(currency),
            BrokerPolicyModule.CurrencyPolicy(
                true, 100 ether, 200 ether, 500 ether, 50 ether, 100 ether
            )
        );
        policy.setVenueCurrencyMaximum(
            address(account), address(marketplace), address(currency), 100 ether
        );
        policy.setSelectorPermission(
            address(account), MockMarketplace.purchaseERC20.selector, true, false
        );
        VM.stopPrank();
        currency.mint(address(account), 100 ether);
        _list(1071);
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(1071, 25 ether);
        intent.currency = address(currency);
        intent.policyVersion = policy.policyVersion(address(account));
        bytes memory maliciousData = abi.encode(
            MockMarketplaceAdapter.Behavior.ERC20_PURCHASE, 25 ether, type(uint256).max
        );
        VM.expectRevert(BrokerPolicyModule.ExecutionMismatch.selector);
        VM.prank(alice);
        account.executeApprovedAcquisition(intent, maliciousData, "");
        require(currency.allowance(address(account), address(marketplace)) == 0, "approval leaked");
    }

    function testGlobalPolicyPauseBlocksBrokerButNotOwnerRecovery() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        _list(1080);
        VM.prank(guardian);
        policy.setGloballyPaused(true);
        GoghBrokerTypes.AcquisitionIntent memory pausedIntent = _intent(1080, 0.01 ether);
        VM.expectRevert(BrokerPolicyModule.GlobalPauseActive.selector);
        VM.prank(alice);
        account.executeApprovedAcquisition(
            pausedIntent,
            _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.01 ether),
            ""
        );

        VM.prank(alice);
        account.execute(recipient, 0.01 ether, "", 0);
    }
}
