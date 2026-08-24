// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ArtAdapterRegistry } from "../src/ArtAdapterRegistry.sol";
import { ArtAgentRegistry } from "../src/ArtAgentRegistry.sol";
import { BrokerPolicyModule } from "../src/BrokerPolicyModule.sol";
import { BrokerPolicyModuleV3 } from "../src/BrokerPolicyModuleV3.sol";
import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import { GoghPunkAccountV1 } from "../src/GoghPunkAccountV1.sol";
import { GoghPunkAccountV3 } from "../src/GoghPunkAccountV3.sol";
import { GoghPunkAccountRegistryV3 } from "../src/GoghPunkAccountRegistryV3.sol";
import {
    AutomatedSeaDropStudioFreeMintAdapter
} from "../src/adapters/AutomatedSeaDropStudioFreeMintAdapter.sol";
import { IOpenSeaSeaDrop } from "../src/adapters/OpenSeaSeaDropFreeMintAdapter.sol";
import {
    ERC6551RegistryHarness,
    MockCanonicalGoghPunks,
    TestVm
} from "./mocks/TestInfrastructure.sol";

contract V3MockSeaDrop {
    uint80 private immutable _price;

    constructor(uint80 price_) {
        _price = price_;
    }

    function getPublicDrop(address) external view returns (IOpenSeaSeaDrop.PublicDrop memory drop) {
        drop = IOpenSeaSeaDrop.PublicDrop({
            mintPrice: _price,
            startTime: 0,
            endTime: type(uint48).max,
            maxTotalMintableByWallet: 10,
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
        address minter = minterIfNotPayer == address(0) ? msg.sender : minterIfNotPayer;
        V3MockStudioCollection(collection).mintSeaDrop(minter, quantity);
    }
}

contract V3MockStudioCollection {
    address private constant SEA_DROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;

    uint256 private _minted;
    mapping(address minter => uint256 count) private _mintedByWallet;
    mapping(uint256 tokenId => address tokenOwner) private _owners;

    error OnlySeaDrop();
    error InvalidQuantity();
    error MissingToken();

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x80ac58cd;
    }

    function getMintStats(address minter)
        external
        view
        returns (uint256 minterNumMinted, uint256 currentTotalMinted, uint256 maxSupply)
    {
        return (_mintedByWallet[minter], 10 + _minted, 100);
    }

    function mintSeaDrop(address minter, uint256 quantity) external {
        if (msg.sender != SEA_DROP) revert OnlySeaDrop();
        if (quantity != 1) revert InvalidQuantity();
        uint256 tokenId = 11 + _minted;
        _minted += 1;
        _mintedByWallet[minter] += 1;
        _owners[tokenId] = minter;
    }

    function ownerOf(uint256 tokenId) external view returns (address tokenOwner) {
        tokenOwner = _owners[tokenId];
        if (tokenOwner == address(0)) revert MissingToken();
    }
}

contract AutomatedSeaDropV3Test {
    TestVm private constant VM = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant GOGH_PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address private constant ERC6551_REGISTRY = 0x000000006551c19487814612e58FE06813775758;
    address private constant SEA_DROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;
    address private constant CLONE_IMPLEMENTATION = 0x09a26fC8FCEF18192E267D7A6da9dFb4be81Dd6A;
    address private constant CLONE_COLLECTION = 0x1111111111111111111111111111111111111111;
    address private constant STUDIO_COLLECTION = 0x2222222222222222222222222222222222222222;
    address private constant UNREVIEWED_COLLECTION = 0x3333333333333333333333333333333333333333;
    uint256 private constant PUNK_ID = 4242;
    uint256 private constant OWNER_KEY = 0xA11CE;
    address private constant AGENT = address(0xA63E17);

    address private owner;
    address private guardian = address(0x600D);
    ArtAdapterRegistry private adapters;
    ArtAgentRegistry private agents;
    AutomatedSeaDropStudioFreeMintAdapter private automatedAdapter;
    BrokerPolicyModuleV3 private policy;
    GoghPunkAccountRegistryV3 private registry;
    GoghPunkAccountV3 private account;

    function setUp() public {
        VM.chainId(4663);
        VM.warp(1_800_000_000);
        owner = VM.addr(OWNER_KEY);

        MockCanonicalGoghPunks collectionTemplate = new MockCanonicalGoghPunks();
        VM.etch(GOGH_PUNKS, address(collectionTemplate).code);
        ERC6551RegistryHarness registryTemplate = new ERC6551RegistryHarness();
        VM.etch(ERC6551_REGISTRY, address(registryTemplate).code);
        MockCanonicalGoghPunks(GOGH_PUNKS).mint(owner, PUNK_ID);

        V3MockSeaDrop seaDrop = new V3MockSeaDrop(0);
        VM.etch(SEA_DROP, address(seaDrop).code);
        V3MockStudioCollection studioTemplate = new V3MockStudioCollection();
        VM.etch(CLONE_IMPLEMENTATION, address(studioTemplate).code);
        VM.etch(CLONE_COLLECTION, _cloneRuntime());
        VM.etch(STUDIO_COLLECTION, address(studioTemplate).code);
        VM.etch(UNREVIEWED_COLLECTION, hex"60006000f3");

        adapters = new ArtAdapterRegistry(guardian);
        agents = new ArtAgentRegistry(guardian);
        automatedAdapter = new AutomatedSeaDropStudioFreeMintAdapter(
            SEA_DROP.codehash, CLONE_IMPLEMENTATION.codehash, STUDIO_COLLECTION.codehash
        );
        policy = new BrokerPolicyModuleV3(guardian, address(adapters), address(automatedAdapter));
        GoghPunkAccountV3 implementation =
            new GoghPunkAccountV3(address(policy), address(agents), address(adapters));
        registry = new GoghPunkAccountRegistryV3(address(implementation), bytes32(0));
        VM.prank(owner);
        account = GoghPunkAccountV3(payable(registry.createAccount(PUNK_ID)));

        VM.prank(guardian);
        adapters.registerAdapter(
            address(automatedAdapter),
            GoghBrokerTypes.AdapterKind.MINT,
            SEA_DROP,
            keccak256("automated-seadrop-v3"),
            keccak256("free-only-reviewed-studio-runtimes")
        );
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
        VM.prank(guardian);
        agents.configureGlobalAgent(
            AGENT,
            true,
            uint64(block.timestamp),
            uint64(block.timestamp + 30 days),
            keccak256("automated-seadrop-agent-v3"),
            keccak256("free-only-studio-runtimes")
        );
        VM.prank(owner);
        agents.authorizeAgent(address(account), AGENT, uint64(block.timestamp + 7 days));
    }

    function testAgentMintsReviewedFullStudioRuntime() public {
        _execute(STUDIO_COLLECTION);
        require(
            V3MockStudioCollection(STUDIO_COLLECTION).ownerOf(11) == address(account),
            "account owns Studio mint"
        );
    }

    function testAgentStillMintsCanonicalCloneRuntime() public {
        _execute(CLONE_COLLECTION);
        require(
            V3MockStudioCollection(CLONE_COLLECTION).ownerOf(11) == address(account),
            "account owns clone mint"
        );
    }

    function testUnreviewedRuntimeFailsClosed() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(UNREVIEWED_COLLECTION);
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedSeaDropStudioFreeMintAdapter.UnreviewedCollectionRuntime.selector,
                UNREVIEWED_COLLECTION,
                UNREVIEWED_COLLECTION.codehash
            )
        );
        automatedAdapter.buildExecution(intent, "");
    }

    function testPaidMintRemainsImpossible() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(STUDIO_COLLECTION);
        intent.opportunityType = GoghBrokerTypes.OpportunityType.MINT;
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedSeaDropStudioFreeMintAdapter.UnsupportedOpportunityType.selector,
                GoghBrokerTypes.OpportunityType.MINT
            )
        );
        automatedAdapter.buildExecution(intent, "");
    }

    function testV3RegistryReportsVersionThree() public view {
        require(registry.implementationForVersion(3) != address(0), "version 3");
        require(automatedAdapter.isReviewedCollectionRuntime(CLONE_COLLECTION), "clone reviewed");
        require(automatedAdapter.isReviewedCollectionRuntime(STUDIO_COLLECTION), "Studio reviewed");
        require(
            !automatedAdapter.isReviewedCollectionRuntime(UNREVIEWED_COLLECTION), "reject other"
        );
    }

    function testContainmentStopsV3Agent() public {
        VM.prank(owner);
        policy.disableAutomatedSeaDropPolicy(address(account));
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(STUDIO_COLLECTION);
        VM.expectRevert(BrokerPolicyModule.AccountPauseActive.selector);
        VM.prank(AGENT);
        account.executeAutonomousAcquisition(intent, "");
    }

    function _execute(address collection) private {
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(collection);
        VM.prank(AGENT);
        account.executeAutonomousAcquisition(intent, "");
    }

    function _intent(address collection)
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
            tokenId: 11,
            assetAmount: 1,
            currency: address(0),
            expectedPrice: 0,
            maxPrice: 0,
            maxSlippageBps: 0,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 120),
            opportunityId: keccak256(abi.encodePacked("v3", collection)),
            reasoningHash: keccak256("reviewed-open-sea-studio-runtime"),
            adapterCodeHash: address(automatedAdapter).codehash
        });
    }

    function _cloneRuntime() private pure returns (bytes memory) {
        return abi.encodePacked(
            hex"363d3d373d3d3d363d73", CLONE_IMPLEMENTATION, hex"5af43d82803e903d91602b57fd5bf3"
        );
    }
}
