// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghBrokerTypes } from "../../src/GoghBrokerTypes.sol";
import {
    IOpenSeaSeaDrop,
    OpenSeaSeaDropFreeMintAdapter
} from "../../src/adapters/OpenSeaSeaDropFreeMintAdapter.sol";

interface SeaDropAdapterVm {
    function etch(address target, bytes calldata code) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
}

contract MockPinnedSeaDrop {
    uint80 private immutable _price;
    bool private immutable _feeRecipientAllowed;

    constructor(uint80 price_, bool feeRecipientAllowed_) {
        _price = price_;
        _feeRecipientAllowed = feeRecipientAllowed_;
    }

    function getPublicDrop(address) external view returns (IOpenSeaSeaDrop.PublicDrop memory drop) {
        drop = IOpenSeaSeaDrop.PublicDrop({
            mintPrice: _price,
            startTime: 0,
            endTime: type(uint48).max,
            maxTotalMintableByWallet: 1,
            feeBps: 1000,
            restrictFeeRecipients: true
        });
    }

    function getFeeRecipientIsAllowed(address, address) external view returns (bool) {
        return _feeRecipientAllowed;
    }

    function mintPublic(address, address, address, uint256) external payable { }
}

contract MockPinnedCloneImplementation {
    function getMintStats(address)
        external
        pure
        returns (uint256 minterNumMinted, uint256 currentTotalMinted, uint256 maxSupply)
    {
        return (0, 41, 100);
    }
}

contract OpenSeaSeaDropFreeMintAdapterTest {
    SeaDropAdapterVm private constant VM =
        SeaDropAdapterVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant COLLECTION = 0x1111111111111111111111111111111111111111;
    address private constant ACCOUNT = 0x2222222222222222222222222222222222222222;
    address private constant OWNER = 0x3333333333333333333333333333333333333333;
    address private constant SEA_DROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;
    address private constant FEE_RECIPIENT = 0x0000a26b00c1F0DF003000390027140000fAa719;
    address private constant CLONE_IMPLEMENTATION = 0x09a26fC8FCEF18192E267D7A6da9dFb4be81Dd6A;

    OpenSeaSeaDropFreeMintAdapter private adapter;

    function setUp() public {
        _installSeaDrop(0, true);
        MockPinnedCloneImplementation implementation = new MockPinnedCloneImplementation();
        VM.etch(CLONE_IMPLEMENTATION, address(implementation).code);
        VM.etch(COLLECTION, _cloneRuntime());
        VM.etch(ACCOUNT, hex"00");
        adapter = _deploy();
    }

    function testBuildsExactZeroValueSeaDropCall() public view {
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent();
        GoghBrokerTypes.AdapterExecution memory execution = adapter.buildExecution(intent, "");

        require(adapter.kind() == GoghBrokerTypes.AdapterKind.MINT, "wrong kind");
        require(execution.target == SEA_DROP, "wrong target");
        require(execution.value == 0, "value");
        require(execution.currency == address(0), "currency");
        require(execution.allowanceSpender == address(0), "spender");
        require(execution.allowanceAmount == 0, "allowance");
        require(execution.paymentAmount == 0, "payment");
        require(
            keccak256(execution.callData)
                == keccak256(
                    abi.encodeCall(
                        IOpenSeaSeaDrop.mintPublic,
                        (COLLECTION, FEE_RECIPIENT, address(0), uint256(1))
                    )
                ),
            "calldata"
        );
    }

    function testRejectsWrongPredictedTokenIdAndOpaqueData() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent();
        intent.tokenId = 43;
        VM.expectRevert(
            abi.encodeWithSelector(OpenSeaSeaDropFreeMintAdapter.WrongNextTokenId.selector, 43, 42)
        );
        adapter.buildExecution(intent, "");

        intent = _intent();
        VM.expectRevert(
            abi.encodeWithSelector(OpenSeaSeaDropFreeMintAdapter.UnsupportedAdapterData.selector, 1)
        );
        adapter.buildExecution(intent, hex"01");
    }

    function testRejectsPaidDropAndUnapprovedFeeRecipient() public {
        _installSeaDrop(1, true);
        OpenSeaSeaDropFreeMintAdapter paidAdapter = _deploy();
        GoghBrokerTypes.AcquisitionIntent memory intent = _intentFor(paidAdapter);
        VM.expectRevert(
            abi.encodeWithSelector(OpenSeaSeaDropFreeMintAdapter.PublicDropNotFree.selector, 1)
        );
        paidAdapter.buildExecution(intent, "");

        _installSeaDrop(0, false);
        OpenSeaSeaDropFreeMintAdapter disallowedAdapter = _deploy();
        intent = _intentFor(disallowedAdapter);
        VM.expectRevert(OpenSeaSeaDropFreeMintAdapter.FeeRecipientNotAllowed.selector);
        disallowedAdapter.buildExecution(intent, "");
    }

    function testRejectsCodeDriftAndNonCanonicalCollectionRuntime() public {
        VM.etch(COLLECTION, hex"60006000f3");
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent();
        VM.expectRevert(
            abi.encodeWithSelector(
                OpenSeaSeaDropFreeMintAdapter.CodeHashMismatch.selector,
                COLLECTION,
                adapter.expectedCollectionCodeHash(),
                COLLECTION.codehash
            )
        );
        adapter.buildExecution(intent, "");

        VM.expectRevert(
            abi.encodeWithSelector(
                OpenSeaSeaDropFreeMintAdapter.InvalidCloneRuntime.selector, COLLECTION
            )
        );
        new OpenSeaSeaDropFreeMintAdapter(
            COLLECTION,
            ACCOUNT,
            SEA_DROP.codehash,
            COLLECTION.codehash,
            CLONE_IMPLEMENTATION.codehash
        );
    }

    function _deploy() private returns (OpenSeaSeaDropFreeMintAdapter) {
        return new OpenSeaSeaDropFreeMintAdapter(
            COLLECTION,
            ACCOUNT,
            SEA_DROP.codehash,
            COLLECTION.codehash,
            CLONE_IMPLEMENTATION.codehash
        );
    }

    function _installSeaDrop(uint80 price, bool feeRecipientAllowed) private {
        MockPinnedSeaDrop seaDrop = new MockPinnedSeaDrop(price, feeRecipientAllowed);
        VM.etch(SEA_DROP, address(seaDrop).code);
    }

    function _cloneRuntime() private pure returns (bytes memory) {
        return abi.encodePacked(
            hex"363d3d373d3d3d363d73", CLONE_IMPLEMENTATION, hex"5af43d82803e903d91602b57fd5bf3"
        );
    }

    function _intent() private view returns (GoghBrokerTypes.AcquisitionIntent memory) {
        return _intentFor(adapter);
    }

    function _intentFor(OpenSeaSeaDropFreeMintAdapter targetAdapter)
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
            venue: SEA_DROP,
            collection: COLLECTION,
            tokenId: 42,
            assetAmount: 1,
            currency: address(0),
            expectedPrice: 0,
            maxPrice: 0,
            maxSlippageBps: 0,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 120),
            opportunityId: keccak256("opportunity"),
            reasoningHash: keccak256("reasoning"),
            adapterCodeHash: address(targetAdapter).codehash
        });
    }
}
