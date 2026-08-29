// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { BrokerPolicyModule } from "../src/BrokerPolicyModule.sol";
import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import {
    AutomatedSeaDropStudioPaidMintAdapter
} from "../src/adapters/AutomatedSeaDropStudioPaidMintAdapter.sol";
import { IOpenSeaSeaDrop } from "../src/adapters/OpenSeaSeaDropFreeMintAdapter.sol";
import { ArtBrokerTestBase } from "./ArtBrokerTestBase.sol";

contract PaidSeaDropMock {
    uint80 private _price;
    uint48 private _startTime;
    uint48 private _endTime;
    uint16 private _walletLimit;

    function configure(uint80 price, uint48 startTime, uint48 endTime, uint16 walletLimit)
        external
    {
        _price = price;
        _startTime = startTime;
        _endTime = endTime;
        _walletLimit = walletLimit;
    }

    function getPublicDrop(address) external view returns (IOpenSeaSeaDrop.PublicDrop memory drop) {
        drop = IOpenSeaSeaDrop.PublicDrop({
            mintPrice: _price,
            startTime: _startTime,
            endTime: _endTime,
            maxTotalMintableByWallet: _walletLimit,
            feeBps: 0,
            restrictFeeRecipients: false
        });
    }

    function getFeeRecipientIsAllowed(address, address) external pure returns (bool) {
        return false;
    }

    function mintPublic(address collection, address, address minterIfNotPayer, uint256 quantity)
        external
        payable
    {
        require(msg.value == _price, "wrong payment");
        address minter = minterIfNotPayer == address(0) ? msg.sender : minterIfNotPayer;
        PaidStudioCollection(collection).mintSeaDrop(minter, quantity);
    }
}

contract PaidStudioCollection {
    address private constant SEA_DROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;

    uint256 private _minted;
    mapping(address minter => uint256 count) private _mintedByWallet;
    mapping(uint256 tokenId => address tokenOwner) private _owners;

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x80ac58cd;
    }

    function getMintStats(address minter)
        external
        view
        returns (uint256 minterNumMinted, uint256 currentTotalMinted, uint256 maxSupply)
    {
        return (_mintedByWallet[minter], _minted, 100);
    }

    function mintSeaDrop(address minter, uint256 quantity) external {
        require(msg.sender == SEA_DROP, "only SeaDrop");
        require(quantity == 1, "quantity");
        uint256 tokenId = _minted + 1;
        _minted = tokenId;
        _mintedByWallet[minter] += 1;
        _owners[tokenId] = minter;
    }

    function ownerOf(uint256 tokenId) external view returns (address tokenOwner) {
        tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "missing token");
    }
}

contract PaidCloneImplementationMarker { }

contract AutomatedSeaDropPaidTest is ArtBrokerTestBase {
    address private constant SEA_DROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;
    address private constant CLONE_IMPLEMENTATION = 0x09a26fC8FCEF18192E267D7A6da9dFb4be81Dd6A;
    address private constant STUDIO_COLLECTION = 0x2222222222222222222222222222222222222222;
    uint256 private constant PRICE = 0.004 ether;

    AutomatedSeaDropStudioPaidMintAdapter private paidAdapter;

    function setUp() public override {
        super.setUp();
        PaidSeaDropMock seaDropTemplate = new PaidSeaDropMock();
        VM.etch(SEA_DROP, address(seaDropTemplate).code);
        PaidCloneImplementationMarker cloneTemplate = new PaidCloneImplementationMarker();
        VM.etch(CLONE_IMPLEMENTATION, address(cloneTemplate).code);
        PaidStudioCollection collectionTemplate = new PaidStudioCollection();
        VM.etch(STUDIO_COLLECTION, address(collectionTemplate).code);
        PaidSeaDropMock(SEA_DROP)
            .configure(
                uint80(PRICE), uint48(block.timestamp - 1), uint48(block.timestamp + 1 days), 10
            );

        paidAdapter = new AutomatedSeaDropStudioPaidMintAdapter(
            SEA_DROP.codehash, CLONE_IMPLEMENTATION.codehash, STUDIO_COLLECTION.codehash
        );
        VM.prank(guardian);
        adapters.registerAdapter(
            address(paidAdapter),
            GoghBrokerTypes.AdapterKind.MINT,
            SEA_DROP,
            keccak256("exact-price-paid-seadrop-v1"),
            keccak256("native-only-no-approval-no-slippage")
        );
        _setFeatures(false, true, true);
        _configurePaidPolicy(0.02 ether, 0.05 ether, 0.2 ether, 0.01 ether, 0.2 ether, 3);
        _authorizeAgent();
    }

    function testExactPriceAutonomousPaidMintConsumesPolicyAndDeliversNft() public {
        uint256 beforeBalance = address(account).balance;
        GoghBrokerTypes.AcquisitionIntent memory intent = _intentFor(1, PRICE);
        VM.prank(agent);
        account.executeAutonomousAcquisition(intent, "");

        require(PaidStudioCollection(STUDIO_COLLECTION).ownerOf(1) == address(account), "owner");
        require(address(account).balance == beforeBalance - PRICE, "exact spend");
        BrokerPolicyModule.Usage memory current = policy.usage(address(account), address(0));
        require(current.spentToday == PRICE, "daily spend");
        require(current.spentThisWeek == PRICE, "weekly spend");
        require(policy.acquisitionUsage(address(account)).acquisitionsToday == 1, "daily count");
    }

    function testExecutionHasExactTargetValueCalldataAndNoApproval() public view {
        GoghBrokerTypes.AdapterExecution memory execution =
            paidAdapter.buildExecution(_intentFor(1, PRICE), "");
        require(execution.target == SEA_DROP, "target");
        require(execution.value == PRICE && execution.paymentAmount == PRICE, "payment");
        require(execution.currency == address(0), "currency");
        require(
            execution.allowanceSpender == address(0) && execution.allowanceAmount == 0, "approval"
        );
        require(
            keccak256(execution.callData)
                == keccak256(
                    abi.encodeCall(
                        IOpenSeaSeaDrop.mintPublic,
                        (
                            STUDIO_COLLECTION,
                            paidAdapter.OPEN_SEA_FEE_RECIPIENT(),
                            address(0),
                            uint256(1)
                        )
                    )
                ),
            "calldata"
        );
    }

    function testPaidMintPermissionDefaultsFailClosed() public {
        VM.prank(alice);
        policy.setMintControls(
            address(account),
            BrokerPolicyModule.MintControls({
                ownerApprovedMints: false, autonomousFreeMints: true, autonomousPaidMints: false
            })
        );
        GoghBrokerTypes.AcquisitionIntent memory blocked = _intentFor(1, PRICE);
        VM.expectRevert(BrokerPolicyModule.AutonomousPaidMintsDisabled.selector);
        VM.prank(agent);
        account.executeAutonomousAcquisition(blocked, "");
    }

    function testPriceChangeRequiresACompletelyNewIntent() public {
        GoghBrokerTypes.AcquisitionIntent memory stale = _intentFor(1, PRICE);
        PaidSeaDropMock(SEA_DROP)
            .configure(
                uint80(PRICE + 1), uint48(block.timestamp - 1), uint48(block.timestamp + 1 days), 10
            );
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedSeaDropStudioPaidMintAdapter.PublicDropPriceChanged.selector,
                PRICE,
                PRICE + 1
            )
        );
        paidAdapter.buildExecution(stale, "");
    }

    function testZeroPriceAndOpaqueDataAreRejected() public {
        GoghBrokerTypes.AcquisitionIntent memory free = _intentFor(1, 0);
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedSeaDropStudioPaidMintAdapter.InvalidIntentPrice.selector, 0, 0
            )
        );
        paidAdapter.buildExecution(free, "");

        GoghBrokerTypes.AcquisitionIntent memory opaque = _intentFor(1, PRICE);
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedSeaDropStudioPaidMintAdapter.UnsupportedAdapterData.selector, 1
            )
        );
        paidAdapter.buildExecution(opaque, hex"01");
    }

    function testDailySpendAndNativeReserveRemainHardOnChainLimits() public {
        _configurePaidPolicy(PRICE, PRICE, 0.02 ether, PRICE, 0.2 ether, 3);
        GoghBrokerTypes.AcquisitionIntent memory first = _intentFor(1, PRICE);
        VM.prank(agent);
        account.executeAutonomousAcquisition(first, "");

        GoghBrokerTypes.AcquisitionIntent memory dailyBlocked = _intentFor(2, PRICE);
        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.DailyBudgetExceeded.selector, PRICE, PRICE * 2
            )
        );
        VM.prank(agent);
        account.executeAutonomousAcquisition(dailyBlocked, "");

        VM.warp(block.timestamp + 1 days);
        _configurePaidPolicy(PRICE, PRICE, 0.02 ether, PRICE, address(account).balance, 3);
        GoghBrokerTypes.AcquisitionIntent memory reserveBlocked = _intentFor(2, PRICE);
        VM.expectRevert(
            abi.encodeWithSelector(
                BrokerPolicyModule.MinimumReserveViolated.selector,
                address(account).balance,
                address(account).balance - PRICE
            )
        );
        VM.prank(agent);
        account.executeAutonomousAcquisition(reserveBlocked, "");
    }

    function testOnlyReviewedRuntimeAndExactNextTokenIdAreAccepted() public {
        address unknown = address(0x3333);
        VM.etch(unknown, hex"60006000f3");
        GoghBrokerTypes.AcquisitionIntent memory unreviewed = _intentFor(1, PRICE);
        unreviewed.collection = unknown;
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedSeaDropStudioPaidMintAdapter.UnreviewedCollectionRuntime.selector,
                unknown,
                unknown.codehash
            )
        );
        paidAdapter.buildExecution(unreviewed, "");

        GoghBrokerTypes.AcquisitionIntent memory wrongToken = _intentFor(2, PRICE);
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedSeaDropStudioPaidMintAdapter.WrongNextTokenId.selector, 2, 1
            )
        );
        paidAdapter.buildExecution(wrongToken, "");
    }

    function _configurePaidPolicy(
        uint256 perTransaction,
        uint256 perDay,
        uint256 perWeek,
        uint256 maxMint,
        uint256 reserve,
        uint32 dailyCount
    ) private {
        VM.startPrank(alice);
        policy.configurePolicy(
            address(account),
            GoghBrokerTypes.PolicyConfig({
                mode: GoghBrokerTypes.BrokerMode.AUTONOMOUS,
                maxSpendPerTransaction: perTransaction,
                maxSpendPerDay: perDay,
                maxSpendPerWeek: perWeek,
                maxMintPrice: maxMint,
                maxSecondaryPurchasePrice: 0,
                minimumNativeReserve: reserve,
                maxAcquisitionsPerDay: dailyCount,
                maxIntentAge: 120,
                maxSlippageBps: 0,
                requireCollectionAllowlist: true,
                allowUnknownCollections: false
            })
        );
        policy.setAdapterPermission(address(account), address(paidAdapter), true);
        policy.setVenuePermission(
            address(account), SEA_DROP, GoghBrokerTypes.AdapterKind.MINT, true
        );
        policy.setCollectionPermission(address(account), STUDIO_COLLECTION, true, false);
        policy.setCurrencyPolicy(
            address(account),
            address(0),
            BrokerPolicyModule.CurrencyPolicy({
                allowed: true,
                maxSpendPerTransaction: perTransaction,
                maxSpendPerDay: perDay,
                maxSpendPerWeek: perWeek,
                maxMintPrice: maxMint,
                maxSecondaryPurchasePrice: 0
            })
        );
        policy.setVenueCurrencyMaximum(address(account), SEA_DROP, address(0), maxMint);
        policy.setSelectorPermission(
            address(account), IOpenSeaSeaDrop.mintPublic.selector, true, false
        );
        policy.setMintControls(
            address(account),
            BrokerPolicyModule.MintControls({
                ownerApprovedMints: false, autonomousFreeMints: false, autonomousPaidMints: true
            })
        );
        VM.stopPrank();
    }

    function _intentFor(uint256 tokenId, uint256 price)
        private
        view
        returns (GoghBrokerTypes.AcquisitionIntent memory intent)
    {
        intent = GoghBrokerTypes.AcquisitionIntent({
            account: address(account),
            chainId: 4663,
            expectedOwner: alice,
            nonce: account.acquisitionNonce(),
            policyVersion: policy.policyVersion(address(account)),
            opportunityType: GoghBrokerTypes.OpportunityType.MINT,
            assetStandard: GoghBrokerTypes.AssetStandard.ERC721,
            adapter: address(paidAdapter),
            venue: SEA_DROP,
            collection: STUDIO_COLLECTION,
            tokenId: tokenId,
            assetAmount: 1,
            currency: address(0),
            expectedPrice: price,
            maxPrice: price,
            maxSlippageBps: 0,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 120),
            opportunityId: keccak256(
                abi.encode("paid-seadrop", tokenId, account.acquisitionNonce())
            ),
            reasoningHash: keccak256("reviewed-exact-price-paid-seadrop"),
            adapterCodeHash: address(paidAdapter).codehash
        });
    }
}
