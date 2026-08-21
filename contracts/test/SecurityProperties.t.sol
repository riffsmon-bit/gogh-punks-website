// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { BrokerPolicyModule } from "../src/BrokerPolicyModule.sol";
import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import { GoghPunkAccountV1 } from "../src/GoghPunkAccountV1.sol";
import { ArtBrokerTestBase } from "./ArtBrokerTestBase.sol";
import {
    MockCanonicalGoghPunks,
    MockLyingERC721,
    MockMarketplaceAdapter
} from "./mocks/TestInfrastructure.sol";

contract SecurityPropertiesTest is ArtBrokerTestBase {
    function testFuzzOldOwnerCannotMoveAssetsAfterTransfer(uint96 attemptedValue) public {
        uint256 value = uint256(attemptedValue) % 0.5 ether;
        VM.prank(alice);
        MockCanonicalGoghPunks(GOGH_PUNKS).transferFrom(alice, bob, TOKEN_ID);
        uint256 accountBalance = address(account).balance;
        VM.expectRevert(
            abi.encodeWithSelector(GoghPunkAccountV1.NotAuthorized.selector, alice, bob)
        );
        VM.prank(alice);
        account.execute(alice, value, "", 0);
        require(address(account).balance == accountBalance, "old owner moved value");
    }

    function testFuzzProtocolGuardianCannotWithdraw(uint96 attemptedValue) public {
        uint256 value = uint256(attemptedValue) % 0.5 ether;
        uint256 beforeBalance = address(account).balance;
        VM.expectRevert(
            abi.encodeWithSelector(GoghPunkAccountV1.NotAuthorized.selector, guardian, alice)
        );
        VM.prank(guardian);
        account.execute(guardian, value, "", 0);
        require(address(account).balance == beforeBalance, "guardian withdrew");
    }

    function testFuzzAgentSpendIsBounded(uint96 excess) public {
        _setFeatures(true, true, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.AUTONOMOUS);
        _authorizeAgent();
        uint256 price = 0.1 ether + (uint256(excess) % 0.4 ether) + 1;
        _list(3001);
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(3001, price);
        intent.maxPrice = price;
        uint256 beforeBalance = address(account).balance;
        VM.expectRevert();
        VM.prank(agent);
        account.executeAutonomousAcquisition(
            intent, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, price)
        );
        require(address(account).balance == beforeBalance, "over-limit spend escaped");
    }

    function testReplayAndNonceSkippingAreRejected() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        _list(3010);
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(3010, 0.01 ether);
        bytes memory data =
            _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.01 ether);
        VM.prank(alice);
        account.executeApprovedAcquisition(intent, data, "");

        VM.expectRevert(abi.encodeWithSelector(GoghPunkAccountV1.InvalidIntentNonce.selector, 1, 0));
        VM.prank(alice);
        account.executeApprovedAcquisition(intent, data, "");

        GoghBrokerTypes.AcquisitionIntent memory skipped = _intent(3011, 0.01 ether);
        skipped.nonce = 3;
        VM.expectRevert(abi.encodeWithSelector(GoghPunkAccountV1.InvalidIntentNonce.selector, 1, 3));
        VM.prank(alice);
        account.executeApprovedAcquisition(skipped, data, "");
    }

    function testPolicyChangeInvalidatesPendingIntent() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        GoghBrokerTypes.AcquisitionIntent memory stale = _intent(3020, 0.01 ether);
        VM.prank(alice);
        policy.setAccountPaused(address(account), true);
        VM.expectRevert(GoghPunkAccountV1.InvalidIntent.selector);
        VM.prank(alice);
        account.executeApprovedAcquisition(
            stale, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.01 ether), ""
        );
    }

    function testAcquisitionRequiresNonzeroOpportunityAndReasoningProvenance() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(3021, 0.01 ether);
        bytes memory data =
            _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.01 ether);

        intent.opportunityId = bytes32(0);
        VM.expectRevert(GoghPunkAccountV1.InvalidIntent.selector);
        VM.prank(alice);
        account.executeApprovedAcquisition(intent, data, "");

        intent = _intent(3021, 0.01 ether);
        intent.reasoningHash = bytes32(0);
        VM.expectRevert(GoghPunkAccountV1.InvalidIntent.selector);
        VM.prank(alice);
        account.executeApprovedAcquisition(intent, data, "");
    }

    function testUnknownCollectionAutonomyStartsDisabled() public {
        _setFeatures(true, true, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.AUTONOMOUS);
        _authorizeAgent();
        MockMarketplaceAdapter unregistered = new MockMarketplaceAdapter(
            address(marketplace), GoghBrokerTypes.AdapterKind.MARKETPLACE
        );
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(3030, 0.01 ether);
        intent.adapter = address(unregistered);
        intent.adapterCodeHash = address(unregistered).codehash;
        VM.expectRevert(GoghPunkAccountV1.AdapterExecutionInvalid.selector);
        VM.prank(agent);
        account.executeAutonomousAcquisition(
            intent, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.01 ether)
        );
    }

    function testMaliciousNFTContractCannotReachAnAutonomousVenueWithoutOwnerAllowlist() public {
        _setFeatures(true, true, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.AUTONOMOUS);
        _authorizeAgent();
        MockLyingERC721 maliciousCollection = new MockLyingERC721();
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(3031, 0.01 ether);
        intent.collection = address(maliciousCollection);
        uint256 beforeBalance = address(account).balance;

        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.CollectionNotAllowed.selector, address(maliciousCollection)
            )
        );
        VM.prank(agent);
        account.executeAutonomousAcquisition(
            intent, _adapterData(MockMarketplaceAdapter.Behavior.NATIVE_PURCHASE, 0.01 ether)
        );

        require(address(account).balance == beforeBalance, "malicious NFT caused spend");
        require(account.acquisitionNonce() == 0, "malicious NFT consumed nonce");
    }

    function testAccountPauseDoesNotBlockOwnerEmergencyPath() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        VM.prank(alice);
        policy.setAccountPaused(address(account), true);
        uint256 before = recipient.balance;
        VM.prank(alice);
        account.execute(recipient, 0.01 ether, "", 0);
        require(recipient.balance == before + 0.01 ether, "owner emergency path blocked");
    }

    function testDelegatecallCreateAndCreate2HaveNoAgentOrOwnerOpcodePath() public {
        for (uint8 operation = 1; operation < 4; ++operation) {
            VM.expectRevert(
                abi.encodeWithSelector(GoghPunkAccountV1.UnsupportedOperation.selector, operation)
            );
            VM.prank(alice);
            account.execute(recipient, 0, "", operation);
        }
    }

    function testFuzzCounterfactualAddressIsStable(uint256 tokenId) public view {
        address first = accountRegistry.account(tokenId);
        address second = accountRegistry.account(tokenId);
        require(first == second, "counterfactual address changed");
    }
}
