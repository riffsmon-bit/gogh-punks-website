// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghBrokerTypes } from "../../src/GoghBrokerTypes.sol";
import { ZeroCostMintAdapterBase } from "../../src/adapters/ZeroCostMintAdapterBase.sol";
import { TestVm } from "../mocks/TestInfrastructure.sol";

contract MockFreeMintCollection {
    mapping(uint256 tokenId => address owner) public ownerOf;

    error AlreadyMinted(uint256 tokenId);

    function mint(address recipient, uint256 tokenId) external {
        if (ownerOf[tokenId] != address(0)) revert AlreadyMinted(tokenId);
        ownerOf[tokenId] = recipient;
    }
}

contract MockFreeMintVenue {
    MockFreeMintCollection public immutable collection;

    constructor(MockFreeMintCollection collection_) {
        collection = collection_;
    }

    function freeMint(address recipient, uint256 tokenId) external {
        collection.mint(recipient, tokenId);
    }

    function otherMint(address recipient, uint256 tokenId) external {
        collection.mint(recipient, tokenId);
    }
}

contract MockZeroCostMintAdapter is ZeroCostMintAdapterBase {
    enum Behavior {
        VALID,
        WRONG_TARGET,
        NONZERO_VALUE,
        NON_NATIVE_CURRENCY,
        ALLOWANCE_SPENDER,
        ALLOWANCE_AMOUNT,
        NONZERO_PAYMENT,
        WRONG_SELECTOR,
        DIRTY_RECIPIENT,
        WRONG_RECIPIENT,
        WRONG_TOKEN_ID,
        SHORT_CALLDATA,
        TRAILING_CALLDATA
    }

    Behavior public immutable behavior;

    constructor(address venue_, address collection_, Behavior behavior_)
        ZeroCostMintAdapterBase(
            venue_,
            collection_,
            MockFreeMintVenue.freeMint.selector,
            GoghBrokerTypes.AssetStandard.ERC721
        )
    {
        behavior = behavior_;
    }

    function _buildFreeMintExecution(GoghBrokerTypes.AcquisitionIntent calldata intent)
        internal
        view
        override
        returns (GoghBrokerTypes.AdapterExecution memory execution)
    {
        execution.target = venue;
        execution.callData =
            abi.encodeCall(MockFreeMintVenue.freeMint, (intent.account, intent.tokenId));

        if (behavior == Behavior.WRONG_TARGET) execution.target = collection;
        if (behavior == Behavior.NONZERO_VALUE) execution.value = 1;
        if (behavior == Behavior.NON_NATIVE_CURRENCY) execution.currency = collection;
        if (behavior == Behavior.ALLOWANCE_SPENDER) execution.allowanceSpender = venue;
        if (behavior == Behavior.ALLOWANCE_AMOUNT) execution.allowanceAmount = 1;
        if (behavior == Behavior.NONZERO_PAYMENT) execution.paymentAmount = 1;
        if (behavior == Behavior.WRONG_SELECTOR) {
            execution.callData =
                abi.encodeCall(MockFreeMintVenue.otherMint, (intent.account, intent.tokenId));
        }
        if (behavior == Behavior.DIRTY_RECIPIENT) {
            bytes memory dirtyCallData = execution.callData;
            assembly ("memory-safe") {
                let recipientPtr := add(dirtyCallData, 0x24)
                mstore(recipientPtr, or(mload(recipientPtr), shl(160, 1)))
            }
            execution.callData = dirtyCallData;
        }
        if (behavior == Behavior.WRONG_RECIPIENT) {
            execution.callData =
                abi.encodeCall(MockFreeMintVenue.freeMint, (address(0xBEEF), intent.tokenId));
        }
        if (behavior == Behavior.WRONG_TOKEN_ID) {
            execution.callData =
                abi.encodeCall(MockFreeMintVenue.freeMint, (intent.account, intent.tokenId + 1));
        }
        if (behavior == Behavior.SHORT_CALLDATA) execution.callData = hex"12345678";
        if (behavior == Behavior.TRAILING_CALLDATA) {
            execution.callData = bytes.concat(execution.callData, bytes32(uint256(1)));
        }
    }
}

contract MockConstructorProbeAdapter is ZeroCostMintAdapterBase {
    constructor(address venue_, address collection_, bytes4 selector_)
        ZeroCostMintAdapterBase(
            venue_, collection_, selector_, GoghBrokerTypes.AssetStandard.ERC721
        )
    { }

    function _buildFreeMintExecution(GoghBrokerTypes.AcquisitionIntent calldata intent)
        internal
        view
        override
        returns (GoghBrokerTypes.AdapterExecution memory execution)
    {
        execution.target = venue;
        execution.callData = bytes.concat(mintSelector, abi.encode(intent.account, intent.tokenId));
    }
}

contract ZeroCostMintAdapterBaseTest {
    TestVm private constant VM = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant ACCOUNT = 0x1111111111111111111111111111111111111111;
    address private constant OWNER = 0x2222222222222222222222222222222222222222;
    uint256 private constant TOKEN_ID = 42;

    MockFreeMintCollection private collection;
    MockFreeMintVenue private venue;
    MockZeroCostMintAdapter private adapter;

    function setUp() public {
        collection = new MockFreeMintCollection();
        venue = new MockFreeMintVenue(collection);
        adapter = _newAdapter(MockZeroCostMintAdapter.Behavior.VALID);
    }

    function testBuildsOnlyPinnedZeroCostMintToPunkAccount() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(adapter);
        GoghBrokerTypes.AdapterExecution memory execution = adapter.buildExecution(intent, "");

        require(adapter.kind() == GoghBrokerTypes.AdapterKind.MINT, "wrong kind");
        require(adapter.venue() == address(venue), "venue not pinned");
        require(adapter.collection() == address(collection), "collection not pinned");
        require(
            adapter.mintSelector() == MockFreeMintVenue.freeMint.selector, "selector not pinned"
        );
        require(execution.target == address(venue), "wrong target");
        require(execution.value == 0, "nonzero value");
        require(execution.currency == address(0), "non-native currency");
        require(execution.allowanceSpender == address(0), "allowance spender set");
        require(execution.allowanceAmount == 0, "allowance set");
        require(execution.paymentAmount == 0, "payment set");
        require(
            keccak256(execution.callData)
                == keccak256(abi.encodeCall(MockFreeMintVenue.freeMint, (ACCOUNT, TOKEN_ID))),
            "unexpected calldata"
        );

        (bool success,) = execution.target.call(execution.callData);
        require(success, "mock mint failed");
        require(collection.ownerOf(TOKEN_ID) == ACCOUNT, "wrong mint recipient");
    }

    function testConstructorRejectsZeroAddressesNonContractsAndZeroSelector() public {
        VM.expectRevert(ZeroCostMintAdapterBase.ZeroAddress.selector);
        new MockConstructorProbeAdapter(
            address(0), address(collection), MockFreeMintVenue.freeMint.selector
        );

        VM.expectRevert(ZeroCostMintAdapterBase.ZeroAddress.selector);
        new MockConstructorProbeAdapter(
            address(venue), address(0), MockFreeMintVenue.freeMint.selector
        );

        address nonContract = address(0xBEEF);
        VM.expectRevert(
            abi.encodeWithSelector(
                ZeroCostMintAdapterBase.InvalidPinnedContract.selector, nonContract
            )
        );
        new MockConstructorProbeAdapter(
            nonContract, address(collection), MockFreeMintVenue.freeMint.selector
        );

        VM.expectRevert(
            abi.encodeWithSelector(
                ZeroCostMintAdapterBase.InvalidPinnedContract.selector, nonContract
            )
        );
        new MockConstructorProbeAdapter(
            address(venue), nonContract, MockFreeMintVenue.freeMint.selector
        );

        VM.expectRevert(ZeroCostMintAdapterBase.InvalidPinnedSelector.selector);
        new MockConstructorProbeAdapter(address(venue), address(collection), bytes4(0));
    }

    function testFuzzExactCalldataShapeBindsRecipientAndTokenId(address recipient, uint256 tokenId)
        public
    {
        if (recipient == address(0)) recipient = address(1);

        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(adapter);
        intent.account = recipient;
        intent.tokenId = tokenId;
        GoghBrokerTypes.AdapterExecution memory execution = adapter.buildExecution(intent, "");

        require(execution.callData.length == 68, "wrong calldata length");
        require(
            keccak256(execution.callData)
                == keccak256(abi.encodeCall(MockFreeMintVenue.freeMint, (recipient, tokenId))),
            "calldata not exact"
        );

        bytes memory callData = execution.callData;
        bytes4 suppliedSelector;
        bytes32 recipientWord;
        uint256 suppliedTokenId;
        assembly ("memory-safe") {
            suppliedSelector := mload(add(callData, 0x20))
            recipientWord := mload(add(callData, 0x24))
            suppliedTokenId := mload(add(callData, 0x44))
        }
        require(suppliedSelector == MockFreeMintVenue.freeMint.selector, "wrong selector");
        require(uint256(recipientWord) >> 160 == 0, "recipient is not canonical");
        require(address(uint160(uint256(recipientWord))) == recipient, "wrong recipient");
        require(suppliedTokenId == tokenId, "wrong token id");

        (bool success,) = execution.target.call(callData);
        require(success, "mock mint failed");
        require(collection.ownerOf(tokenId) == recipient, "wrong minted owner");
    }

    function testRejectsWrongIntentEnvelope() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(adapter);

        intent.chainId = 1;
        VM.expectRevert(abi.encodeWithSelector(ZeroCostMintAdapterBase.WrongChain.selector, 1));
        adapter.buildExecution(intent, "");
        intent = _intent(adapter);

        intent.adapter = address(0xA11CE);
        VM.expectRevert(
            abi.encodeWithSelector(ZeroCostMintAdapterBase.WrongAdapter.selector, address(0xA11CE))
        );
        adapter.buildExecution(intent, "");
        intent = _intent(adapter);

        intent.venue = address(collection);
        VM.expectRevert(
            abi.encodeWithSelector(ZeroCostMintAdapterBase.WrongVenue.selector, address(collection))
        );
        adapter.buildExecution(intent, "");
        intent = _intent(adapter);

        intent.collection = address(venue);
        VM.expectRevert(
            abi.encodeWithSelector(ZeroCostMintAdapterBase.WrongCollection.selector, address(venue))
        );
        adapter.buildExecution(intent, "");
        intent = _intent(adapter);

        intent.assetStandard = GoghBrokerTypes.AssetStandard.ERC1155;
        VM.expectRevert(
            abi.encodeWithSelector(
                ZeroCostMintAdapterBase.WrongAssetStandard.selector,
                GoghBrokerTypes.AssetStandard.ERC1155
            )
        );
        adapter.buildExecution(intent, "");
        intent = _intent(adapter);

        intent.opportunityType = GoghBrokerTypes.OpportunityType.MINT;
        VM.expectRevert(
            abi.encodeWithSelector(
                ZeroCostMintAdapterBase.UnsupportedOpportunityType.selector,
                GoghBrokerTypes.OpportunityType.MINT
            )
        );
        adapter.buildExecution(intent, "");
    }

    function testRejectsZeroAccountAmountCurrencyPriceAndSlippage() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(adapter);

        intent.account = address(0);
        VM.expectRevert(ZeroCostMintAdapterBase.ZeroAccount.selector);
        adapter.buildExecution(intent, "");
        intent = _intent(adapter);

        intent.assetAmount = 2;
        VM.expectRevert(
            abi.encodeWithSelector(ZeroCostMintAdapterBase.InvalidAssetAmount.selector, 2)
        );
        adapter.buildExecution(intent, "");
        intent = _intent(adapter);

        intent.currency = address(collection);
        VM.expectRevert(
            abi.encodeWithSelector(
                ZeroCostMintAdapterBase.NonNativeCurrency.selector, address(collection)
            )
        );
        adapter.buildExecution(intent, "");
        intent = _intent(adapter);

        intent.expectedPrice = 1;
        VM.expectRevert(
            abi.encodeWithSelector(ZeroCostMintAdapterBase.NonZeroIntentPrice.selector, 1, 0)
        );
        adapter.buildExecution(intent, "");
        intent = _intent(adapter);

        intent.maxPrice = 1;
        VM.expectRevert(
            abi.encodeWithSelector(ZeroCostMintAdapterBase.NonZeroIntentPrice.selector, 0, 1)
        );
        adapter.buildExecution(intent, "");
        intent = _intent(adapter);

        intent.maxSlippageBps = 1;
        VM.expectRevert(
            abi.encodeWithSelector(ZeroCostMintAdapterBase.NonZeroSlippage.selector, uint16(1))
        );
        adapter.buildExecution(intent, "");
    }

    function testRejectsUnsupportedAdapterDataAndWrongCodeHash() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(adapter);
        VM.expectRevert(
            abi.encodeWithSelector(ZeroCostMintAdapterBase.UnsupportedAdapterData.selector, 1)
        );
        adapter.buildExecution(intent, hex"01");

        intent.adapterCodeHash = bytes32(uint256(1));
        VM.expectRevert(
            abi.encodeWithSelector(
                ZeroCostMintAdapterBase.AdapterCodeHashMismatch.selector,
                bytes32(uint256(1)),
                address(adapter).codehash
            )
        );
        adapter.buildExecution(intent, "");
    }

    function testRejectsAnySubclassExecutionWithFundsOrAllowance() public {
        _expectUnsafeFunds(MockZeroCostMintAdapter.Behavior.NONZERO_VALUE);
        _expectUnsafeFunds(MockZeroCostMintAdapter.Behavior.NON_NATIVE_CURRENCY);
        _expectUnsafeFunds(MockZeroCostMintAdapter.Behavior.ALLOWANCE_SPENDER);
        _expectUnsafeFunds(MockZeroCostMintAdapter.Behavior.ALLOWANCE_AMOUNT);
        _expectUnsafeFunds(MockZeroCostMintAdapter.Behavior.NONZERO_PAYMENT);
    }

    function testRejectsSubclassTargetSelectorRecipientAndShortCalldata() public {
        MockZeroCostMintAdapter unsafeAdapter =
            _newAdapter(MockZeroCostMintAdapter.Behavior.WRONG_TARGET);
        VM.expectRevert(
            abi.encodeWithSelector(
                ZeroCostMintAdapterBase.UnsafeExecutionTarget.selector, address(collection)
            )
        );
        unsafeAdapter.buildExecution(_intent(unsafeAdapter), "");

        unsafeAdapter = _newAdapter(MockZeroCostMintAdapter.Behavior.WRONG_SELECTOR);
        VM.expectRevert(
            abi.encodeWithSelector(
                ZeroCostMintAdapterBase.WrongMintSelector.selector,
                MockFreeMintVenue.otherMint.selector
            )
        );
        unsafeAdapter.buildExecution(_intent(unsafeAdapter), "");

        unsafeAdapter = _newAdapter(MockZeroCostMintAdapter.Behavior.DIRTY_RECIPIENT);
        bytes32 dirtyRecipient = bytes32(uint256(uint160(ACCOUNT)) | (uint256(1) << 160));
        VM.expectRevert(
            abi.encodeWithSelector(
                ZeroCostMintAdapterBase.NonCanonicalRecipientEncoding.selector, dirtyRecipient
            )
        );
        unsafeAdapter.buildExecution(_intent(unsafeAdapter), "");

        unsafeAdapter = _newAdapter(MockZeroCostMintAdapter.Behavior.WRONG_RECIPIENT);
        VM.expectRevert(
            abi.encodeWithSelector(
                ZeroCostMintAdapterBase.WrongMintRecipient.selector, address(0xBEEF), ACCOUNT
            )
        );
        unsafeAdapter.buildExecution(_intent(unsafeAdapter), "");

        unsafeAdapter = _newAdapter(MockZeroCostMintAdapter.Behavior.WRONG_TOKEN_ID);
        VM.expectRevert(
            abi.encodeWithSelector(
                ZeroCostMintAdapterBase.WrongMintTokenId.selector, TOKEN_ID + 1, TOKEN_ID
            )
        );
        unsafeAdapter.buildExecution(_intent(unsafeAdapter), "");

        unsafeAdapter = _newAdapter(MockZeroCostMintAdapter.Behavior.SHORT_CALLDATA);
        VM.expectRevert(
            abi.encodeWithSelector(ZeroCostMintAdapterBase.MalformedMintCalldata.selector, 4)
        );
        unsafeAdapter.buildExecution(_intent(unsafeAdapter), "");

        unsafeAdapter = _newAdapter(MockZeroCostMintAdapter.Behavior.TRAILING_CALLDATA);
        VM.expectRevert(
            abi.encodeWithSelector(ZeroCostMintAdapterBase.MalformedMintCalldata.selector, 100)
        );
        unsafeAdapter.buildExecution(_intent(unsafeAdapter), "");
    }

    function _expectUnsafeFunds(MockZeroCostMintAdapter.Behavior behavior) private {
        MockZeroCostMintAdapter unsafeAdapter = _newAdapter(behavior);
        uint256 value = behavior == MockZeroCostMintAdapter.Behavior.NONZERO_VALUE ? 1 : 0;
        address currency = behavior == MockZeroCostMintAdapter.Behavior.NON_NATIVE_CURRENCY
            ? address(collection)
            : address(0);
        address allowanceSpender = behavior == MockZeroCostMintAdapter.Behavior.ALLOWANCE_SPENDER
            ? address(venue)
            : address(0);
        uint256 allowanceAmount =
            behavior == MockZeroCostMintAdapter.Behavior.ALLOWANCE_AMOUNT ? 1 : 0;
        uint256 paymentAmount = behavior == MockZeroCostMintAdapter.Behavior.NONZERO_PAYMENT ? 1 : 0;
        VM.expectRevert(
            abi.encodeWithSelector(
                ZeroCostMintAdapterBase.UnsafeExecutionFunds.selector,
                value,
                currency,
                allowanceSpender,
                allowanceAmount,
                paymentAmount
            )
        );
        unsafeAdapter.buildExecution(_intent(unsafeAdapter), "");
    }

    function _newAdapter(MockZeroCostMintAdapter.Behavior behavior)
        private
        returns (MockZeroCostMintAdapter)
    {
        return new MockZeroCostMintAdapter(address(venue), address(collection), behavior);
    }

    function _intent(MockZeroCostMintAdapter targetAdapter)
        private
        view
        returns (GoghBrokerTypes.AcquisitionIntent memory intent)
    {
        intent = GoghBrokerTypes.AcquisitionIntent({
            account: ACCOUNT,
            chainId: 4663,
            expectedOwner: OWNER,
            nonce: 0,
            policyVersion: 1,
            opportunityType: GoghBrokerTypes.OpportunityType.FREE_MINT,
            assetStandard: GoghBrokerTypes.AssetStandard.ERC721,
            adapter: address(targetAdapter),
            venue: address(venue),
            collection: address(collection),
            tokenId: TOKEN_ID,
            assetAmount: 1,
            currency: address(0),
            expectedPrice: 0,
            maxPrice: 0,
            maxSlippageBps: 0,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 2 minutes),
            opportunityId: keccak256("mock-free-mint"),
            reasoningHash: keccak256("mock-reason"),
            adapterCodeHash: address(targetAdapter).codehash
        });
    }
}
