// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { BrokerPolicyModule } from "../src/BrokerPolicyModule.sol";
import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import { ArtBrokerTestBase } from "./ArtBrokerTestBase.sol";
import {
    MockCanonicalGoghPunks,
    MockERC721,
    MockMarketplace,
    MockMarketplaceAdapter
} from "./mocks/TestInfrastructure.sol";

contract MintControlsTest is ArtBrokerTestBase {
    MockMarketplaceAdapter private mintAdapter;

    function setUp() public override {
        super.setUp();
        mintAdapter =
            new MockMarketplaceAdapter(address(marketplace), GoghBrokerTypes.AdapterKind.MINT);
        VM.prank(guardian);
        adapters.registerAdapter(
            address(mintAdapter),
            GoghBrokerTypes.AdapterKind.MINT,
            address(marketplace),
            keccak256("mock-mint-v1"),
            keccak256("test-only")
        );
    }

    function testOwnerApprovedMintDefaultsOffAndMustBeExplicitlyEnabled() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        _permitMint(address(art), true);

        BrokerPolicyModule.MintControls memory defaults = policy.mintControls(address(account));
        require(!defaults.ownerApprovedMints, "owner mint default on");
        require(!defaults.autonomousFreeMints, "free autonomy default on");
        require(!defaults.autonomousPaidMints, "paid autonomy default on");

        GoghBrokerTypes.AcquisitionIntent memory blocked =
            _mintIntent(address(art), 5001, 0.01 ether, GoghBrokerTypes.OpportunityType.MINT);
        VM.expectRevert(BrokerPolicyModule.OwnerApprovedMintsDisabled.selector);
        VM.prank(alice);
        account.executeApprovedAcquisition(blocked, _mintData(0.01 ether), "");

        _setMintControls(true, false, false);
        GoghBrokerTypes.AcquisitionIntent memory allowed =
            _mintIntent(address(art), 5001, 0.01 ether, GoghBrokerTypes.OpportunityType.MINT);
        VM.prank(alice);
        account.executeApprovedAcquisition(allowed, _mintData(0.01 ether), "");
        require(art.ownerOf(5001) == address(account), "approved mint not delivered");
    }

    function testFreeMintLabelRequiresZeroExpectedMaximumAndActualPayment() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        _permitMint(address(art), true);
        _setMintControls(true, false, false);

        GoghBrokerTypes.AcquisitionIntent memory paidFreeLabel =
            _mintIntent(address(art), 5010, 0, GoghBrokerTypes.OpportunityType.FREE_MINT);
        paidFreeLabel.maxPrice = 0.01 ether;
        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.FreeMintPaymentNotZero.selector, 0, 0.01 ether, 0.01 ether
            )
        );
        VM.prank(alice);
        account.executeApprovedAcquisition(paidFreeLabel, _mintData(0.01 ether), "");

        GoghBrokerTypes.AcquisitionIntent memory actuallyFree =
            _mintIntent(address(art), 5011, 0, GoghBrokerTypes.OpportunityType.FREE_MINT);
        VM.prank(alice);
        account.executeApprovedAcquisition(actuallyFree, _mintData(0), "");
        require(art.ownerOf(5011) == address(account), "free mint not delivered");
    }

    function testAutonomousFreeAndPaidControlsUseActualPaymentIndependently() public {
        _setFeatures(false, true, true);
        _configurePolicy(GoghBrokerTypes.BrokerMode.AUTONOMOUS);
        _permitMint(address(art), true);
        _authorizeAgent();
        _setMintControls(false, true, false);

        GoghBrokerTypes.AcquisitionIntent memory freeMint =
            _mintIntent(address(art), 5020, 0, GoghBrokerTypes.OpportunityType.FREE_MINT);
        VM.prank(agent);
        account.executeAutonomousAcquisition(freeMint, _mintData(0));

        GoghBrokerTypes.AcquisitionIntent memory paidBlocked =
            _mintIntent(address(art), 5021, 0.01 ether, GoghBrokerTypes.OpportunityType.MINT);
        VM.expectRevert(BrokerPolicyModule.AutonomousPaidMintsDisabled.selector);
        VM.prank(agent);
        account.executeAutonomousAcquisition(paidBlocked, _mintData(0.01 ether));

        _setMintControls(false, false, true);
        GoghBrokerTypes.AcquisitionIntent memory zeroPriceWithPaidLabel =
            _mintIntent(address(art), 5022, 0, GoghBrokerTypes.OpportunityType.MINT);
        VM.expectRevert(BrokerPolicyModule.AutonomousFreeMintsDisabled.selector);
        VM.prank(agent);
        account.executeAutonomousAcquisition(zeroPriceWithPaidLabel, _mintData(0));

        GoghBrokerTypes.AcquisitionIntent memory paidAllowed =
            _mintIntent(address(art), 5023, 0.01 ether, GoghBrokerTypes.OpportunityType.MINT);
        VM.prank(agent);
        account.executeAutonomousAcquisition(paidAllowed, _mintData(0.01 ether));
        require(art.ownerOf(5020) == address(account), "free autonomy failed");
        require(art.ownerOf(5023) == address(account), "paid autonomy failed");
    }

    function testFreeMintCannotSpendWhenBothAutonomousMintTypesAreEnabled() public {
        _setFeatures(false, true, true);
        _configurePolicy(GoghBrokerTypes.BrokerMode.AUTONOMOUS);
        _permitMint(address(art), true);
        _authorizeAgent();
        _setMintControls(false, true, true);

        GoghBrokerTypes.AcquisitionIntent memory mislabeled =
            _mintIntent(address(art), 5030, 0, GoghBrokerTypes.OpportunityType.FREE_MINT);
        mislabeled.maxPrice = 0.01 ether;
        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.FreeMintPaymentNotZero.selector, 0, 0.01 ether, 0.01 ether
            )
        );
        VM.prank(agent);
        account.executeAutonomousAcquisition(mislabeled, _mintData(0.01 ether));
    }

    function testEveryTypedMintRequiresExplicitCollectionAllowlist() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);
        _permitMint(address(art), false);
        _setMintControls(true, false, false);

        BrokerPolicyModule.PolicyState memory stored = policy.policy(address(account));
        stored.config.requireCollectionAllowlist = false;
        stored.config.allowUnknownCollections = true;
        VM.prank(alice);
        policy.configurePolicy(address(account), stored.config);

        MockERC721 unknownCollection = new MockERC721();
        GoghBrokerTypes.AcquisitionIntent memory unknown = _mintIntent(
            address(unknownCollection), 5040, 0, GoghBrokerTypes.OpportunityType.FREE_MINT
        );
        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.CollectionNotAllowed.selector, address(unknownCollection)
            )
        );
        VM.prank(alice);
        account.executeApprovedAcquisition(unknown, _mintData(0), "");

        VM.prank(alice);
        policy.setCollectionPermission(address(account), address(unknownCollection), true, false);
        GoghBrokerTypes.AcquisitionIntent memory explicitlyAllowed = _mintIntent(
            address(unknownCollection), 5040, 0, GoghBrokerTypes.OpportunityType.FREE_MINT
        );
        VM.prank(alice);
        account.executeApprovedAcquisition(explicitlyAllowed, _mintData(0), "");
        require(
            unknownCollection.ownerOf(5040) == address(account),
            "explicitly allowed mint not delivered"
        );
    }

    function testAutonomousMintCannotUseBroadUnknownCollectionPermission() public {
        _setFeatures(false, true, true);
        _configurePolicy(GoghBrokerTypes.BrokerMode.AUTONOMOUS);
        _permitMint(address(art), false);
        _authorizeAgent();
        _setMintControls(false, true, false);

        BrokerPolicyModule.PolicyState memory stored = policy.policy(address(account));
        stored.config.requireCollectionAllowlist = false;
        stored.config.allowUnknownCollections = true;
        VM.prank(alice);
        policy.configurePolicy(address(account), stored.config);

        MockERC721 unknownCollection = new MockERC721();
        GoghBrokerTypes.AcquisitionIntent memory unknown = _mintIntent(
            address(unknownCollection), 5041, 0, GoghBrokerTypes.OpportunityType.FREE_MINT
        );
        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.CollectionNotAllowed.selector, address(unknownCollection)
            )
        );
        VM.prank(agent);
        account.executeAutonomousAcquisition(unknown, _mintData(0));
    }

    function testAutonomousMintAmountIsExactlyOneInV1() public {
        _setFeatures(false, true, true);
        _configurePolicy(GoghBrokerTypes.BrokerMode.AUTONOMOUS);
        _permitMint(address(editions), true);
        _authorizeAgent();
        _setMintControls(false, true, false);

        GoghBrokerTypes.AcquisitionIntent memory batch =
            _mintIntent(address(editions), 5050, 0, GoghBrokerTypes.OpportunityType.EDITION);
        batch.assetStandard = GoghBrokerTypes.AssetStandard.ERC1155;
        batch.assetAmount = 2;
        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.AutonomousMintAssetAmountInvalid.selector, uint256(2)
            )
        );
        VM.prank(agent);
        account.executeAutonomousAcquisition(batch, _mintData(0));
    }

    function testOnlyCurrentOwnerCanSetMintControlsAndTransferInvalidatesThem() public {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);

        BrokerPolicyModule.MintControls memory enabled = BrokerPolicyModule.MintControls({
            ownerApprovedMints: true, autonomousFreeMints: false, autonomousPaidMints: false
        });
        VM.expectRevert(
            abi.encodeWithSelector(BrokerPolicyModule.NotCurrentPunkOwner.selector, bob, alice)
        );
        VM.prank(bob);
        policy.setMintControls(address(account), enabled);

        VM.prank(alice);
        policy.setMintControls(address(account), enabled);
        require(policy.mintControls(address(account)).ownerApprovedMints, "mint control not stored");

        VM.prank(alice);
        MockCanonicalGoghPunks(GOGH_PUNKS).transferFrom(alice, bob, TOKEN_ID);
        BrokerPolicyModule.MintControls memory transferred = policy.mintControls(address(account));
        require(!transferred.ownerApprovedMints, "old owner mint control survived");
        require(!transferred.autonomousFreeMints, "old free control survived");
        require(!transferred.autonomousPaidMints, "old paid control survived");
    }

    function _permitMint(address collection, bool allowCollection) private {
        VM.startPrank(alice);
        policy.setAdapterPermission(address(account), address(mintAdapter), true);
        policy.setVenuePermission(
            address(account), address(marketplace), GoghBrokerTypes.AdapterKind.MINT, true
        );
        if (allowCollection) {
            policy.setCollectionPermission(address(account), collection, true, false);
        }
        policy.setSelectorPermission(
            address(account), MockMarketplace.mintERC721.selector, true, false
        );
        VM.stopPrank();
    }

    function _setMintControls(bool ownerApproved, bool autonomousFree, bool autonomousPaid)
        private
    {
        VM.prank(alice);
        policy.setMintControls(
            address(account),
            BrokerPolicyModule.MintControls({
                ownerApprovedMints: ownerApproved,
                autonomousFreeMints: autonomousFree,
                autonomousPaidMints: autonomousPaid
            })
        );
    }

    function _mintIntent(
        address collection,
        uint256 tokenId,
        uint256 price,
        GoghBrokerTypes.OpportunityType opportunityType
    ) private view returns (GoghBrokerTypes.AcquisitionIntent memory intent) {
        intent = _intent(tokenId, price);
        intent.opportunityType = opportunityType;
        intent.adapter = address(mintAdapter);
        intent.collection = collection;
        intent.adapterCodeHash = address(mintAdapter).codehash;
        intent.policyVersion = policy.policyVersion(address(account));
    }

    function _mintData(uint256 price) private pure returns (bytes memory) {
        return _adapterData(MockMarketplaceAdapter.Behavior.MINT_ERC721, price);
    }
}
