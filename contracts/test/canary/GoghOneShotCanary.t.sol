// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";
import { BrokerPolicyModule } from "../../src/BrokerPolicyModule.sol";
import { GoghBrokerTypes } from "../../src/GoghBrokerTypes.sol";
import { GoghPunkAccountV1 } from "../../src/GoghPunkAccountV1.sol";
import { GoghOneShotCanaryMintAdapter } from "../../src/adapters/GoghOneShotCanaryMintAdapter.sol";
import { ZeroCostMintAdapterBase } from "../../src/adapters/ZeroCostMintAdapterBase.sol";
import {
    GoghOneShotCanaryArt,
    IGoghPunkCanaryAccountRegistry
} from "../../src/canary/GoghOneShotCanaryArt.sol";
import { ArtBrokerTestBase } from "../ArtBrokerTestBase.sol";
import { MockCanonicalGoghPunks } from "../mocks/TestInfrastructure.sol";

contract FalseCanonicalAccount {
    function isCanonicalGoghPunkAccount() external pure returns (bool) {
        return false;
    }
}

contract WrongChainAccountRegistry {
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

contract OwnerlessRegistryDerivedAccount {
    function isCanonicalGoghPunkAccount() external pure returns (bool) {
        return true;
    }

    function token() external pure returns (uint256, address, uint256) {
        return (4663, 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6, 321);
    }

    function owner() external pure returns (address) {
        return address(0);
    }
}

contract CallbackRejectingRegistryDerivedAccount {
    error CallbackRejected();

    function isCanonicalGoghPunkAccount() external pure returns (bool) {
        return true;
    }

    function token() external pure returns (uint256, address, uint256) {
        return (4663, 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6, 320);
    }

    function owner() external pure returns (address) {
        return address(0xBEEF);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert CallbackRejected();
    }
}

contract GoghOneShotCanaryTest is ArtBrokerTestBase {
    uint256 internal constant CANARY_TOKEN_ID = 9001;

    GoghOneShotCanaryArt internal canaryArt;
    GoghOneShotCanaryMintAdapter internal canaryAdapter;

    function setUp() public override {
        super.setUp();
        canaryArt = _newCanary(address(account), TOKEN_ID);
        canaryAdapter = new GoghOneShotCanaryMintAdapter(canaryArt);
        VM.prank(guardian);
        adapters.registerAdapter(
            address(canaryAdapter),
            GoghBrokerTypes.AdapterKind.MINT,
            address(canaryArt),
            keccak256("one-shot-canary-adapter-v1"),
            keccak256("local-test-only")
        );
    }

    function testCollectionConstructorRejectsZeroRegistryAndNonContractRegistry() public {
        VM.expectRevert(GoghOneShotCanaryArt.ZeroAccountRegistry.selector);
        new GoghOneShotCanaryArt(
            IGoghPunkCanaryAccountRegistry(address(0)), address(account), TOKEN_ID, CANARY_TOKEN_ID
        );

        address eoa = address(0x1212);
        VM.expectRevert(
            abi.encodeWithSelector(GoghOneShotCanaryArt.AccountRegistryHasNoCode.selector, eoa)
        );
        new GoghOneShotCanaryArt(
            IGoghPunkCanaryAccountRegistry(eoa), address(account), TOKEN_ID, CANARY_TOKEN_ID
        );
    }

    function testCollectionConstructorRejectsWrongRegistryConfiguration() public {
        WrongChainAccountRegistry wrongRegistry = new WrongChainAccountRegistry();
        VM.expectRevert(
            abi.encodeWithSelector(
                GoghOneShotCanaryArt.InvalidAccountRegistryConfiguration.selector,
                address(wrongRegistry)
            )
        );
        new GoghOneShotCanaryArt(
            IGoghPunkCanaryAccountRegistry(address(wrongRegistry)),
            address(account),
            TOKEN_ID,
            CANARY_TOKEN_ID
        );
    }

    function testCollectionConstructorRejectsZeroAccount() public {
        VM.expectRevert(GoghOneShotCanaryArt.ZeroPunkAccount.selector);
        _newCanary(address(0), TOKEN_ID);
    }

    function testCollectionConstructorRejectsNonContractAccount() public {
        address eoa = address(0x1234);
        VM.expectRevert(
            abi.encodeWithSelector(GoghOneShotCanaryArt.PunkAccountHasNoCode.selector, eoa)
        );
        _newCanary(eoa, TOKEN_ID);
    }

    function testCollectionConstructorRejectsRegistryDerivedFakeAccount() public {
        uint256 fakePunkTokenId = TOKEN_ID + 2;
        FalseCanonicalAccount falseAccount = new FalseCanonicalAccount();
        address registryDerivedFake = accountRegistry.account(fakePunkTokenId);
        VM.etch(registryDerivedFake, address(falseAccount).code);
        VM.expectRevert(
            abi.encodeWithSelector(
                GoghOneShotCanaryArt.NonCanonicalPunkAccount.selector, registryDerivedFake
            )
        );
        _newCanary(registryDerivedFake, fakePunkTokenId);
    }

    function testCollectionConstructorRejectsRegistryDerivedAccountWithoutOwner() public {
        uint256 ownerlessPunkTokenId = 321;
        OwnerlessRegistryDerivedAccount ownerless = new OwnerlessRegistryDerivedAccount();
        address registryDerivedOwnerless = accountRegistry.account(ownerlessPunkTokenId);
        VM.etch(registryDerivedOwnerless, address(ownerless).code);

        VM.expectRevert(
            abi.encodeWithSelector(
                GoghOneShotCanaryArt.PunkAccountHasNoOwner.selector, registryDerivedOwnerless
            )
        );
        _newCanary(registryDerivedOwnerless, ownerlessPunkTokenId);
    }

    function testCollectionConstructorRejectsImplementationRatherThanDerivedAccount() public {
        address expected = accountRegistry.account(TOKEN_ID);
        VM.expectRevert(
            abi.encodeWithSelector(
                GoghOneShotCanaryArt.AccountDoesNotMatchRegistry.selector,
                address(implementation),
                expected
            )
        );
        _newCanary(address(implementation), TOKEN_ID);
    }

    function testCollectionConstructorRejectsAlternateAccountForControllingPunk() public {
        uint256 alternatePunkTokenId = TOKEN_ID + 1;
        MockCanonicalGoghPunks(GOGH_PUNKS).mint(bob, alternatePunkTokenId);
        VM.prank(bob);
        address alternateAccount = accountRegistry.createAccount(alternatePunkTokenId);

        VM.expectRevert(
            abi.encodeWithSelector(
                GoghOneShotCanaryArt.AccountDoesNotMatchRegistry.selector,
                alternateAccount,
                address(account)
            )
        );
        _newCanary(alternateAccount, TOKEN_ID);
    }

    function testCollectionConstructorRejectsWrongControllingPunkTokenId() public {
        uint256 wrongPunkTokenId = TOKEN_ID + 1;
        address expected = accountRegistry.account(wrongPunkTokenId);
        VM.expectRevert(
            abi.encodeWithSelector(
                GoghOneShotCanaryArt.AccountDoesNotMatchRegistry.selector,
                address(account),
                expected
            )
        );
        _newCanary(address(account), wrongPunkTokenId);
    }

    function testAdapterConstructorRejectsZeroOrNonContractCollection() public {
        VM.expectRevert(ZeroCostMintAdapterBase.ZeroAddress.selector);
        new GoghOneShotCanaryMintAdapter(GoghOneShotCanaryArt(address(0)));

        address eoa = address(0x5678);
        VM.expectRevert(
            abi.encodeWithSelector(ZeroCostMintAdapterBase.InvalidPinnedContract.selector, eoa)
        );
        new GoghOneShotCanaryMintAdapter(GoghOneShotCanaryArt(eoa));
    }

    function testMintRejectsUnauthorizedCaller() public {
        VM.prank(alice);
        VM.expectRevert(
            abi.encodeWithSelector(
                GoghOneShotCanaryArt.UnauthorizedCaller.selector, alice, address(account)
            )
        );
        canaryArt.mint(address(account), CANARY_TOKEN_ID);
    }

    function testMintRejectsWrongRecipient() public {
        VM.prank(address(account));
        VM.expectRevert(
            abi.encodeWithSelector(
                GoghOneShotCanaryArt.WrongRecipient.selector, bob, address(account)
            )
        );
        canaryArt.mint(bob, CANARY_TOKEN_ID);
    }

    function testMintRejectsWrongTokenId() public {
        VM.prank(address(account));
        VM.expectRevert(
            abi.encodeWithSelector(
                GoghOneShotCanaryArt.WrongTokenId.selector, CANARY_TOKEN_ID + 1, CANARY_TOKEN_ID
            )
        );
        canaryArt.mint(address(account), CANARY_TOKEN_ID + 1);
    }

    function testMintRejectsNonZeroValue() public {
        bytes memory callData =
            abi.encodeCall(GoghOneShotCanaryArt.mint, (address(account), CANARY_TOKEN_ID));
        VM.prank(alice);
        VM.expectRevert(
            abi.encodeWithSelector(GoghOneShotCanaryArt.NonZeroPayment.selector, uint256(1))
        );
        account.execute(address(canaryArt), 1, callData, 0);
    }

    function testMintRejectsRepeatMint() public {
        _executeDirectMint();

        VM.prank(alice);
        VM.expectRevert(GoghOneShotCanaryArt.AlreadyMinted.selector);
        account.execute(
            address(canaryArt),
            0,
            abi.encodeCall(GoghOneShotCanaryArt.mint, (address(account), CANARY_TOKEN_ID)),
            0
        );
    }

    function testSuccessfulAccountCallSafelyDeliversArt() public {
        uint256 stateBefore = account.state();

        _executeDirectMint();

        require(canaryArt.minted(), "mint flag not set");
        require(canaryArt.ownerOf(CANARY_TOKEN_ID) == address(account), "wrong art owner");
        require(account.state() > stateBefore, "account receipt was not observed");
    }

    function testSafeMintCallbackRevertRollsBackOneShotState() public {
        uint256 rejectingPunkTokenId = 320;
        CallbackRejectingRegistryDerivedAccount rejecting =
            new CallbackRejectingRegistryDerivedAccount();
        address registryDerivedRejecting = accountRegistry.account(rejectingPunkTokenId);
        VM.etch(registryDerivedRejecting, address(rejecting).code);
        GoghOneShotCanaryArt rejectingArt =
            _newCanary(registryDerivedRejecting, rejectingPunkTokenId);

        VM.prank(registryDerivedRejecting);
        VM.expectRevert(CallbackRejectingRegistryDerivedAccount.CallbackRejected.selector);
        rejectingArt.mint(registryDerivedRejecting, CANARY_TOKEN_ID);
        require(!rejectingArt.minted(), "failed callback consumed one-shot mint");
    }

    function testMetadataIsDeterministicSelfContainedAndHasRequiredFields() public {
        _executeDirectMint();

        bytes memory json =
            _decodeDataUri(canaryArt.tokenURI(CANARY_TOKEN_ID), "data:application/json;base64,");
        require(_contains(json, bytes('"name":"Gogh Punks One-Shot Canary #9001"')), "name missing");
        require(
            _contains(
                json,
                bytes(
                    '"description":"A controlled one-shot test artwork collected by a Gogh Punk Account."'
                )
            ),
            "description missing"
        );
        require(
            _contains(json, bytes('"image":"data:image/svg+xml;base64,')),
            "self-contained image missing"
        );
        bytes memory svg = Base64.decode(
            string(_extractJsonBase64Value(json, bytes('"image":"data:image/svg+xml;base64,')))
        );
        require(_contains(svg, bytes('<svg xmlns="http://www.w3.org/2000/svg"')), "SVG missing");
        require(_contains(svg, bytes(">GOGH</text>")), "SVG label missing");
        require(_contains(svg, bytes(">CANARY #9001</text>")), "SVG token label missing");
        require(_contains(svg, bytes("</svg>")), "SVG closing tag missing");

        string memory first = canaryArt.tokenURI(CANARY_TOKEN_ID);
        string memory second = canaryArt.tokenURI(CANARY_TOKEN_ID);
        require(keccak256(bytes(first)) == keccak256(bytes(second)), "metadata changed");
    }

    function testAdapterBuildsAndExecutesOnlyExactCanaryCall() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _canaryIntent();
        GoghBrokerTypes.AdapterExecution memory execution =
            canaryAdapter.buildExecution(intent, bytes(""));

        require(execution.target == address(canaryArt), "wrong target");
        require(execution.value == 0, "nonzero value");
        require(execution.currency == address(0), "nonzero currency");
        require(execution.allowanceSpender == address(0), "allowance spender set");
        require(execution.allowanceAmount == 0, "allowance set");
        require(execution.paymentAmount == 0, "payment set");
        require(
            keccak256(execution.callData)
                == keccak256(
                    abi.encodeCall(GoghOneShotCanaryArt.mint, (address(account), CANARY_TOKEN_ID))
                ),
            "wrong calldata"
        );

        VM.prank(alice);
        account.execute(execution.target, execution.value, execution.callData, 0);
        require(canaryArt.ownerOf(CANARY_TOKEN_ID) == address(account), "adapter mint failed");
    }

    function testOwnerApprovedAcquisitionEnforcesPolicyAndReceivesCanaryArt() public {
        _configureApprovedCanaryPermissions();

        GoghBrokerTypes.AcquisitionIntent memory blocked = _canaryIntent();
        VM.prank(alice);
        VM.expectRevert(BrokerPolicyModule.OwnerApprovedMintsDisabled.selector);
        account.executeApprovedAcquisition(blocked, bytes(""), bytes(""));

        VM.prank(alice);
        policy.setMintControls(
            address(account),
            BrokerPolicyModule.MintControls({
                ownerApprovedMints: true, autonomousFreeMints: false, autonomousPaidMints: false
            })
        );

        GoghBrokerTypes.AcquisitionIntent memory intent = _canaryIntent();
        uint256 nonceBefore = account.acquisitionNonce();
        VM.prank(alice);
        account.executeApprovedAcquisition(intent, bytes(""), bytes(""));

        require(canaryArt.ownerOf(CANARY_TOKEN_ID) == address(account), "postcondition failed");
        require(account.acquisitionNonce() == nonceBefore + 1, "intent nonce not consumed");
        BrokerPolicyModule.AcquisitionUsage memory consumed =
            policy.acquisitionUsage(address(account));
        require(consumed.acquisitionsToday == 1, "policy count not consumed");
    }

    function testAlreadyMintedBrokerRouteRollsBackNonceAndUsage() public {
        _configureApprovedCanaryPermissions();
        VM.prank(alice);
        policy.setMintControls(
            address(account),
            BrokerPolicyModule.MintControls({
                ownerApprovedMints: true, autonomousFreeMints: false, autonomousPaidMints: false
            })
        );

        GoghBrokerTypes.AcquisitionIntent memory firstMint = _canaryIntent();
        VM.prank(alice);
        account.executeApprovedAcquisition(firstMint, bytes(""), bytes(""));
        uint256 nonceAfterMint = account.acquisitionNonce();
        BrokerPolicyModule.AcquisitionUsage memory usageAfterMint =
            policy.acquisitionUsage(address(account));

        GoghBrokerTypes.AcquisitionIntent memory retry = _canaryIntent();
        VM.prank(alice);
        VM.expectRevert(
            abi.encodeWithSelector(
                GoghPunkAccountV1.AssetAlreadyOwned.selector, address(canaryArt), CANARY_TOKEN_ID
            )
        );
        account.executeApprovedAcquisition(retry, bytes(""), bytes(""));

        require(account.acquisitionNonce() == nonceAfterMint, "failed retry consumed nonce");
        BrokerPolicyModule.AcquisitionUsage memory usageAfterRetry =
            policy.acquisitionUsage(address(account));
        require(
            usageAfterRetry.acquisitionsToday == usageAfterMint.acquisitionsToday,
            "failed retry consumed daily acquisition"
        );
    }

    function testAdapterRejectsWrongBoundAccountAndToken() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _canaryIntent();
        intent.account = bob;
        VM.expectRevert(
            abi.encodeWithSelector(
                GoghOneShotCanaryMintAdapter.WrongCanaryAccount.selector, bob, address(account)
            )
        );
        canaryAdapter.buildExecution(intent, bytes(""));

        intent = _canaryIntent();
        intent.tokenId = CANARY_TOKEN_ID + 1;
        VM.expectRevert(
            abi.encodeWithSelector(
                GoghOneShotCanaryMintAdapter.WrongCanaryTokenId.selector,
                CANARY_TOKEN_ID + 1,
                CANARY_TOKEN_ID
            )
        );
        canaryAdapter.buildExecution(intent, bytes(""));
    }

    function testAdapterRejectsHostileEnvelopeThroughBase() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _canaryIntent();
        intent.opportunityType = GoghBrokerTypes.OpportunityType.MINT;
        VM.expectRevert(
            abi.encodeWithSelector(
                ZeroCostMintAdapterBase.UnsupportedOpportunityType.selector,
                GoghBrokerTypes.OpportunityType.MINT
            )
        );
        canaryAdapter.buildExecution(intent, bytes(""));

        intent = _canaryIntent();
        intent.maxPrice = 1;
        VM.expectRevert(
            abi.encodeWithSelector(
                ZeroCostMintAdapterBase.NonZeroIntentPrice.selector, uint256(0), uint256(1)
            )
        );
        canaryAdapter.buildExecution(intent, bytes(""));

        intent = _canaryIntent();
        VM.expectRevert(
            abi.encodeWithSelector(ZeroCostMintAdapterBase.UnsupportedAdapterData.selector, 1)
        );
        canaryAdapter.buildExecution(intent, hex"01");
    }

    function _executeDirectMint() internal {
        VM.prank(alice);
        account.execute(
            address(canaryArt),
            0,
            abi.encodeCall(GoghOneShotCanaryArt.mint, (address(account), CANARY_TOKEN_ID)),
            0
        );
    }

    function _configureApprovedCanaryPermissions() internal {
        _setFeatures(true, false, false);
        _configurePolicy(GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED);

        VM.startPrank(alice);
        policy.setAdapterPermission(address(account), address(canaryAdapter), true);
        policy.setVenuePermission(
            address(account), address(canaryArt), GoghBrokerTypes.AdapterKind.MINT, true
        );
        policy.setCollectionPermission(address(account), address(canaryArt), true, false);
        policy.setSelectorPermission(
            address(account), GoghOneShotCanaryArt.mint.selector, true, false
        );
        policy.setVenueCurrencyMaximum(address(account), address(canaryArt), address(0), 0);
        VM.stopPrank();
    }

    function _newCanary(address candidateAccount, uint256 punkTokenId)
        internal
        returns (GoghOneShotCanaryArt)
    {
        return new GoghOneShotCanaryArt(
            IGoghPunkCanaryAccountRegistry(address(accountRegistry)),
            candidateAccount,
            punkTokenId,
            CANARY_TOKEN_ID
        );
    }

    function _decodeDataUri(string memory uri, string memory prefix)
        internal
        pure
        returns (bytes memory decoded)
    {
        bytes memory full = bytes(uri);
        bytes memory expectedPrefix = bytes(prefix);
        require(full.length > expectedPrefix.length, "empty data URI");
        for (uint256 i; i < expectedPrefix.length; ++i) {
            require(full[i] == expectedPrefix[i], "wrong data URI prefix");
        }
        bytes memory encoded = new bytes(full.length - expectedPrefix.length);
        for (uint256 i; i < encoded.length; ++i) {
            encoded[i] = full[i + expectedPrefix.length];
        }
        return Base64.decode(string(encoded));
    }

    function _contains(bytes memory haystack, bytes memory needle) internal pure returns (bool) {
        if (needle.length == 0 || needle.length > haystack.length) return false;
        for (uint256 i; i <= haystack.length - needle.length; ++i) {
            bool matches = true;
            for (uint256 j; j < needle.length; ++j) {
                if (haystack[i + j] != needle[j]) {
                    matches = false;
                    break;
                }
            }
            if (matches) return true;
        }
        return false;
    }

    function _extractJsonBase64Value(bytes memory json, bytes memory marker)
        internal
        pure
        returns (bytes memory encoded)
    {
        require(marker.length != 0 && marker.length < json.length, "invalid image marker");
        uint256 start = type(uint256).max;
        for (uint256 i; i <= json.length - marker.length; ++i) {
            bool matches = true;
            for (uint256 j; j < marker.length; ++j) {
                if (json[i + j] != marker[j]) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                start = i + marker.length;
                break;
            }
        }
        require(start != type(uint256).max, "image marker missing");
        uint256 end = start;
        while (end < json.length && json[end] != bytes1('"')) ++end;
        require(end > start && end < json.length, "image value malformed");

        encoded = new bytes(end - start);
        for (uint256 i; i < encoded.length; ++i) {
            encoded[i] = json[start + i];
        }
    }

    function _canaryIntent()
        internal
        view
        returns (GoghBrokerTypes.AcquisitionIntent memory intent)
    {
        intent = GoghBrokerTypes.AcquisitionIntent({
            account: address(account),
            chainId: 4663,
            expectedOwner: alice,
            nonce: account.acquisitionNonce(),
            policyVersion: policy.policyVersion(address(account)),
            opportunityType: GoghBrokerTypes.OpportunityType.FREE_MINT,
            assetStandard: GoghBrokerTypes.AssetStandard.ERC721,
            adapter: address(canaryAdapter),
            venue: address(canaryArt),
            collection: address(canaryArt),
            tokenId: CANARY_TOKEN_ID,
            assetAmount: 1,
            currency: address(0),
            expectedPrice: 0,
            maxPrice: 0,
            maxSlippageBps: 0,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 120 seconds),
            opportunityId: keccak256("one-shot-canary"),
            reasoningHash: keccak256("local-test-only"),
            adapterCodeHash: address(canaryAdapter).codehash
        });
    }
}
