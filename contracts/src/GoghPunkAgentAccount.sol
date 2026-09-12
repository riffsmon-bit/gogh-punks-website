// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { IERC1155Receiver } from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { GoghBrokerTypes } from "./GoghBrokerTypes.sol";
import { IArtAdapterRegistry } from "./interfaces/IArtAdapterRegistry.sol";
import { IGoghMarketplaceAdapter } from "./interfaces/IGoghMarketplaceAdapter.sol";
import { IAccountV08, IEntryPointV08, PackedUserOperation } from "./interfaces/IEntryPointV08.sol";
import {
    IERC6551Account,
    IERC6551Executable,
    IGoghAccountBatch
} from "./interfaces/IGoghAccountStandards.sol";

/// @title GoghPunkAgentAccount
/// @notice ERC-6551 Punk account with a narrowly scoped ERC-4337 autonomous mint session.
/// @dev The live Punk owner retains recovery authority. A session key can only execute a
///      quantity-one, zero-price ERC-721 mint through one owner-approved registered adapter.
contract GoghPunkAgentAccount is
    IERC165,
    IERC1271,
    IERC6551Account,
    IERC6551Executable,
    IGoghAccountBatch,
    IERC721Receiver,
    IERC1155Receiver,
    IAccountV08
{
    using SafeERC20 for IERC20;
    using MessageHashUtils for bytes32;

    struct AutonomousSessionConfig {
        address sessionKey;
        address adapter;
        address venue;
        bytes32 adapterCodeHash;
        address targetCollection;
        uint48 validAfter;
        uint48 validUntil;
        uint32 maxMintsPerDay;
        uint32 maxMintsTotal;
        uint256 maxGasCostWei;
        uint256 minimumNativeReserveWei;
    }

    struct AutonomousSession {
        address sessionKey;
        address authorizingOwner;
        address adapter;
        address venue;
        bytes32 adapterCodeHash;
        address targetCollection;
        uint48 validAfter;
        uint48 validUntil;
        uint32 maxMintsPerDay;
        uint32 remainingMints;
        uint32 mintsToday;
        uint32 day;
        uint64 generation;
        uint256 maxGasCostWei;
        uint256 minimumNativeReserveWei;
    }

    uint8 public constant CALL_OPERATION = 0;
    uint256 public constant MAX_BATCH_CALLS = 32;
    uint256 public constant MAX_OWNER_RESOLUTION_DEPTH = 8;
    uint256 public constant MAX_SESSION_DURATION = 30 days;
    uint256 public constant MAX_INTENT_AGE = 15 minutes;
    uint256 public constant MAX_SESSION_MINTS = 100;
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    uint256 private constant SIG_VALIDATION_FAILED = 1;
    address public constant GOGH_PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address public constant ENTRY_POINT_V08 = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;

    bytes4 private constant APPROVE_SELECTOR = IERC20.approve.selector;
    bytes4 private constant SET_APPROVAL_FOR_ALL_SELECTOR = IERC721.setApprovalForAll.selector;
    bytes4 private constant INCREASE_ALLOWANCE_SELECTOR =
        bytes4(keccak256("increaseAllowance(address,uint256)"));
    bytes4 private constant DECREASE_ALLOWANCE_SELECTOR =
        bytes4(keccak256("decreaseAllowance(address,uint256)"));
    bytes4 private constant TRANSFER_FROM_SELECTOR =
        bytes4(keccak256("transferFrom(address,address,uint256)"));
    bytes4 private constant SAFE_TRANSFER_FROM_SELECTOR =
        bytes4(keccak256("safeTransferFrom(address,address,uint256)"));
    bytes4 private constant SAFE_TRANSFER_FROM_DATA_SELECTOR =
        bytes4(keccak256("safeTransferFrom(address,address,uint256,bytes)"));

    address private immutable _implementation;
    IEntryPointV08 public immutable entryPoint;
    IArtAdapterRegistry public immutable adapterRegistry;

    uint256 public override state;
    uint256 public acquisitionNonce;
    uint64 public sessionGeneration;
    uint256 private _executionStatus;
    AutonomousSession private _session;

    error DirectImplementationCall();
    error WrongDeploymentChain(uint256 expected, uint256 actual);
    error ZeroAddress();
    error InvalidContract(address target);
    error NotAuthorized(address caller, address currentOwner);
    error NotEntryPoint(address caller);
    error UnsupportedOperation(uint8 operation);
    error InvalidTarget();
    error EmptyBatch();
    error BatchTooLarge(uint256 supplied, uint256 maximum);
    error ReentrantExecution();
    error InvalidSession();
    error SessionInactive();
    error InvalidUserOperation();
    error SessionGasLimitExceeded(uint256 maximum, uint256 supplied);
    error ProtectedReserveViolation(uint256 balance, uint256 required);
    error EntryPointFundingFailed();
    error AdapterExecutionInvalid();
    error InvalidIntent();
    error InvalidIntentNonce(uint256 expected, uint256 supplied);
    error AssetAlreadyOwned(address collection, uint256 tokenId);
    error AcquisitionPostconditionFailed(address collection, uint256 tokenId);
    error ControllingCollectionNesting(address collection, uint256 tokenId);
    error ControllingTokenSelfTransfer(uint256 tokenId);
    error PersistentApprovalForbidden(bytes4 selector);

    event NativeReceived(address indexed sender, uint256 amount, uint256 indexed state);
    event Executed(
        address indexed executor,
        address indexed target,
        uint256 value,
        bytes4 indexed selector,
        uint256 state
    );
    event BatchExecuted(address indexed executor, uint256 callCount, uint256 indexed state);
    event AutonomousSessionConfigured(
        uint64 indexed generation,
        address indexed owner,
        address indexed sessionKey,
        address adapter,
        address venue,
        address targetCollection,
        uint32 maxMintsPerDay,
        uint32 maxMintsTotal,
        uint48 validAfter,
        uint48 validUntil,
        uint256 maxGasCostWei,
        uint256 minimumNativeReserveWei
    );
    event AutonomousSessionRevoked(uint64 indexed generation, address indexed owner);
    event SessionAcquisitionExecuted(
        uint64 indexed generation,
        bytes32 indexed opportunityId,
        address indexed collection,
        uint256 tokenId,
        uint256 nonce,
        uint32 remainingMints,
        uint256 state
    );
    event EntryPointDepositAdded(address indexed owner, uint256 amount);
    event EntryPointDepositWithdrawn(address indexed owner, uint256 amount);

    modifier onlyAccount() {
        if (address(this) == _implementation) revert DirectImplementationCall();
        _;
    }

    modifier onlyTokenOwner() {
        if (address(this) == _implementation) revert DirectImplementationCall();
        address currentOwner = owner();
        if (currentOwner == address(0) || msg.sender != currentOwner) {
            revert NotAuthorized(msg.sender, currentOwner);
        }
        _;
    }

    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) revert NotEntryPoint(msg.sender);
        _;
    }

    modifier nonReentrantExecution() {
        if (_executionStatus == 2) revert ReentrantExecution();
        _executionStatus = 2;
        _;
        _executionStatus = 1;
    }

    constructor(address entryPoint_, address adapterRegistry_) {
        if (block.chainid != ROBINHOOD_CHAIN_ID) {
            revert WrongDeploymentChain(ROBINHOOD_CHAIN_ID, block.chainid);
        }
        if (entryPoint_ != ENTRY_POINT_V08 || adapterRegistry_ == address(0)) {
            revert InvalidTarget();
        }
        if (entryPoint_.code.length == 0) revert InvalidContract(entryPoint_);
        if (adapterRegistry_.code.length == 0) revert InvalidContract(adapterRegistry_);
        _implementation = address(this);
        entryPoint = IEntryPointV08(entryPoint_);
        adapterRegistry = IArtAdapterRegistry(adapterRegistry_);
    }

    receive() external payable override onlyAccount {
        uint256 nextState = _incrementState();
        emit NativeReceived(msg.sender, msg.value, nextState);
    }

    function token()
        public
        view
        override
        onlyAccount
        returns (uint256 chainId, address tokenContract, uint256 tokenId)
    {
        bytes memory footer = new bytes(0x60);
        assembly ("memory-safe") {
            extcodecopy(address(), add(footer, 0x20), 0x4d, 0x60)
        }
        return abi.decode(footer, (uint256, address, uint256));
    }

    function isCanonicalGoghPunkAccount() public view returns (bool) {
        if (address(this) == _implementation) return false;
        (uint256 chainId, address tokenContract,) = token();
        return
            chainId == ROBINHOOD_CHAIN_ID && chainId == block.chainid && tokenContract == GOGH_PUNKS;
    }

    function owner() public view virtual returns (address currentOwner) {
        if (!isCanonicalGoghPunkAccount()) return address(0);
        (, address tokenContract, uint256 tokenId) = token();
        try IERC721(tokenContract).ownerOf(tokenId) returns (address tokenOwner) {
            if (!_ownershipCycleOrExcessiveDepth(tokenOwner)) currentOwner = tokenOwner;
        } catch { }
    }

    function autonomousSession() external view returns (AutonomousSession memory) {
        return _session;
    }

    function isAutonomousSessionActive() public view virtual returns (bool) {
        AutonomousSession memory session = _session;
        address currentOwner = owner();
        return currentOwner != address(0) && session.sessionKey != address(0)
            && session.sessionKey.code.length == 0 && session.authorizingOwner == currentOwner
            && session.remainingMints != 0 && block.timestamp >= session.validAfter
            && block.timestamp <= session.validUntil;
    }

    function configureAutonomousSession(AutonomousSessionConfig calldata config)
        public
        virtual
        onlyTokenOwner
    {
        if (
            config.sessionKey == address(0) || config.sessionKey == msg.sender
                || config.sessionKey == address(this) || config.sessionKey == address(entryPoint)
                || config.sessionKey.code.length != 0 || config.adapter == address(0)
                || config.venue == address(0) || config.adapterCodeHash == bytes32(0)
                || config.validUntil <= block.timestamp || config.validAfter > config.validUntil
                || config.validUntil > block.timestamp + MAX_SESSION_DURATION
                || config.maxMintsPerDay == 0 || config.maxMintsTotal == 0
                || config.maxMintsPerDay > config.maxMintsTotal
                || config.maxMintsTotal > MAX_SESSION_MINTS || config.maxGasCostWei == 0
        ) revert InvalidSession();
        if (!adapterRegistry.validateAdapter(
                config.adapter,
                GoghBrokerTypes.AdapterKind.MINT,
                config.venue,
                config.adapterCodeHash
            )) revert AdapterExecutionInvalid();
        if (config.targetCollection != address(0) && config.targetCollection.code.length == 0) {
            revert InvalidContract(config.targetCollection);
        }

        uint64 generation = ++sessionGeneration;
        _session = AutonomousSession({
            sessionKey: config.sessionKey,
            authorizingOwner: msg.sender,
            adapter: config.adapter,
            venue: config.venue,
            adapterCodeHash: config.adapterCodeHash,
            targetCollection: config.targetCollection,
            validAfter: config.validAfter,
            validUntil: config.validUntil,
            maxMintsPerDay: config.maxMintsPerDay,
            remainingMints: config.maxMintsTotal,
            mintsToday: 0,
            day: uint32(block.timestamp / 1 days),
            generation: generation,
            maxGasCostWei: config.maxGasCostWei,
            minimumNativeReserveWei: config.minimumNativeReserveWei
        });
        emit AutonomousSessionConfigured(
            generation,
            msg.sender,
            config.sessionKey,
            config.adapter,
            config.venue,
            config.targetCollection,
            config.maxMintsPerDay,
            config.maxMintsTotal,
            config.validAfter,
            config.validUntil,
            config.maxGasCostWei,
            config.minimumNativeReserveWei
        );
    }

    function revokeAutonomousSession() external onlyTokenOwner {
        uint64 generation = ++sessionGeneration;
        delete _session;
        emit AutonomousSessionRevoked(generation, msg.sender);
    }

    /// @notice ERC-4337 validation. Only the approved session-mint selector is accepted.
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external override onlyAccount onlyEntryPoint returns (uint256 validationData) {
        if (
            userOp.sender != address(this) || userOp.initCode.length != 0
                || userOp.paymasterAndData.length != 0
                || _selector(userOp.callData) != this.executeSessionAcquisition.selector
        ) revert InvalidUserOperation();

        (GoghBrokerTypes.AcquisitionIntent memory intent, bytes memory adapterData) =
            abi.decode(userOp.callData[4:], (GoghBrokerTypes.AcquisitionIntent, bytes));
        _validateSessionIntent(intent, adapterData);

        AutonomousSession memory session = _session;
        uint256 maximumGasCost = _maximumUserOpGasCost(userOp);
        if (maximumGasCost > session.maxGasCostWei) {
            revert SessionGasLimitExceeded(session.maxGasCostWei, maximumGasCost);
        }

        (address recovered, ECDSA.RecoverError recoverError,) =
            ECDSA.tryRecover(userOpHash.toEthSignedMessageHash(), userOp.signature);
        if (recoverError != ECDSA.RecoverError.NoError || recovered != session.sessionKey) {
            return SIG_VALIDATION_FAILED;
        }

        if (missingAccountFunds != 0) {
            uint256 balance = address(this).balance;
            if (
                missingAccountFunds > balance
                    || balance - missingAccountFunds < session.minimumNativeReserveWei
            ) {
                revert ProtectedReserveViolation(balance, session.minimumNativeReserveWei);
            }
            (bool funded,) = payable(msg.sender).call{ value: missingAccountFunds }("");
            if (!funded) revert EntryPointFundingFailed();
        }
        return _packValidationData(session.validUntil, session.validAfter);
    }

    /// @notice EntryPoint-only free mint execution after successful session-key validation.
    function executeSessionAcquisition(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        bytes calldata adapterData
    )
        public
        virtual
        onlyAccount
        onlyEntryPoint
        nonReentrantExecution
        returns (bytes memory result)
    {
        _validateSessionIntent(intent, adapterData);
        AutonomousSession storage session = _session;
        uint32 today = uint32(block.timestamp / 1 days);
        if (session.day != today) {
            session.day = today;
            session.mintsToday = 0;
        }
        if (session.mintsToday >= session.maxMintsPerDay) revert SessionInactive();

        if (!adapterRegistry.validateAdapter(
                intent.adapter,
                GoghBrokerTypes.AdapterKind.MINT,
                intent.venue,
                intent.adapterCodeHash
            )) revert AdapterExecutionInvalid();
        GoghBrokerTypes.AdapterExecution memory execution =
            IGoghMarketplaceAdapter(intent.adapter).buildExecution(intent, adapterData);
        if (
            execution.target != intent.venue || execution.value != 0
                || execution.currency != address(0) || execution.allowanceSpender != address(0)
                || execution.allowanceAmount != 0 || execution.paymentAmount != 0
                || execution.callData.length < 4
        ) revert AdapterExecutionInvalid();

        if (_ownsERC721(intent.collection, intent.tokenId)) {
            revert AssetAlreadyOwned(intent.collection, intent.tokenId);
        }
        acquisitionNonce = intent.nonce + 1;
        result = _call(execution.target, 0, execution.callData);
        if (!_ownsERC721(intent.collection, intent.tokenId)) {
            revert AcquisitionPostconditionFailed(intent.collection, intent.tokenId);
        }

        session.mintsToday += 1;
        session.remainingMints -= 1;
        uint256 nextState = _incrementState();
        emit SessionAcquisitionExecuted(
            session.generation,
            intent.opportunityId,
            intent.collection,
            intent.tokenId,
            intent.nonce,
            session.remainingMints,
            nextState
        );
    }

    function depositToEntryPoint() external payable onlyTokenOwner {
        entryPoint.depositTo{ value: msg.value }(address(this));
        emit EntryPointDepositAdded(msg.sender, msg.value);
    }

    function withdrawEntryPointDeposit(uint256 amount) external onlyTokenOwner {
        entryPoint.withdrawTo(payable(msg.sender), amount);
        emit EntryPointDepositWithdrawn(msg.sender, amount);
    }

    function entryPointDeposit() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        override
        onlyTokenOwner
        nonReentrantExecution
        returns (bytes memory result)
    {
        if (operation != CALL_OPERATION) {
            revert UnsupportedOperation(operation);
        }
        _validateOwnerTarget(to, data);
        result = _call(to, value, data);
        uint256 nextState = _incrementState();
        emit Executed(msg.sender, to, value, _selector(data), nextState);
    }

    function executeBatch(Call[] calldata calls)
        external
        payable
        override
        onlyTokenOwner
        nonReentrantExecution
        returns (bytes[] memory results)
    {
        uint256 length = calls.length;
        if (length == 0) revert EmptyBatch();
        if (length > MAX_BATCH_CALLS) revert BatchTooLarge(length, MAX_BATCH_CALLS);
        results = new bytes[](length);
        uint256 nextState = _incrementState();
        for (uint256 index; index < length; ++index) {
            Call calldata accountCall = calls[index];
            _validateOwnerTarget(accountCall.to, accountCall.data);
            results[index] = _call(accountCall.to, accountCall.value, accountCall.data);
            emit Executed(
                msg.sender,
                accountCall.to,
                accountCall.value,
                _selector(accountCall.data),
                nextState
            );
        }
        emit BatchExecuted(msg.sender, length, nextState);
    }

    function revokeERC20Allowance(address tokenContract, address spender)
        external
        onlyTokenOwner
        nonReentrantExecution
    {
        if (tokenContract == address(0) || tokenContract.code.length == 0) {
            revert InvalidContract(tokenContract);
        }
        IERC20(tokenContract).forceApprove(spender, 0);
        _incrementState();
    }

    function revokeERC721Approval(address collection, uint256 tokenId)
        external
        onlyTokenOwner
        nonReentrantExecution
    {
        if (collection == address(0) || collection.code.length == 0) {
            revert InvalidContract(collection);
        }
        IERC721(collection).approve(address(0), tokenId);
        _incrementState();
    }

    function revokeOperatorApproval(address collection, address operator)
        external
        onlyTokenOwner
        nonReentrantExecution
    {
        if (collection == address(0) || collection.code.length == 0) {
            revert InvalidContract(collection);
        }
        IERC721(collection).setApprovalForAll(operator, false);
        _incrementState();
    }

    function isValidSigner(address signer, bytes calldata)
        external
        view
        override
        returns (bytes4 magicValue)
    {
        address currentOwner = owner();
        return currentOwner != address(0) && signer == currentOwner
            ? IERC6551Account.isValidSigner.selector
            : bytes4(0);
    }

    function isValidSignature(bytes32, bytes calldata)
        external
        pure
        override
        returns (bytes4 magicValue)
    {
        return bytes4(0);
    }

    function onERC721Received(address, address, uint256 tokenId, bytes calldata)
        external
        override
        onlyAccount
        returns (bytes4)
    {
        if (msg.sender == GOGH_PUNKS) {
            revert ControllingCollectionNesting(msg.sender, tokenId);
        }
        _incrementState();
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        override
        onlyAccount
        returns (bytes4)
    {
        _incrementState();
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external override onlyAccount returns (bytes4) {
        _incrementState();
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(IERC1271).interfaceId
            || interfaceId == type(IERC6551Account).interfaceId
            || interfaceId == type(IERC6551Executable).interfaceId
            || interfaceId == type(IGoghAccountBatch).interfaceId
            || interfaceId == type(IERC721Receiver).interfaceId
            || interfaceId == type(IERC1155Receiver).interfaceId;
    }

    function _validateSessionIntent(
        GoghBrokerTypes.AcquisitionIntent memory intent,
        bytes memory adapterData
    ) private view {
        AutonomousSession memory session = _session;
        address currentOwner = owner();
        if (
            !isAutonomousSessionActive() || intent.account != address(this)
                || intent.chainId != ROBINHOOD_CHAIN_ID || intent.expectedOwner != currentOwner
                || intent.nonce != acquisitionNonce || intent.policyVersion != session.generation
                || intent.opportunityType != GoghBrokerTypes.OpportunityType.FREE_MINT
                || intent.assetStandard != GoghBrokerTypes.AssetStandard.ERC721
                || intent.adapter != session.adapter || intent.venue != session.venue
                || intent.adapterCodeHash != session.adapterCodeHash
                || (session.targetCollection != address(0)
                    && intent.collection != session.targetCollection)
                || intent.collection.code.length == 0 || intent.assetAmount != 1
                || intent.currency != address(0) || intent.expectedPrice != 0
                || intent.maxPrice != 0 || intent.maxSlippageBps != 0
                || intent.opportunityId == bytes32(0) || intent.reasoningHash == bytes32(0)
                || intent.createdAt > block.timestamp || intent.expiresAt < block.timestamp
                || intent.expiresAt > session.validUntil
                || block.timestamp - intent.createdAt > MAX_INTENT_AGE || adapterData.length != 0
        ) revert InvalidIntent();
        uint32 today = uint32(block.timestamp / 1 days);
        uint32 mintsToday = session.day == today ? session.mintsToday : 0;
        if (mintsToday >= session.maxMintsPerDay) revert SessionInactive();
    }

    function _maximumUserOpGasCost(PackedUserOperation calldata userOp)
        private
        pure
        returns (uint256)
    {
        uint256 verificationGasLimit = uint128(uint256(userOp.accountGasLimits >> 128));
        uint256 callGasLimit = uint128(uint256(userOp.accountGasLimits));
        uint256 maxFeePerGas = uint128(uint256(userOp.gasFees));
        return (verificationGasLimit + callGasLimit + userOp.preVerificationGas) * maxFeePerGas;
    }

    function _packValidationData(uint48 validUntil, uint48 validAfter)
        private
        pure
        returns (uint256)
    {
        return (uint256(validUntil) << 160) | (uint256(validAfter) << 208);
    }

    function _ownsERC721(address collection, uint256 tokenId) private view returns (bool) {
        try IERC721(collection).ownerOf(tokenId) returns (address tokenOwner) {
            return tokenOwner == address(this);
        } catch {
            return false;
        }
    }

    function _validateOwnerTarget(address target, bytes calldata data) private view {
        if (target == address(0) || target == address(this)) revert InvalidTarget();
        bytes4 selector = _selector(data);
        if (
            selector == APPROVE_SELECTOR || selector == SET_APPROVAL_FOR_ALL_SELECTOR
                || selector == INCREASE_ALLOWANCE_SELECTOR
                || selector == DECREASE_ALLOWANCE_SELECTOR
        ) revert PersistentApprovalForbidden(selector);
        _preventSelfControl(target, data);
    }

    function _preventSelfControl(address target, bytes calldata data) private view {
        (, address controllingCollection, uint256 controllingTokenId) = token();
        if (target != controllingCollection || data.length < 100) return;
        bytes4 selector = _selector(data);
        if (
            selector != TRANSFER_FROM_SELECTOR && selector != SAFE_TRANSFER_FROM_SELECTOR
                && selector != SAFE_TRANSFER_FROM_DATA_SELECTOR
        ) return;
        address recipient;
        uint256 transferredTokenId;
        assembly ("memory-safe") {
            recipient := calldataload(add(data.offset, 0x24))
            transferredTokenId := calldataload(add(data.offset, 0x44))
        }
        if (recipient == address(this) && transferredTokenId == controllingTokenId) {
            revert ControllingTokenSelfTransfer(controllingTokenId);
        }
    }

    function _ownershipCycleOrExcessiveDepth(address candidate) internal view returns (bool) {
        address cursor = candidate;
        for (uint256 depth; depth < MAX_OWNER_RESOLUTION_DEPTH; ++depth) {
            if (cursor == address(this)) return true;
            if (cursor.code.length == 0) return false;
            (bool success, bytes memory result) =
                cursor.staticcall(abi.encodeCall(IERC6551Account.token, ()));
            if (!success || result.length < 96) return false;
            (uint256 chainId, address nestedCollection, uint256 nestedTokenId) =
                abi.decode(result, (uint256, address, uint256));
            if (chainId != block.chainid || nestedCollection.code.length == 0) return false;
            try IERC721(nestedCollection).ownerOf(nestedTokenId) returns (address nestedOwner) {
                cursor = nestedOwner;
            } catch {
                return false;
            }
        }
        return true;
    }

    function _call(address target, uint256 value, bytes memory data)
        private
        returns (bytes memory result)
    {
        bool success;
        (success, result) = target.call{ value: value }(data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
    }

    function _selector(bytes calldata data) private pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := calldataload(data.offset)
        }
    }

    function _incrementState() private returns (uint256 nextState) {
        unchecked {
            nextState = ++state;
        }
    }
}
