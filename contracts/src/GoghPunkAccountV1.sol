// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { IERC1155Receiver } from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { GoghBrokerTypes } from "./GoghBrokerTypes.sol";
import { IArtAdapterRegistry } from "./interfaces/IArtAdapterRegistry.sol";
import { IArtAgentRegistry } from "./interfaces/IArtAgentRegistry.sol";
import { IBrokerPolicyModule } from "./interfaces/IBrokerPolicyModule.sol";
import { IGoghMarketplaceAdapter } from "./interfaces/IGoghMarketplaceAdapter.sol";
import {
    IERC6551Account,
    IERC6551Executable,
    IGoghAccountBatch
} from "./interfaces/IGoghAccountStandards.sol";

/// @title GoghPunkAccountV1
/// @notice Transfer-aware smart account controlled by the live owner of one canonical Gogh Punk.
/// @dev Owner execution and broker execution are separate trust domains. Agents never reach the
///      general execute functions and can only submit typed NFT acquisition intents.
contract GoghPunkAccountV1 is
    IERC165,
    IERC1271,
    IERC6551Account,
    IERC6551Executable,
    IGoghAccountBatch,
    IERC721Receiver,
    IERC1155Receiver,
    EIP712
{
    using SafeERC20 for IERC20;

    uint8 public constant CALL_OPERATION = 0;
    uint256 public constant MAX_BATCH_CALLS = 32;
    uint256 public constant MAX_OWNER_RESOLUTION_DEPTH = 8;
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    address public constant GOGH_PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;

    bytes4 private constant ERC1271_MAGIC_VALUE = IERC1271.isValidSignature.selector;
    bytes4 private constant TRANSFER_FROM_SELECTOR =
        bytes4(keccak256("transferFrom(address,address,uint256)"));
    bytes4 private constant SAFE_TRANSFER_FROM_SELECTOR =
        bytes4(keccak256("safeTransferFrom(address,address,uint256)"));
    bytes4 private constant SAFE_TRANSFER_FROM_DATA_SELECTOR =
        bytes4(keccak256("safeTransferFrom(address,address,uint256,bytes)"));
    bytes32 private constant ACQUISITION_INTENT_TYPEHASH = keccak256(
        "AcquisitionIntent(address account,uint256 chainId,address expectedOwner,uint256 nonce,uint64 policyVersion,uint8 opportunityType,uint8 assetStandard,address adapter,address venue,address collection,uint256 tokenId,uint256 assetAmount,address currency,uint256 expectedPrice,uint256 maxPrice,uint16 maxSlippageBps,uint64 createdAt,uint64 expiresAt,bytes32 opportunityId,bytes32 reasoningHash,bytes32 adapterCodeHash,bytes32 adapterDataHash)"
    );

    address private immutable _implementation;
    IArtAgentRegistry public immutable agentRegistry;
    IArtAdapterRegistry public immutable adapterRegistry;
    IBrokerPolicyModule public immutable policyModule;

    uint256 public override state;
    uint256 public acquisitionNonce;
    uint256 private _executionStatus;

    error DirectImplementationCall();
    error WrongDeploymentChain(uint256 expected, uint256 actual);
    error ZeroAddress();
    error InvalidContract(address target);
    error NotAuthorized(address caller, address currentOwner);
    error AgentNotAuthorized(address caller);
    error UnsupportedOperation(uint8 operation);
    error InvalidTarget();
    error EmptyBatch();
    error BatchTooLarge(uint256 supplied, uint256 maximum);
    error ReentrantExecution();
    error ControllingCollectionNesting(address collection, uint256 tokenId);
    error ControllingTokenSelfTransfer(uint256 tokenId);
    error InvalidIntent();
    error InvalidIntentNonce(uint256 expected, uint256 supplied);
    error InvalidOwnerApproval();
    error AdapterExecutionInvalid();
    error AssetAlreadyOwned(address collection, uint256 tokenId);
    error AcquisitionPostconditionFailed(address collection, uint256 tokenId, uint256 expected);
    error InvalidCancellationNonce(uint256 current, uint256 supplied);

    event NativeReceived(address indexed sender, uint256 amount, uint256 indexed state);
    event Executed(
        address indexed executor,
        address indexed target,
        uint256 value,
        bytes4 indexed selector,
        uint256 state
    );
    event BatchExecuted(address indexed executor, uint256 callCount, uint256 indexed state);
    event ERC721Received(
        address indexed collection,
        uint256 indexed tokenId,
        address indexed from,
        address operator,
        uint256 state
    );
    event ERC1155Received(
        address indexed collection,
        uint256 indexed tokenId,
        uint256 amount,
        address indexed from,
        address operator,
        uint256 state
    );
    event ERC1155BatchReceived(
        address indexed collection,
        address indexed from,
        address indexed operator,
        uint256 itemCount,
        uint256 state
    );
    event AcquisitionExecuted(
        address indexed executor,
        bytes32 indexed opportunityId,
        address indexed collection,
        uint256 tokenId,
        uint256 assetAmount,
        address currency,
        uint256 price,
        bool ownerApproved,
        bytes32 reasoningHash,
        uint64 policyVersion,
        uint256 nonce,
        uint256 state
    );
    event PendingAcquisitionsCancelled(
        address indexed owner, uint256 previousNonce, uint256 newNonce, uint256 state
    );

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

    modifier nonReentrantExecution() {
        if (_executionStatus == 2) revert ReentrantExecution();
        _executionStatus = 2;
        _;
        _executionStatus = 1;
    }

    constructor(address policyModule_, address agentRegistry_, address adapterRegistry_)
        EIP712("Gogh Punk Account", "1")
    {
        if (block.chainid != ROBINHOOD_CHAIN_ID) {
            revert WrongDeploymentChain(ROBINHOOD_CHAIN_ID, block.chainid);
        }
        if (
            policyModule_ == address(0) || agentRegistry_ == address(0)
                || adapterRegistry_ == address(0)
        ) revert ZeroAddress();
        if (policyModule_.code.length == 0) revert InvalidContract(policyModule_);
        if (agentRegistry_.code.length == 0) revert InvalidContract(agentRegistry_);
        if (adapterRegistry_.code.length == 0) revert InvalidContract(adapterRegistry_);
        _implementation = address(this);
        policyModule = IBrokerPolicyModule(policyModule_);
        agentRegistry = IArtAgentRegistry(agentRegistry_);
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

    function owner() public view returns (address currentOwner) {
        if (!isCanonicalGoghPunkAccount()) return address(0);
        (, address tokenContract, uint256 tokenId) = token();
        try IERC721(tokenContract).ownerOf(tokenId) returns (address tokenOwner) {
            if (!_ownershipCycleOrExcessiveDepth(tokenOwner)) currentOwner = tokenOwner;
        } catch {
            currentOwner = address(0);
        }
    }

    /// @notice Unrestricted ordinary CALL for the current Punk owner only.
    /// @dev This is the owner's emergency asset-recovery path. Agents cannot call it.
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

    /// @notice Executes a typed purchase approved directly or cryptographically by the current owner.
    function executeApprovedAcquisition(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        bytes calldata adapterData,
        bytes calldata ownerSignature
    ) external nonReentrantExecution onlyAccount returns (bytes memory result) {
        address currentOwner = _validateIntentEnvelope(intent);
        if (msg.sender != currentOwner) {
            bytes32 digest = acquisitionIntentDigest(intent, keccak256(adapterData));
            if (!SignatureChecker.isValidSignatureNow(currentOwner, digest, ownerSignature)) {
                revert InvalidOwnerApproval();
            }
        }
        return _executeAcquisition(intent, adapterData, true);
    }

    /// @notice Executes a typed purchase from a currently authorized limited Art Agent.
    function executeAutonomousAcquisition(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        bytes calldata adapterData
    ) external nonReentrantExecution onlyAccount returns (bytes memory result) {
        _validateIntentEnvelope(intent);
        if (!agentRegistry.isAuthorized(address(this), msg.sender)) {
            revert AgentNotAuthorized(msg.sender);
        }
        return _executeAcquisition(intent, adapterData, false);
    }

    function cancelPendingAcquisitions(uint256 newNonce) external onlyTokenOwner {
        uint256 previous = acquisitionNonce;
        if (newNonce <= previous) revert InvalidCancellationNonce(previous, newNonce);
        acquisitionNonce = newNonce;
        uint256 nextState = _incrementState();
        emit PendingAcquisitionsCancelled(msg.sender, previous, newNonce, nextState);
    }

    function acquisitionIntentDigest(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        bytes32 adapterDataHash
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ACQUISITION_INTENT_TYPEHASH,
                    intent.account,
                    intent.chainId,
                    intent.expectedOwner,
                    intent.nonce,
                    intent.policyVersion,
                    intent.opportunityType,
                    intent.assetStandard,
                    intent.adapter,
                    intent.venue,
                    intent.collection,
                    intent.tokenId,
                    intent.assetAmount,
                    intent.currency,
                    intent.expectedPrice,
                    intent.maxPrice,
                    intent.maxSlippageBps,
                    intent.createdAt,
                    intent.expiresAt,
                    intent.opportunityId,
                    intent.reasoningHash,
                    intent.adapterCodeHash,
                    adapterDataHash
                )
            )
        );
    }

    function isValidSigner(address signer, bytes calldata)
        external
        view
        override
        returns (bytes4 magicValue)
    {
        address currentOwner = owner();
        if (currentOwner != address(0) && signer == currentOwner) {
            return IERC6551Account.isValidSigner.selector;
        }
        return bytes4(0);
    }

    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        override
        returns (bytes4 magicValue)
    {
        address currentOwner = owner();
        if (
            currentOwner != address(0)
                && SignatureChecker.isValidSignatureNow(currentOwner, hash, signature)
        ) return ERC1271_MAGIC_VALUE;
        return bytes4(0);
    }

    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata)
        external
        override
        onlyAccount
        returns (bytes4)
    {
        if (msg.sender == GOGH_PUNKS) {
            revert ControllingCollectionNesting(msg.sender, tokenId);
        }
        uint256 nextState = _incrementState();
        emit ERC721Received(msg.sender, tokenId, from, operator, nextState);
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata
    ) external override onlyAccount returns (bytes4) {
        uint256 nextState = _incrementState();
        emit ERC1155Received(msg.sender, id, value, from, operator, nextState);
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] calldata ids,
        uint256[] calldata,
        bytes calldata
    ) external override onlyAccount returns (bytes4) {
        uint256 nextState = _incrementState();
        emit ERC1155BatchReceived(msg.sender, from, operator, ids.length, nextState);
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

    function _executeAcquisition(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        bytes calldata adapterData,
        bool ownerApproved
    ) private returns (bytes memory result) {
        GoghBrokerTypes.AdapterKind expectedKind = _adapterKind(intent.opportunityType);
        if (!adapterRegistry.validateAdapter(
                intent.adapter, expectedKind, intent.venue, intent.adapterCodeHash
            )) revert AdapterExecutionInvalid();

        GoghBrokerTypes.AdapterExecution memory execution =
            IGoghMarketplaceAdapter(intent.adapter).buildExecution(intent, adapterData);
        uint256 beforeBalance = _assetBalance(intent);
        if (intent.assetStandard == GoghBrokerTypes.AssetStandard.ERC721 && beforeBalance != 0) {
            revert AssetAlreadyOwned(intent.collection, intent.tokenId);
        }

        policyModule.validateAndConsume(intent, execution, ownerApproved);
        acquisitionNonce = intent.nonce + 1;

        if (intent.currency != address(0)) {
            IERC20 tokenContract = IERC20(intent.currency);
            tokenContract.forceApprove(execution.allowanceSpender, execution.allowanceAmount);
            result = _call(execution.target, execution.value, execution.callData);
            tokenContract.forceApprove(execution.allowanceSpender, 0);
        } else {
            result = _call(execution.target, execution.value, execution.callData);
        }

        uint256 afterBalance = _assetBalance(intent);
        uint256 expectedBalance = beforeBalance + intent.assetAmount;
        if (afterBalance < expectedBalance) {
            revert AcquisitionPostconditionFailed(
                intent.collection, intent.tokenId, expectedBalance
            );
        }
        uint256 nextState = _incrementState();
        emit AcquisitionExecuted(
            msg.sender,
            intent.opportunityId,
            intent.collection,
            intent.tokenId,
            intent.assetAmount,
            intent.currency,
            execution.paymentAmount,
            ownerApproved,
            intent.reasoningHash,
            intent.policyVersion,
            intent.nonce,
            nextState
        );
    }

    function _validateIntentEnvelope(GoghBrokerTypes.AcquisitionIntent calldata intent)
        private
        view
        returns (address currentOwner)
    {
        currentOwner = owner();
        if (
            currentOwner == address(0) || intent.account != address(this)
                || intent.chainId != ROBINHOOD_CHAIN_ID || intent.expectedOwner != currentOwner
                || intent.policyVersion != policyModule.policyVersion(address(this))
        ) revert InvalidIntent();
        if (intent.nonce != acquisitionNonce) {
            revert InvalidIntentNonce(acquisitionNonce, intent.nonce);
        }
    }

    function _assetBalance(GoghBrokerTypes.AcquisitionIntent calldata intent)
        private
        view
        returns (uint256 balance)
    {
        if (intent.assetStandard == GoghBrokerTypes.AssetStandard.ERC721) {
            try IERC721(intent.collection).ownerOf(intent.tokenId) returns (address tokenOwner) {
                return tokenOwner == address(this) ? 1 : 0;
            } catch {
                return 0;
            }
        }
        try IERC1155(intent.collection).balanceOf(address(this), intent.tokenId) returns (
            uint256 amount
        ) {
            return amount;
        } catch {
            return 0;
        }
    }

    function _validateOwnerTarget(address target, bytes calldata data) private view {
        if (target == address(0) || target == address(this)) revert InvalidTarget();
        _preventSelfControl(target, data);
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

    function _selector(bytes calldata data) private pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := calldataload(data.offset)
        }
    }

    function _ownershipCycleOrExcessiveDepth(address candidate) private view returns (bool) {
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

    function _adapterKind(GoghBrokerTypes.OpportunityType opportunityType)
        private
        pure
        returns (GoghBrokerTypes.AdapterKind)
    {
        if (
            opportunityType == GoghBrokerTypes.OpportunityType.MINT
                || opportunityType == GoghBrokerTypes.OpportunityType.FREE_MINT
                || opportunityType == GoghBrokerTypes.OpportunityType.EDITION
                || opportunityType == GoghBrokerTypes.OpportunityType.ALLOWLIST_MINT
                || opportunityType == GoghBrokerTypes.OpportunityType.COLLECTION_DROP
        ) return GoghBrokerTypes.AdapterKind.MINT;
        return GoghBrokerTypes.AdapterKind.MARKETPLACE;
    }

    function _incrementState() private returns (uint256 nextState) {
        unchecked {
            nextState = ++state;
        }
    }
}
