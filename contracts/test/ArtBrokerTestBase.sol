// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ArtAdapterRegistry } from "../src/ArtAdapterRegistry.sol";
import { ArtAgentRegistry } from "../src/ArtAgentRegistry.sol";
import { BrokerPolicyModule } from "../src/BrokerPolicyModule.sol";
import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import { GoghPunkAccountRegistry } from "../src/GoghPunkAccountRegistry.sol";
import { GoghPunkAccountV1 } from "../src/GoghPunkAccountV1.sol";
import {
    ERC6551RegistryHarness,
    MockCanonicalGoghPunks,
    MockERC20,
    MockERC721,
    MockERC1155,
    MockMarketplace,
    MockMarketplaceAdapter,
    TestVm
} from "./mocks/TestInfrastructure.sol";

abstract contract ArtBrokerTestBase {
    TestVm internal constant VM = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant GOGH_PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address internal constant ERC6551_REGISTRY = 0x000000006551c19487814612e58FE06813775758;
    uint256 internal constant TOKEN_ID = 317;
    uint256 internal constant ALICE_KEY = 0xA11CE;
    uint256 internal constant BOB_KEY = 0xB0B;
    uint256 internal constant AGENT_KEY = 0xA6E17;

    address internal alice;
    address internal bob;
    address internal agent;
    address internal guardian = address(0x600D);
    address internal recipient = address(0xBEEF);

    ArtAdapterRegistry internal adapters;
    ArtAgentRegistry internal agents;
    BrokerPolicyModule internal policy;
    GoghPunkAccountV1 internal implementation;
    GoghPunkAccountRegistry internal accountRegistry;
    GoghPunkAccountV1 internal account;
    MockERC721 internal art;
    MockERC1155 internal editions;
    MockERC20 internal currency;
    MockMarketplace internal marketplace;
    MockMarketplaceAdapter internal marketplaceAdapter;

    function setUp() public virtual {
        VM.chainId(4663);
        VM.warp(1_800_000_000);
        alice = VM.addr(ALICE_KEY);
        bob = VM.addr(BOB_KEY);
        agent = VM.addr(AGENT_KEY);

        MockCanonicalGoghPunks collectionTemplate = new MockCanonicalGoghPunks();
        VM.etch(GOGH_PUNKS, address(collectionTemplate).code);
        ERC6551RegistryHarness registryTemplate = new ERC6551RegistryHarness();
        VM.etch(ERC6551_REGISTRY, address(registryTemplate).code);
        MockCanonicalGoghPunks(GOGH_PUNKS).mint(alice, TOKEN_ID);

        adapters = new ArtAdapterRegistry(guardian);
        agents = new ArtAgentRegistry(guardian);
        policy = new BrokerPolicyModule(guardian, address(adapters));
        implementation = new GoghPunkAccountV1(address(policy), address(agents), address(adapters));
        accountRegistry = new GoghPunkAccountRegistry(address(implementation), bytes32(0));
        VM.prank(alice);
        account = GoghPunkAccountV1(payable(accountRegistry.createAccount(TOKEN_ID)));

        art = new MockERC721();
        editions = new MockERC1155();
        currency = new MockERC20();
        marketplace = new MockMarketplace();
        marketplaceAdapter = new MockMarketplaceAdapter(
            address(marketplace), GoghBrokerTypes.AdapterKind.MARKETPLACE
        );
        VM.prank(guardian);
        adapters.registerAdapter(
            address(marketplaceAdapter),
            GoghBrokerTypes.AdapterKind.MARKETPLACE,
            address(marketplace),
            keccak256("mock-marketplace-v1"),
            keccak256("test-only")
        );
        VM.deal(address(account), 1 ether);
    }

    function _setFeatures(bool approval, bool autonomous, bool autonomousMints) internal {
        GoghBrokerTypes.FeatureFlags memory flags = GoghBrokerTypes.FeatureFlags({
            scoutMode: true,
            approvalPurchases: approval,
            autonomousPurchases: autonomous,
            autonomousMints: autonomousMints,
            unknownCollectionExecution: false,
            selling: false,
            autonomousSelling: false
        });
        VM.prank(guardian);
        policy.setFeatureFlags(flags);
    }

    function _configurePolicy(GoghBrokerTypes.BrokerMode mode) internal {
        GoghBrokerTypes.PolicyConfig memory config = GoghBrokerTypes.PolicyConfig({
            mode: mode,
            maxSpendPerTransaction: 0.1 ether,
            maxSpendPerDay: 0.2 ether,
            maxSpendPerWeek: 0.5 ether,
            maxMintPrice: 0.05 ether,
            maxSecondaryPurchasePrice: 0.1 ether,
            minimumNativeReserve: 0.2 ether,
            maxAcquisitionsPerDay: 3,
            maxIntentAge: 30 minutes,
            maxSlippageBps: 500,
            requireCollectionAllowlist: true,
            allowUnknownCollections: false
        });
        VM.prank(alice);
        policy.configurePolicy(address(account), config);
        _permitMarketplace(address(art));
    }

    function _permitMarketplace(address collection) internal {
        VM.startPrank(alice);
        policy.setAdapterPermission(address(account), address(marketplaceAdapter), true);
        policy.setVenuePermission(
            address(account), address(marketplace), GoghBrokerTypes.AdapterKind.MARKETPLACE, true
        );
        policy.setCollectionPermission(address(account), collection, true, false);
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
            address(account), address(marketplace), address(0), 0.1 ether
        );
        policy.setSelectorPermission(
            address(account), MockMarketplace.purchaseNative.selector, true, false
        );
        VM.stopPrank();
    }

    function _intent(uint256 tokenId, uint256 price)
        internal
        view
        returns (GoghBrokerTypes.AcquisitionIntent memory intent)
    {
        intent = GoghBrokerTypes.AcquisitionIntent({
            account: address(account),
            chainId: 4663,
            expectedOwner: account.owner(),
            nonce: account.acquisitionNonce(),
            policyVersion: policy.policyVersion(address(account)),
            opportunityType: GoghBrokerTypes.OpportunityType.SECONDARY_BUY,
            assetStandard: GoghBrokerTypes.AssetStandard.ERC721,
            adapter: address(marketplaceAdapter),
            venue: address(marketplace),
            collection: address(art),
            tokenId: tokenId,
            assetAmount: 1,
            currency: address(0),
            expectedPrice: price,
            maxPrice: price,
            maxSlippageBps: 0,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 10 minutes),
            opportunityId: keccak256(abi.encode("opportunity", tokenId)),
            reasoningHash: keccak256(abi.encode("reason", tokenId)),
            adapterCodeHash: address(marketplaceAdapter).codehash
        });
    }

    function _adapterData(MockMarketplaceAdapter.Behavior behavior, uint256 price)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(behavior, price, price);
    }

    function _list(uint256 tokenId) internal {
        art.mint(address(marketplace), tokenId);
    }

    function _signIntent(
        uint256 privateKey,
        GoghBrokerTypes.AcquisitionIntent memory intent,
        bytes memory adapterData
    ) internal returns (bytes memory signature) {
        bytes32 digest = account.acquisitionIntentDigest(intent, keccak256(adapterData));
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _authorizeAgent() internal {
        VM.prank(guardian);
        agents.configureGlobalAgent(
            agent,
            true,
            uint64(block.timestamp),
            uint64(block.timestamp + 90 days),
            keccak256("agent-v1"),
            keccak256("test-agent")
        );
        VM.prank(alice);
        agents.authorizeAgent(address(account), agent, uint64(block.timestamp + 7 days));
    }
}
