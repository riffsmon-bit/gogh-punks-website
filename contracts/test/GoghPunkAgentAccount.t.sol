// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { ArtAdapterRegistry } from "../src/ArtAdapterRegistry.sol";
import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import { GoghPunkAgentAccountRegistry } from "../src/GoghPunkAgentAccountRegistry.sol";
import { GoghPunkAgentAccount } from "../src/GoghPunkAgentAccount.sol";
import {
    IAccountV08,
    IEntryPointV08,
    PackedUserOperation
} from "../src/interfaces/IEntryPointV08.sol";
import { IGoghMarketplaceAdapter } from "../src/interfaces/IGoghMarketplaceAdapter.sol";
import {
    ERC6551RegistryHarness,
    MockCanonicalGoghPunks,
    TestVm
} from "./mocks/TestInfrastructure.sol";

contract AgentAccountMockCollection {
    address public immutable venue;
    mapping(uint256 tokenId => address tokenOwner) private _owners;

    constructor(address venue_) {
        venue = venue_;
    }

    function mint(address recipient, uint256 tokenId) external {
        require(msg.sender == venue && recipient != address(0) && _owners[tokenId] == address(0));
        _owners[tokenId] = recipient;
    }

    function ownerOf(uint256 tokenId) external view returns (address tokenOwner) {
        tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0));
    }
}

contract AgentAccountMockVenue {
    function mint(address collection, address recipient, uint256 tokenId) external {
        AgentAccountMockCollection(collection).mint(recipient, tokenId);
    }
}

contract AgentAccountMockFreeMintAdapter is IGoghMarketplaceAdapter {
    address public immutable mintVenue;

    constructor(address venue_) {
        mintVenue = venue_;
    }

    function kind() external pure returns (GoghBrokerTypes.AdapterKind) {
        return GoghBrokerTypes.AdapterKind.MINT;
    }

    function venue() external view returns (address) {
        return mintVenue;
    }

    function buildExecution(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        bytes calldata adapterData
    ) external view returns (GoghBrokerTypes.AdapterExecution memory execution) {
        require(intent.adapter == address(this) && intent.venue == mintVenue);
        require(intent.opportunityType == GoghBrokerTypes.OpportunityType.FREE_MINT);
        require(intent.assetStandard == GoghBrokerTypes.AssetStandard.ERC721);
        require(intent.assetAmount == 1 && intent.currency == address(0));
        require(intent.expectedPrice == 0 && intent.maxPrice == 0 && intent.maxSlippageBps == 0);
        require(adapterData.length == 0 && intent.adapterCodeHash == address(this).codehash);
        execution.target = mintVenue;
        execution.callData = abi.encodeCall(
            AgentAccountMockVenue.mint, (intent.collection, intent.account, intent.tokenId)
        );
    }
}

contract AgentAccountMockEntryPoint is IEntryPointV08 {
    mapping(address account => uint256 amount) public deposits;

    receive() external payable {
        deposits[msg.sender] += msg.value;
    }

    function depositTo(address account) external payable {
        deposits[account] += msg.value;
    }

    function balanceOf(address account) external view returns (uint256) {
        return deposits[account];
    }

    function withdrawTo(address payable recipient, uint256 amount) external {
        deposits[msg.sender] -= amount;
        (bool success,) = recipient.call{ value: amount }("");
        require(success);
    }

    function validate(
        IAccountV08 account,
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256) {
        return account.validateUserOp(userOp, userOpHash, missingAccountFunds);
    }

    function execute(address account, bytes calldata callData)
        external
        returns (bytes memory result)
    {
        bool success;
        (success, result) = account.call(callData);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
    }
}

contract GoghPunkAgentAccountTest {
    using MessageHashUtils for bytes32;

    TestVm private constant VM = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant GOGH_PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address private constant ERC6551_REGISTRY = 0x000000006551c19487814612e58FE06813775758;
    address private constant ENTRY_POINT = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;
    uint256 private constant PUNK_ID = 93;
    uint256 private constant OWNER_KEY = 0xA11CE;
    uint256 private constant SESSION_KEY = 0x5E5510;
    uint256 private constant WRONG_KEY = 0xBAD;

    address private owner;
    address private sessionSigner;
    address private guardian = address(0x600D);
    AgentAccountMockEntryPoint private entryPoint;
    ArtAdapterRegistry private adapters;
    AgentAccountMockVenue private venue;
    AgentAccountMockCollection private collection;
    AgentAccountMockFreeMintAdapter private adapter;
    GoghPunkAgentAccountRegistry private registry;
    GoghPunkAgentAccount private account;

    function setUp() public {
        VM.chainId(4663);
        VM.warp(1_800_000_000);
        owner = VM.addr(OWNER_KEY);
        sessionSigner = VM.addr(SESSION_KEY);

        MockCanonicalGoghPunks punkTemplate = new MockCanonicalGoghPunks();
        VM.etch(GOGH_PUNKS, address(punkTemplate).code);
        ERC6551RegistryHarness registryTemplate = new ERC6551RegistryHarness();
        VM.etch(ERC6551_REGISTRY, address(registryTemplate).code);
        MockCanonicalGoghPunks(GOGH_PUNKS).mint(owner, PUNK_ID);

        AgentAccountMockEntryPoint entryPointTemplate = new AgentAccountMockEntryPoint();
        VM.etch(ENTRY_POINT, address(entryPointTemplate).code);
        entryPoint = AgentAccountMockEntryPoint(payable(ENTRY_POINT));
        adapters = new ArtAdapterRegistry(guardian);
        venue = new AgentAccountMockVenue();
        collection = new AgentAccountMockCollection(address(venue));
        adapter = new AgentAccountMockFreeMintAdapter(address(venue));
        VM.prank(guardian);
        adapters.registerAdapter(
            address(adapter),
            GoghBrokerTypes.AdapterKind.MINT,
            address(venue),
            keccak256("punk-agent-account-test-adapter"),
            keccak256("free-only")
        );

        GoghPunkAgentAccount implementation =
            new GoghPunkAgentAccount(address(entryPoint), address(adapters));
        registry = new GoghPunkAgentAccountRegistry(address(implementation), bytes32(0));
        VM.prank(owner);
        account = GoghPunkAgentAccount(payable(registry.createAccount(PUNK_ID)));
        VM.deal(address(account), 1 ether);
        _configureSession(2, 2, 0.01 ether, 0.5 ether);
    }

    function testOwnerApprovesSessionAndSessionKeyMintsThroughEntryPoint() public {
        (PackedUserOperation memory userOp, bytes32 userOpHash) = _signedUserOp(_intent(1));

        uint256 validationData = entryPoint.validate(account, userOp, userOpHash, 0.001 ether);
        require(validationData != 1, "session signature accepted");
        require(entryPoint.balanceOf(address(account)) == 0.001 ether, "Punk funded EntryPoint");
        require(address(account).balance == 0.999 ether, "funded from Punk ETH");

        entryPoint.execute(address(account), userOp.callData);
        require(collection.ownerOf(1) == address(account), "Punk account owns mint");
        require(account.acquisitionNonce() == 1, "nonce consumed");
        require(account.autonomousSession().remainingMints == 1, "mission cap consumed");
    }

    function testWrongSessionSignatureReturnsValidationFailureWithoutFunding() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(1);
        PackedUserOperation memory userOp = _userOp(intent);
        bytes32 userOpHash = keccak256("wrong-session-key");
        userOp.signature = _sign(WRONG_KEY, userOpHash.toEthSignedMessageHash());

        uint256 validationData = entryPoint.validate(account, userOp, userOpHash, 0.001 ether);
        require(validationData == 1, "signature rejected");
        require(entryPoint.balanceOf(address(account)) == 0, "no prefund on bad signature");
    }

    function testMalformedSessionSignatureReturnsValidationFailureWithoutReverting() public {
        PackedUserOperation memory userOp = _userOp(_intent(1));
        userOp.signature = hex"1234";

        uint256 validationData = entryPoint.validate(account, userOp, keccak256("malformed"), 0);
        require(validationData == 1, "malformed signature rejected");
    }

    function testArbitraryUserOperationSelectorIsRejected() public {
        (PackedUserOperation memory userOp, bytes32 userOpHash) = _signedUserOp(_intent(1));
        userOp.callData = abi.encodeCall(account.revokeAutonomousSession, ());

        VM.expectRevert(GoghPunkAgentAccount.InvalidUserOperation.selector);
        entryPoint.validate(account, userOp, userOpHash, 0);
    }

    function testPaidIntentCannotValidateOrExecute() public {
        GoghBrokerTypes.AcquisitionIntent memory intent = _intent(1);
        intent.expectedPrice = 1;
        intent.maxPrice = 1;
        (PackedUserOperation memory userOp, bytes32 userOpHash) = _signedUserOp(intent);

        VM.expectRevert(GoghPunkAgentAccount.InvalidIntent.selector);
        entryPoint.validate(account, userOp, userOpHash, 0);
        VM.expectRevert(GoghPunkAgentAccount.InvalidIntent.selector);
        entryPoint.execute(address(account), userOp.callData);
    }

    function testGasCeilingAndProtectedReserveAreEnforced() public {
        _configureSession(2, 2, 0.0001 ether, 0.9999 ether);
        (PackedUserOperation memory userOp, bytes32 userOpHash) = _signedUserOp(_intent(1));

        VM.expectRevert(
            abi.encodeWithSelector(
                GoghPunkAgentAccount.SessionGasLimitExceeded.selector,
                uint256(0.0001 ether),
                uint256(0.0003 ether)
            )
        );
        entryPoint.validate(account, userOp, userOpHash, 0);

        _configureSession(2, 2, 0.01 ether, 0.9999 ether);
        (userOp, userOpHash) = _signedUserOp(_intent(1));
        VM.expectRevert(
            abi.encodeWithSelector(
                GoghPunkAgentAccount.ProtectedReserveViolation.selector,
                uint256(1 ether),
                uint256(0.9999 ether)
            )
        );
        entryPoint.validate(account, userOp, userOpHash, 0.001 ether);
    }

    function testPunkTransferImmediatelyInvalidatesSession() public {
        address nextOwner = VM.addr(0xB0B);
        VM.prank(owner);
        MockCanonicalGoghPunks(GOGH_PUNKS).transferFrom(owner, nextOwner, PUNK_ID);
        require(!account.isAutonomousSessionActive(), "old owner session inactive");

        (PackedUserOperation memory userOp, bytes32 userOpHash) =
            _signedUserOp(_intentFor(1, nextOwner));
        VM.expectRevert(GoghPunkAgentAccount.InvalidIntent.selector);
        entryPoint.validate(account, userOp, userOpHash, 0);
    }

    function testDailyAndMissionLimitsStopFurtherMints() public {
        _configureSession(1, 1, 0.01 ether, 0);
        (PackedUserOperation memory userOp, bytes32 userOpHash) = _signedUserOp(_intent(1));
        entryPoint.validate(account, userOp, userOpHash, 0);
        entryPoint.execute(address(account), userOp.callData);

        PackedUserOperation memory second = _userOp(_intent(2));
        VM.expectRevert(GoghPunkAgentAccount.InvalidIntent.selector);
        entryPoint.validate(account, second, keccak256("second"), 0);
    }

    function testOwnerCanManageEntryPointDepositAndRegistryReportsAgentAccount() public {
        VM.deal(owner, 1 ether);
        VM.prank(owner);
        account.depositToEntryPoint{ value: 0.1 ether }();
        require(account.entryPointDeposit() == 0.1 ether, "deposit recorded");
        uint256 beforeBalance = owner.balance;
        VM.prank(owner);
        account.withdrawEntryPointDeposit(0.04 ether);
        require(owner.balance == beforeBalance + 0.04 ether, "withdrawn to current owner");
        require(registry.implementationForVersion(4) != address(0), "version four");
    }

    function testImplementationPinsCanonicalEntryPoint() public {
        VM.expectRevert(GoghPunkAgentAccount.InvalidTarget.selector);
        new GoghPunkAgentAccount(address(venue), address(adapters));
    }

    function _configureSession(uint32 perDay, uint32 total, uint256 maxGas, uint256 reserve)
        private
    {
        GoghPunkAgentAccount.AutonomousSessionConfig memory config =
            GoghPunkAgentAccount.AutonomousSessionConfig({
                sessionKey: sessionSigner,
                adapter: address(adapter),
                venue: address(venue),
                adapterCodeHash: address(adapter).codehash,
                targetCollection: address(0),
                validAfter: uint48(block.timestamp),
                validUntil: uint48(block.timestamp + 7 days),
                maxMintsPerDay: perDay,
                maxMintsTotal: total,
                maxGasCostWei: maxGas,
                minimumNativeReserveWei: reserve
            });
        VM.prank(owner);
        account.configureAutonomousSession(config);
    }

    function _intent(uint256 tokenId)
        private
        view
        returns (GoghBrokerTypes.AcquisitionIntent memory)
    {
        return _intentFor(tokenId, owner);
    }

    function _intentFor(uint256 tokenId, address expectedOwner)
        private
        view
        returns (GoghBrokerTypes.AcquisitionIntent memory intent)
    {
        intent = GoghBrokerTypes.AcquisitionIntent({
            account: address(account),
            chainId: 4663,
            expectedOwner: expectedOwner,
            nonce: account.acquisitionNonce(),
            policyVersion: account.sessionGeneration(),
            opportunityType: GoghBrokerTypes.OpportunityType.FREE_MINT,
            assetStandard: GoghBrokerTypes.AssetStandard.ERC721,
            adapter: address(adapter),
            venue: address(venue),
            collection: address(collection),
            tokenId: tokenId,
            assetAmount: 1,
            currency: address(0),
            expectedPrice: 0,
            maxPrice: 0,
            maxSlippageBps: 0,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 5 minutes),
            opportunityId: keccak256(abi.encode("agent-account-opportunity", tokenId)),
            reasoningHash: keccak256(abi.encode("screened-free-mint", tokenId)),
            adapterCodeHash: address(adapter).codehash
        });
    }

    function _userOp(GoghBrokerTypes.AcquisitionIntent memory intent)
        private
        view
        returns (PackedUserOperation memory userOp)
    {
        userOp.sender = address(account);
        userOp.nonce = intent.nonce;
        userOp.callData = abi.encodeCall(account.executeSessionAcquisition, (intent, bytes("")));
        userOp.accountGasLimits = bytes32((uint256(100_000) << 128) | uint256(150_000));
        userOp.preVerificationGas = 50_000;
        userOp.gasFees = bytes32(uint256(1 gwei));
    }

    function _signedUserOp(GoghBrokerTypes.AcquisitionIntent memory intent)
        private
        returns (PackedUserOperation memory userOp, bytes32 userOpHash)
    {
        userOp = _userOp(intent);
        userOpHash = keccak256(abi.encode(intent.opportunityId, intent.nonce, block.timestamp));
        userOp.signature = _sign(SESSION_KEY, userOpHash.toEthSignedMessageHash());
    }

    function _sign(uint256 privateKey, bytes32 digest) private returns (bytes memory signature) {
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
        require(ECDSA.recover(digest, signature) == VM.addr(privateKey));
    }
}
