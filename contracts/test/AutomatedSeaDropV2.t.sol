// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ArtAdapterRegistry } from "../src/ArtAdapterRegistry.sol";
import { ArtAgentRegistry } from "../src/ArtAgentRegistry.sol";
import { BrokerPolicyModule } from "../src/BrokerPolicyModule.sol";
import { BrokerPolicyModuleV2 } from "../src/BrokerPolicyModuleV2.sol";
import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import { GoghPunkAccountV1 } from "../src/GoghPunkAccountV1.sol";
import { GoghPunkAccountV2 } from "../src/GoghPunkAccountV2.sol";
import { GoghPunkAccountRegistryV2 } from "../src/GoghPunkAccountRegistryV2.sol";
import {
    AutomatedSeaDropFreeMintAdapter
} from "../src/adapters/AutomatedSeaDropFreeMintAdapter.sol";
import { IOpenSeaSeaDrop } from "../src/adapters/OpenSeaSeaDropFreeMintAdapter.sol";
import {
    ERC6551RegistryHarness,
    MockCanonicalGoghPunks,
    MockMarketplaceAdapter,
    TestVm
} from "./mocks/TestInfrastructure.sol";

contract V2MockSeaDrop {
    uint80 private immutable _price;

    constructor(uint80 price_) {
        _price = price_;
    }

    function getPublicDrop(address) external view returns (IOpenSeaSeaDrop.PublicDrop memory drop) {
        drop = IOpenSeaSeaDrop.PublicDrop({
            mintPrice: _price,
            startTime: 0,
            endTime: type(uint48).max,
            maxTotalMintableByWallet: 3,
            feeBps: 0,
            restrictFeeRecipients: false
        });
    }

    function getFeeRecipientIsAllowed(address, address) external pure returns (bool) {
        return false;
    }

    function mintPublic(address nftContract, address, address minterIfNotPayer, uint256 quantity)
        external
        payable
    {
        address minter = minterIfNotPayer == address(0) ? msg.sender : minterIfNotPayer;
        V2MockSeaDropCloneImplementation(nftContract).mintSeaDrop(minter, quantity);
    }
}

contract V2MockSeaDropCloneImplementation {
    address private constant SEA_DROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;

    uint256 private _minted;
    mapping(address minter => uint256 count) private _mintedByWallet;
    mapping(uint256 tokenId => address tokenOwner) private _owners;
    mapping(address tokenOwner => uint256 balance) private _balances;

    error OnlySeaDrop();
    error InvalidQuantity();
    error MissingToken();

    function getMintStats(address minter)
        external
        view
        returns (uint256 minterNumMinted, uint256 currentTotalMinted, uint256 maxSupply)
    {
        return (_mintedByWallet[minter], 41 + _minted, 100);
    }

    function mintSeaDrop(address minter, uint256 quantity) external {
        if (msg.sender != SEA_DROP) revert OnlySeaDrop();
        if (quantity != 1) revert InvalidQuantity();
        uint256 tokenId = 42 + _minted;
        _minted += 1;
        _mintedByWallet[minter] += 1;
        _owners[tokenId] = minter;
        _balances[minter] += 1;
    }

    function ownerOf(uint256 tokenId) external view returns (address tokenOwner) {
        tokenOwner = _owners[tokenId];
        if (tokenOwner == address(0)) revert MissingToken();
    }

    function balanceOf(address tokenOwner) external view returns (uint256) {
        return _balances[tokenOwner];
    }
}

contract AutomatedSeaDropV2Test {
    TestVm private constant VM = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant GOGH_PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address private constant ERC6551_REGISTRY = 0x000000006551c19487814612e58FE06813775758;
    address private constant SEA_DROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;
    address private constant CLONE_IMPLEMENTATION = 0x09a26fC8FCEF18192E267D7A6da9dFb4be81Dd6A;
    address private constant COLLECTION_ONE = 0x1111111111111111111111111111111111111111;
    address private constant COLLECTION_TWO = 0x2222222222222222222222222222222222222222;
    uint256 private constant PUNK_ID = 4242;
    uint256 private constant OWNER_KEY = 0xA11CE;
    address private constant AGENT = address(0xA63E17);

    address private owner;
    address private guardian = address(0x600D);
    ArtAdapterRegistry private adapters;
    ArtAgentRegistry private agents;
    AutomatedSeaDropFreeMintAdapter private automatedAdapter;
    BrokerPolicyModuleV2 private policy;
    GoghPunkAccountV2 private implementation;
    GoghPunkAccountRegistryV2 private registry;
    GoghPunkAccountV2 private account;

    function setUp() public {
        VM.chainId(4663);
        VM.warp(1_800_000_000);
        owner = VM.addr(OWNER_KEY);

        MockCanonicalGoghPunks collectionTemplate = new MockCanonicalGoghPunks();
        VM.etch(GOGH_PUNKS, address(collectionTemplate).code);
        ERC6551RegistryHarness registryTemplate = new ERC6551RegistryHarness();
        VM.etch(ERC6551_REGISTRY, address(registryTemplate).code);
        MockCanonicalGoghPunks(GOGH_PUNKS).mint(owner, PUNK_ID);

        V2MockSeaDrop seaDrop = new V2MockSeaDrop(0);
        VM.etch(SEA_DROP, address(seaDrop).code);
        V2MockSeaDropCloneImplementation clone = new V2MockSeaDropCloneImplementation();
        VM.etch(CLONE_IMPLEMENTATION, address(clone).code);
        VM.etch(COLLECTION_ONE, _cloneRuntime());
        VM.etch(COLLECTION_TWO, _cloneRuntime());

        adapters = new ArtAdapterRegistry(guardian);
        agents = new ArtAgentRegistry(guardian);
        automatedAdapter =
            new AutomatedSeaDropFreeMintAdapter(SEA_DROP.codehash, CLONE_IMPLEMENTATION.codehash);
        policy = new BrokerPolicyModuleV2(guardian, address(adapters), address(automatedAdapter));
        implementation = new GoghPunkAccountV2(address(policy), address(agents), address(adapters));
        registry = new GoghPunkAccountRegistryV2(address(implementation), bytes32(0));
        VM.prank(owner);
        account = GoghPunkAccountV2(payable(registry.createAccount(PUNK_ID)));

        VM.prank(guardian);
        adapters.registerAdapter(
            address(automatedAdapter),
            GoghBrokerTypes.AdapterKind.MINT,
            SEA_DROP,
            keccak256("automated-seadrop-v2"),
            keccak256("zero-value-canonical-clones-only")
        );
        _configureAutonomy();
    }

    function testAuthorizedAgentExecutesExactFreeMintEndToEnd() public {
        _authorizeAgent();
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(COLLECTION_ONE, 42);

        VM.prank(AGENT);
        account.executeAutonomousAcquisition(intent, "");

        require(
            V2MockSeaDropCloneImplementation(COLLECTION_ONE).ownerOf(42) == address(account),
            "account owns mint"
        );
        require(account.acquisitionNonce() == 1, "nonce advanced");
        BrokerPolicyModule.AcquisitionUsage memory usage = policy.acquisitionUsage(address(account));
        require(usage.acquisitionsToday == 1, "usage advanced");
    }

    function testUnauthorizedAgentCannotExecute() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(COLLECTION_ONE, 42);
        VM.expectRevert(
            abi.encodeWithSelector(GoghPunkAccountV1.AgentNotAuthorized.selector, AGENT)
        );
        VM.prank(AGENT);
        account.executeAutonomousAcquisition(intent, "");
    }

    function testHardDailyCapStopsAgentAfterExactCount() public {
        VM.prank(owner);
        policy.configureAutomatedSeaDropPolicy(address(account), 1);
        _authorizeAgent();
        GoghBrokerTypes.AcquisitionIntent memory first = _intent(COLLECTION_ONE, 42);
        VM.prank(AGENT);
        account.executeAutonomousAcquisition(first, "");

        GoghBrokerTypes.AcquisitionIntent memory second = _intent(COLLECTION_TWO, 42);
        VM.expectRevert(
            abi.encodeWithSelector(BrokerPolicyModule.DailyAcquisitionLimitExceeded.selector, 1)
        );
        VM.prank(AGENT);
        account.executeAutonomousAcquisition(second, "");
        require(account.acquisitionNonce() == 1, "failed mint preserves nonce");
    }

    function testOneCallDisableStopsPreviouslyAuthorizedAgent() public {
        _authorizeAgent();
        VM.prank(owner);
        policy.disableAutomatedSeaDropPolicy(address(account));

        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(COLLECTION_ONE, 42);
        VM.expectRevert(BrokerPolicyModule.AccountPauseActive.selector);
        VM.prank(AGENT);
        account.executeAutonomousAcquisition(intent, "");
        require(account.acquisitionNonce() == 0, "disabled execution preserves nonce");
    }

    function testOneSetupAdmitsMultipleAutomaticallyScreenedCollections() public {
        GoghBrokerTypes.AcquisitionIntent memory first = _intent(COLLECTION_ONE, 42);
        GoghBrokerTypes.AdapterExecution memory execution =
            automatedAdapter.buildExecution(first, "");
        VM.prank(address(account));
        policy.validateAndConsume(first, execution, false);

        GoghBrokerTypes.AcquisitionIntent memory second = _intent(COLLECTION_TWO, 42);
        execution = automatedAdapter.buildExecution(second, "");
        VM.prank(address(account));
        policy.validateAndConsume(second, execution, false);

        BrokerPolicyModule.AcquisitionUsage memory usage = policy.acquisitionUsage(address(account));
        require(usage.acquisitionsToday == 2, "daily count");
    }

    function testExplicitDenyStillWinsWithoutHumanReview() public {
        VM.prank(owner);
        policy.setCollectionPermission(address(account), COLLECTION_ONE, false, true);
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(COLLECTION_ONE, 42);
        GoghBrokerTypes.AdapterExecution memory execution =
            automatedAdapter.buildExecution(intent, "");
        VM.expectRevert(
            abi.encodeWithSelector(BrokerPolicyModule.CollectionDenied.selector, COLLECTION_ONE)
        );
        VM.prank(address(account));
        policy.validateAndConsume(intent, execution, false);
    }

    function testUnknownCollectionBypassIsExactAdapterAndFreeMintOnly() public {
        MockMarketplaceAdapter other =
            new MockMarketplaceAdapter(SEA_DROP, GoghBrokerTypes.AdapterKind.MINT);
        VM.prank(guardian);
        adapters.registerAdapter(
            address(other),
            GoghBrokerTypes.AdapterKind.MINT,
            SEA_DROP,
            keccak256("other"),
            keccak256("other")
        );
        VM.prank(owner);
        policy.setAdapterPermission(address(account), address(other), true);

        GoghBrokerTypes.AcquisitionIntent memory wrongAdapter = _intent(COLLECTION_ONE, 42);
        wrongAdapter.adapter = address(other);
        wrongAdapter.adapterCodeHash = address(other).codehash;
        GoghBrokerTypes.AdapterExecution memory execution =
            automatedAdapter.buildExecution(_intent(COLLECTION_ONE, 42), "");
        VM.expectRevert(
            abi.encodeWithSelector(BrokerPolicyModule.CollectionNotAllowed.selector, COLLECTION_ONE)
        );
        VM.prank(address(account));
        policy.validateAndConsume(wrongAdapter, execution, false);

        GoghBrokerTypes.AcquisitionIntent memory paid = _intent(COLLECTION_ONE, 42);
        paid.opportunityType = GoghBrokerTypes.OpportunityType.MINT;
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedSeaDropFreeMintAdapter.UnsupportedOpportunityType.selector,
                GoghBrokerTypes.OpportunityType.MINT
            )
        );
        automatedAdapter.buildExecution(paid, "");
    }

    function testAdapterRejectsPaidAndNonCanonicalCollections() public {
        V2MockSeaDrop paidSeaDrop = new V2MockSeaDrop(1);
        VM.etch(SEA_DROP, address(paidSeaDrop).code);
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(COLLECTION_ONE, 42);
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedSeaDropFreeMintAdapter.InvalidPinnedHash.selector,
                SEA_DROP,
                automatedAdapter.expectedSeaDropCodeHash(),
                SEA_DROP.codehash
            )
        );
        automatedAdapter.buildExecution(intent, "");

        V2MockSeaDrop freeSeaDrop = new V2MockSeaDrop(0);
        VM.etch(SEA_DROP, address(freeSeaDrop).code);
        VM.etch(COLLECTION_ONE, hex"60006000f3");
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedSeaDropFreeMintAdapter.InvalidCloneRuntime.selector,
                COLLECTION_ONE,
                COLLECTION_ONE.codehash
            )
        );
        automatedAdapter.buildExecution(intent, "");
    }

    function testV2RegistryReportsVersionTwo() public view {
        require(registry.implementationForVersion(2) == address(implementation), "version 2");
    }

    function testOneCallSetupWritesExactZeroSpendEnvelopeAndOneCallDisablesIt() public {
        BrokerPolicyModule.PolicyState memory configured = policy.policy(address(account));
        require(configured.config.mode == GoghBrokerTypes.BrokerMode.AUTONOMOUS, "mode");
        require(configured.config.maxSpendPerTransaction == 0, "transaction spend");
        require(configured.config.maxSpendPerDay == 0, "daily spend");
        require(configured.config.maxSpendPerWeek == 0, "weekly spend");
        require(configured.config.maxMintPrice == 0, "mint price");
        require(configured.config.maxSecondaryPurchasePrice == 0, "secondary price");
        require(configured.config.minimumNativeReserve == 0, "native reserve");
        require(configured.config.maxAcquisitionsPerDay == 10, "daily cap");
        require(configured.config.maxIntentAge == 120, "intent age");
        require(configured.config.maxSlippageBps == 0, "slippage");
        require(!configured.config.requireCollectionAllowlist, "allowlist");
        require(configured.config.allowUnknownCollections, "unknown collections");
        require(policy.approvedAdapters(address(account), address(automatedAdapter)), "adapter");
        require(policy.approvedMintContracts(address(account), SEA_DROP), "venue");
        require(
            policy.approvedSelectors(address(account), IOpenSeaSeaDrop.mintPublic.selector),
            "selector"
        );
        BrokerPolicyModule.CurrencyPolicy memory currency =
            policy.currencyPolicy(address(account), address(0));
        require(currency.allowed && currency.maxMintPrice == 0, "native zero only");
        BrokerPolicyModule.MintControls memory controls = policy.mintControls(address(account));
        require(
            !controls.ownerApprovedMints && controls.autonomousFreeMints
                && !controls.autonomousPaidMints,
            "mint controls"
        );

        VM.prank(owner);
        policy.disableAutomatedSeaDropPolicy(address(account));
        BrokerPolicyModule.PolicyState memory disabled = policy.policy(address(account));
        require(disabled.config.mode == GoghBrokerTypes.BrokerMode.DISABLED, "disabled mode");
        require(disabled.accountPaused, "paused");
        require(
            !policy.approvedAdapters(address(account), address(automatedAdapter)), "adapter off"
        );
        require(!policy.approvedMintContracts(address(account), SEA_DROP), "venue off");
        require(
            policy.deniedSelectors(address(account), IOpenSeaSeaDrop.mintPublic.selector),
            "selector denied"
        );
        controls = policy.mintControls(address(account));
        require(
            !controls.ownerApprovedMints && !controls.autonomousFreeMints
                && !controls.autonomousPaidMints,
            "mint controls off"
        );
    }

    function testOneCallSetupRejectsUnsupportedCap() public {
        VM.expectRevert(
            abi.encodeWithSelector(BrokerPolicyModuleV2.InvalidAutomatedDailyCap.selector, 2)
        );
        VM.prank(owner);
        policy.configureAutomatedSeaDropPolicy(address(account), 2);
    }

    function testOneCallSetupInvalidatesEveryPermissionFromEarlierGeneration() public {
        MockMarketplaceAdapter oldAdapter =
            new MockMarketplaceAdapter(SEA_DROP, GoghBrokerTypes.AdapterKind.MINT);
        VM.startPrank(owner);
        policy.setAdapterPermission(address(account), address(oldAdapter), true);
        require(
            policy.approvedAdapters(address(account), address(oldAdapter)), "old permission set"
        );
        policy.configureAutomatedSeaDropPolicy(address(account), 3);
        VM.stopPrank();

        require(!policy.approvedAdapters(address(account), address(oldAdapter)), "old invalidated");
        require(
            policy.approvedAdapters(address(account), address(automatedAdapter)), "exact adapter"
        );
        require(policy.policy(address(account)).config.maxAcquisitionsPerDay == 3, "new cap");
    }

    function _configureAutonomy() private {
        VM.prank(guardian);
        policy.setFeatureFlags(
            GoghBrokerTypes.FeatureFlags({
                scoutMode: true,
                approvalPurchases: false,
                autonomousPurchases: true,
                autonomousMints: true,
                unknownCollectionExecution: true,
                selling: false,
                autonomousSelling: false
            })
        );
        VM.prank(owner);
        policy.configureAutomatedSeaDropPolicy(address(account), 10);
    }

    function _authorizeAgent() private {
        VM.prank(guardian);
        agents.configureGlobalAgent(
            AGENT,
            true,
            uint64(block.timestamp),
            uint64(block.timestamp + 30 days),
            keccak256("automated-seadrop-agent-v2"),
            keccak256("bounded-zero-value-beta")
        );
        VM.prank(owner);
        agents.authorizeAgent(address(account), AGENT, uint64(block.timestamp + 7 days));
    }

    function _intent(address collection, uint256 tokenId)
        private
        view
        returns (GoghBrokerTypes.AcquisitionIntent memory intent)
    {
        intent = GoghBrokerTypes.AcquisitionIntent({
            account: address(account),
            chainId: 4663,
            expectedOwner: owner,
            nonce: account.acquisitionNonce(),
            policyVersion: policy.policyVersion(address(account)),
            opportunityType: GoghBrokerTypes.OpportunityType.FREE_MINT,
            assetStandard: GoghBrokerTypes.AssetStandard.ERC721,
            adapter: address(automatedAdapter),
            venue: SEA_DROP,
            collection: collection,
            tokenId: tokenId,
            assetAmount: 1,
            currency: address(0),
            expectedPrice: 0,
            maxPrice: 0,
            maxSlippageBps: 0,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 120),
            opportunityId: keccak256(abi.encode(collection, tokenId)),
            reasoningHash: keccak256(abi.encode("AUTOMATED_SEADROP_V2", collection)),
            adapterCodeHash: address(automatedAdapter).codehash
        });
    }

    function _cloneRuntime() private pure returns (bytes memory) {
        return abi.encodePacked(
            hex"363d3d373d3d3d363d73", CLONE_IMPLEMENTATION, hex"5af43d82803e903d91602b57fd5bf3"
        );
    }
}
