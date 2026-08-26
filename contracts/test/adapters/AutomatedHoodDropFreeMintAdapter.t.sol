// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghBrokerTypes } from "../../src/GoghBrokerTypes.sol";
import {
    AutomatedHoodDropFreeMintAdapter,
    IHoodDropControllerV2
} from "../../src/adapters/AutomatedHoodDropFreeMintAdapter.sol";

interface HoodDropAdapterVm {
    function chainId(uint256 newChainId) external;
    function etch(address target, bytes calldata code) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
}

contract MockHoodDropCollection {
    uint256 public minterMinted;
    uint256 public totalSupply = 41;
    uint256 public maxSupply = 100;

    function setStats(uint256 minterMinted_, uint256 totalSupply_, uint256 maxSupply_) external {
        minterMinted = minterMinted_;
        totalSupply = totalSupply_;
        maxSupply = maxSupply_;
    }

    function getMintStats(address) external view returns (uint256, uint256, uint256) {
        return (minterMinted, totalSupply, maxSupply);
    }
}

contract MockHoodDropController {
    uint256 public activeRoundId = 7;
    bool public paused;
    bool public allowlist;
    uint96 public mintPrice;
    uint32 public walletLimit = 2;
    uint256 public walletMints;

    function initializeMockState() external {
        activeRoundId = 7;
        walletLimit = 2;
    }

    function setUnsafe(bool paused_, bool allowlist_, uint96 mintPrice_) external {
        paused = paused_;
        allowlist = allowlist_;
        mintPrice = mintPrice_;
    }

    function setWalletMints(uint256 value) external {
        walletMints = value;
    }

    function currentRoundId(address) external view returns (uint256) {
        return activeRoundId;
    }

    function rounds(address, uint256)
        external
        view
        returns (uint256, address, uint32, bool, bool, bool)
    {
        return (90, address(0x1234), 1, true, true, paused);
    }

    function stages(address, uint256, uint32)
        external
        view
        returns (uint64, uint64, uint32, uint96, bytes32, bool, bool)
    {
        return (0, type(uint64).max, walletLimit, mintPrice, bytes32(0), allowlist, true);
    }

    function mintedByWallet(address, uint256, address) external view returns (uint256) {
        return walletMints;
    }

    function mint(address, uint256, uint32, uint256, bytes32[] calldata) external payable { }
}

contract AutomatedHoodDropFreeMintAdapterTest {
    HoodDropAdapterVm private constant VM =
        HoodDropAdapterVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CONTROLLER = 0x26B10b0c7C0f794375593f00222Fd960faC22F16;
    address private constant ACCOUNT = 0x2222222222222222222222222222222222222222;
    address private constant OWNER = 0x3333333333333333333333333333333333333333;

    MockHoodDropCollection private collection;
    MockHoodDropController private controller;
    AutomatedHoodDropFreeMintAdapter private adapter;

    function setUp() public {
        collection = new MockHoodDropCollection();
        MockHoodDropController deployed = new MockHoodDropController();
        VM.etch(CONTROLLER, address(deployed).code);
        controller = MockHoodDropController(CONTROLLER);
        controller.initializeMockState();
        VM.etch(ACCOUNT, hex"00");
        adapter = new AutomatedHoodDropFreeMintAdapter(
            address(collection), 7, 3, CONTROLLER.codehash, address(collection).codehash
        );
    }

    function testBuildsOnlyExactPublicZeroValueHoodDropCall() public view {
        GoghBrokerTypes.AdapterExecution memory execution = adapter.buildExecution(_intent(), "");
        bytes32[] memory emptyProof = new bytes32[](0);
        require(adapter.kind() == GoghBrokerTypes.AdapterKind.MINT, "kind");
        require(adapter.venue() == CONTROLLER, "venue");
        require(execution.target == CONTROLLER, "target");
        require(execution.value == 0 && execution.paymentAmount == 0, "payment");
        require(
            execution.allowanceSpender == address(0) && execution.allowanceAmount == 0, "approval"
        );
        require(
            keccak256(execution.callData)
                == keccak256(
                    abi.encodeCall(
                        IHoodDropControllerV2.mint,
                        (address(collection), uint256(7), uint32(3), uint256(1), emptyProof)
                    )
                ),
            "calldata"
        );
    }

    function testRejectsPaidPrivatePausedAndExhaustedStages() public {
        controller.setUnsafe(false, false, 1);
        VM.expectRevert(
            abi.encodeWithSelector(AutomatedHoodDropFreeMintAdapter.StageNotFree.selector, 1)
        );
        adapter.buildExecution(_intent(), "");

        controller.setUnsafe(false, true, 0);
        VM.expectRevert(AutomatedHoodDropFreeMintAdapter.StageNotPublic.selector);
        adapter.buildExecution(_intent(), "");

        controller.setUnsafe(true, false, 0);
        VM.expectRevert(AutomatedHoodDropFreeMintAdapter.RoundPaused.selector);
        adapter.buildExecution(_intent(), "");

        controller.setUnsafe(false, false, 0);
        controller.setWalletMints(2);
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedHoodDropFreeMintAdapter.WalletMintLimitReached.selector, 2, 2
            )
        );
        adapter.buildExecution(_intent(), "");
    }

    function testRejectsWrongTokenOpaqueDataAndRuntimeDrift() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent();
        intent.tokenId = 41;
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedHoodDropFreeMintAdapter.WrongNextTokenId.selector, 41, 42
            )
        );
        adapter.buildExecution(intent, "");

        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedHoodDropFreeMintAdapter.UnsupportedAdapterData.selector, 1
            )
        );
        adapter.buildExecution(_intent(), hex"01");

        VM.etch(address(collection), hex"60006000f3");
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedHoodDropFreeMintAdapter.InvalidPinnedHash.selector,
                address(collection),
                adapter.expectedCollectionRuntimeCodeHash(),
                address(collection).codehash
            )
        );
        adapter.buildExecution(_intent(), "");
    }

    function testRobinhoodDeploymentRequiresPublishedControllerHash() public {
        VM.chainId(4663);
        VM.expectRevert(
            abi.encodeWithSelector(
                AutomatedHoodDropFreeMintAdapter.UnexpectedProductionControllerHash.selector,
                CONTROLLER.codehash
            )
        );
        new AutomatedHoodDropFreeMintAdapter(
            address(collection), 7, 3, CONTROLLER.codehash, address(collection).codehash
        );
    }

    function _intent() private view returns (GoghBrokerTypes.AcquisitionIntent memory intent) {
        intent = GoghBrokerTypes.AcquisitionIntent({
            account: ACCOUNT,
            chainId: 4663,
            expectedOwner: OWNER,
            nonce: 0,
            policyVersion: 1,
            opportunityType: GoghBrokerTypes.OpportunityType.FREE_MINT,
            assetStandard: GoghBrokerTypes.AssetStandard.ERC721,
            adapter: address(adapter),
            venue: CONTROLLER,
            collection: address(collection),
            tokenId: 42,
            assetAmount: 1,
            currency: address(0),
            expectedPrice: 0,
            maxPrice: 0,
            maxSlippageBps: 0,
            createdAt: 1,
            expiresAt: type(uint64).max,
            opportunityId: keccak256("hooddrop-opportunity"),
            reasoningHash: keccak256("hooddrop-reasoning"),
            adapterCodeHash: address(adapter).codehash
        });
    }
}
