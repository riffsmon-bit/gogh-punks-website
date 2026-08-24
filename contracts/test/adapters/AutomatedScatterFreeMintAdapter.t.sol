// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghBrokerTypes } from "../../src/GoghBrokerTypes.sol";
import {
    AutomatedScatterFreeMintAdapter,
    IScatterArchetypeErc721A
} from "../../src/adapters/AutomatedScatterFreeMintAdapter.sol";

interface ScatterAdapterVm {
    function chainId(uint256 newChainId) external;
    function etch(address target, bytes calldata code) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
}

contract MockScatterArchetypeImplementation {
    uint128 private immutable _price;
    uint32 private immutable _walletLimit;
    uint32 private immutable _listMaximum;
    uint32 private immutable _unitSize;
    address private immutable _tokenAddress;
    bool private immutable _blacklist;
    uint256 private immutable _bonus;
    uint256 private immutable _minted;
    uint256 private immutable _listSupply;
    uint256 private immutable _totalSupply;
    uint32 private immutable _collectionMaximum;
    address private immutable _batch;

    constructor(
        uint128 price_,
        uint32 walletLimit_,
        uint32 listMaximum_,
        uint32 unitSize_,
        address tokenAddress_,
        bool blacklist_,
        uint256 bonus_,
        uint256 minted_,
        uint256 listSupply_,
        uint256 totalSupply_,
        uint32 collectionMaximum_,
        address batch_
    ) {
        _price = price_;
        _walletLimit = walletLimit_;
        _listMaximum = listMaximum_;
        _unitSize = unitSize_;
        _tokenAddress = tokenAddress_;
        _blacklist = blacklist_;
        _bonus = bonus_;
        _minted = minted_;
        _listSupply = listSupply_;
        _totalSupply = totalSupply_;
        _collectionMaximum = collectionMaximum_;
        _batch = batch_;
    }

    function archetypeAddresses()
        external
        view
        returns (IScatterArchetypeErc721A.ArchetypeAddresses memory)
    {
        return IScatterArchetypeErc721A.ArchetypeAddresses({
            platform: address(0x100), payouts: address(0x200), batch: _batch
        });
    }

    function config()
        external
        view
        returns (string memory, address, uint32, uint32, uint16, uint16, uint16)
    {
        return ("", address(0x300), _collectionMaximum, 1, 0, 0, 0);
    }

    function invites(bytes32)
        external
        view
        returns (
            uint128,
            uint128,
            uint128,
            uint32,
            uint32,
            uint32,
            uint32,
            uint32,
            uint32,
            address,
            bool
        )
    {
        return (
            _price,
            0,
            0,
            0,
            type(uint32).max,
            _walletLimit,
            _listMaximum,
            0,
            _unitSize,
            _tokenAddress,
            _blacklist
        );
    }

    function listSupply(bytes32) external view returns (uint256) {
        return _listSupply;
    }

    function minted(address, bytes32) external view returns (uint256) {
        return _minted;
    }

    function packedBonusDiscounts(bytes32) external view returns (uint256) {
        return _bonus;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function mint(IScatterArchetypeErc721A.Auth calldata, uint256, address, bytes calldata)
        external
        payable { }
}

contract AutomatedScatterFreeMintAdapterTest {
    ScatterAdapterVm private constant VM =
        ScatterAdapterVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant IMPLEMENTATION = 0xb195891c61c68bd518cbE66f176bed204A222b54;
    address private constant COLLECTION = 0x1111111111111111111111111111111111111111;
    address private constant ACCOUNT = 0x2222222222222222222222222222222222222222;
    address private constant OWNER = 0x3333333333333333333333333333333333333333;
    bytes32 private constant PUBLIC_KEY = bytes32(uint256(7));

    AutomatedScatterFreeMintAdapter private adapter;

    function setUp() public {
        _install(0, 1, 100, 1, address(0), false, 0, 0, 10, 41, 100, address(0x999));
        VM.etch(ACCOUNT, hex"00");
        adapter = _deploy(PUBLIC_KEY);
    }

    function testBuildsOnlyExactPublicZeroValueScatterCall() public view {
        GoghBrokerTypes.AdapterExecution memory execution = adapter.buildExecution(_intent(), "");
        bytes32[] memory emptyProof = new bytes32[](0);
        require(adapter.kind() == GoghBrokerTypes.AdapterKind.MINT, "kind");
        require(adapter.venue() == COLLECTION, "venue");
        require(execution.target == COLLECTION, "target");
        require(execution.value == 0, "value");
        require(execution.currency == address(0), "currency");
        require(execution.allowanceSpender == address(0), "spender");
        require(execution.allowanceAmount == 0, "allowance");
        require(execution.paymentAmount == 0, "payment");
        require(
            keccak256(execution.callData)
                == keccak256(
                    abi.encodeCall(
                        IScatterArchetypeErc721A.mint,
                        (
                            IScatterArchetypeErc721A.Auth({ key: PUBLIC_KEY, proof: emptyProof }),
                            uint256(1),
                            address(0),
                            bytes("")
                        )
                    )
                ),
            "calldata"
        );
    }

    function testRejectsPaidTokenBlacklistBonusAndUnitSizeLists() public {
        _expectUnsafeInvite(
            1, 1, address(0), false, 0, AutomatedScatterFreeMintAdapter.InviteNotFree.selector
        );
        _expectUnsafeInvite(
            0,
            1,
            address(0x4444),
            false,
            0,
            AutomatedScatterFreeMintAdapter.InviteNotPlainPublic.selector
        );
        _expectUnsafeInvite(
            0, 1, address(0), true, 0, AutomatedScatterFreeMintAdapter.InviteNotPlainPublic.selector
        );
        _expectUnsafeInvite(
            0,
            1,
            address(0),
            false,
            1,
            AutomatedScatterFreeMintAdapter.BonusMintsUnsupported.selector
        );
        _expectUnsafeInvite(
            0, 2, address(0), false, 0, AutomatedScatterFreeMintAdapter.UnitSizeUnsupported.selector
        );
    }

    function testRejectsExhaustedWalletListAndCollection() public {
        _install(0, 1, 100, 1, address(0), false, 0, 1, 10, 41, 100, address(0x999));
        AutomatedScatterFreeMintAdapter target = _deploy(PUBLIC_KEY);
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedScatterFreeMintAdapter.WalletMintLimitReached.selector, 1, 1
            )
        );
        target.buildExecution(_intentFor(target), "");

        _install(0, 2, 10, 1, address(0), false, 0, 0, 10, 41, 100, address(0x999));
        target = _deploy(PUBLIC_KEY);
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedScatterFreeMintAdapter.ListMaxSupplyReached.selector, 10, 10
            )
        );
        target.buildExecution(_intentFor(target), "");

        _install(0, 2, 100, 1, address(0), false, 0, 0, 10, 100, 100, address(0x999));
        target = _deploy(PUBLIC_KEY);
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedScatterFreeMintAdapter.CollectionSoldOut.selector, 100, 100
            )
        );
        target.buildExecution(_intentFor(target), "");
    }

    function testRejectsWrongTokenIdOpaqueDataAndBatchSenderCollision() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent();
        intent.tokenId = 41;
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedScatterFreeMintAdapter.WrongNextTokenId.selector, 41, 42
            )
        );
        adapter.buildExecution(intent, "");

        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedScatterFreeMintAdapter.UnsupportedAdapterData.selector, 1
            )
        );
        adapter.buildExecution(_intent(), hex"01");

        _install(0, 1, 100, 1, address(0), false, 0, 0, 10, 41, 100, ACCOUNT);
        AutomatedScatterFreeMintAdapter target = _deploy(PUBLIC_KEY);
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedScatterFreeMintAdapter.BatchSenderCollision.selector, ACCOUNT
            )
        );
        target.buildExecution(_intentFor(target), "");
    }

    function testRejectsNonPublicKeyAndRuntimeDrift() public {
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedScatterFreeMintAdapter.InviteKeyNotPublic.selector, bytes32(uint256(256))
            )
        );
        _deploy(bytes32(uint256(256)));

        VM.etch(COLLECTION, hex"60006000f3");
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedScatterFreeMintAdapter.InvalidCloneRuntime.selector,
                COLLECTION,
                COLLECTION.codehash
            )
        );
        adapter.buildExecution(_intent(), "");
    }

    function testRobinhoodDeploymentRequiresTheReviewedImplementationHash() public {
        VM.chainId(4663);
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedScatterFreeMintAdapter.UnexpectedProductionImplementationHash.selector,
                IMPLEMENTATION.codehash
            )
        );
        new AutomatedScatterFreeMintAdapter(COLLECTION, PUBLIC_KEY, IMPLEMENTATION.codehash);
    }

    function _expectUnsafeInvite(
        uint128 price,
        uint32 unitSize,
        address tokenAddress,
        bool blacklist,
        uint256 bonus,
        bytes4 selector
    ) private {
        _install(
            price, 1, 100, unitSize, tokenAddress, blacklist, bonus, 0, 10, 41, 100, address(0x999)
        );
        AutomatedScatterFreeMintAdapter target = _deploy(PUBLIC_KEY);
        bytes memory expected;
        if (selector == AutomatedScatterFreeMintAdapter.InviteNotFree.selector) {
            expected = abi.encodeWithSelector(selector, uint256(price), 0, 0, 0);
        } else if (selector == AutomatedScatterFreeMintAdapter.InviteNotPlainPublic.selector) {
            expected = abi.encodeWithSelector(selector, tokenAddress, blacklist);
        } else if (selector == AutomatedScatterFreeMintAdapter.BonusMintsUnsupported.selector) {
            expected = abi.encodeWithSelector(selector, bonus);
        } else {
            expected = abi.encodeWithSelector(selector, uint256(unitSize));
        }
        VM.expectRevert(expected);
        target.buildExecution(_intentFor(target), "");
    }

    function _install(
        uint128 price,
        uint32 walletLimit,
        uint32 listMaximum,
        uint32 unitSize,
        address tokenAddress,
        bool blacklist,
        uint256 bonus,
        uint256 minted,
        uint256 listSupply,
        uint256 totalSupply,
        uint32 collectionMaximum,
        address batch
    ) private {
        MockScatterArchetypeImplementation implementation = new MockScatterArchetypeImplementation(
            price,
            walletLimit,
            listMaximum,
            unitSize,
            tokenAddress,
            blacklist,
            bonus,
            minted,
            listSupply,
            totalSupply,
            collectionMaximum,
            batch
        );
        VM.etch(IMPLEMENTATION, address(implementation).code);
        VM.etch(COLLECTION, _cloneRuntime());
    }

    function _deploy(bytes32 key) private returns (AutomatedScatterFreeMintAdapter) {
        return new AutomatedScatterFreeMintAdapter(COLLECTION, key, IMPLEMENTATION.codehash);
    }

    function _cloneRuntime() private pure returns (bytes memory) {
        return abi.encodePacked(
            hex"363d3d373d3d3d363d73", IMPLEMENTATION, hex"5af43d82803e903d91602b57fd5bf3"
        );
    }

    function _intent() private view returns (GoghBrokerTypes.AcquisitionIntent memory) {
        return _intentFor(adapter);
    }

    function _intentFor(AutomatedScatterFreeMintAdapter target)
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
            adapter: address(target),
            venue: COLLECTION,
            collection: COLLECTION,
            tokenId: 42,
            assetAmount: 1,
            currency: address(0),
            expectedPrice: 0,
            maxPrice: 0,
            maxSlippageBps: 0,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 120),
            opportunityId: keccak256("scatter-opportunity"),
            reasoningHash: keccak256("scatter-reasoning"),
            adapterCodeHash: address(target).codehash
        });
    }
}
