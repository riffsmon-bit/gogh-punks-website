// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { GoghBrokerTypes } from "../src/GoghBrokerTypes.sol";
import { GoghOneShotCanaryMintAdapter } from "../src/adapters/GoghOneShotCanaryMintAdapter.sol";
import {
    GoghOneShotCanaryArt,
    ICanonicalGoghPunkAccount,
    IGoghPunkCanaryAccountRegistry
} from "../src/canary/GoghOneShotCanaryArt.sol";

interface OneShotCanaryDeploymentVm {
    function envAddress(string calldata name) external view returns (address);

    function envUint(string calldata name) external view returns (uint256);

    function startBroadcast() external;

    function stopBroadcast() external;
}

/// @title DeployOneShotCanary
/// @notice Prepares exactly one controlled canary-art collection and its exact mint adapter.
/// @dev Running without `--broadcast` only simulates the deployment. This script never registers
///      the adapter, configures a policy, enables a feature flag, signs an acquisition, or mints.
///      Live broadcast requires separate explicit authorization and normal Foundry signer input.
///
///      The script validates the already-deployed core account registry and activated account
///      before `startBroadcast`. Deployment transactions are sequential, so a separately
///      authorized live run must still record and verify every receipt and runtime hash; a later
///      transaction failure cannot erase an earlier successfully mined deployment.
contract DeployOneShotCanary {
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    address public constant GOGH_PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address public constant CANONICAL_ERC6551_REGISTRY = 0x000000006551c19487814612e58FE06813775758;

    OneShotCanaryDeploymentVm private constant VM =
        OneShotCanaryDeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Deployment {
        GoghOneShotCanaryArt canaryArt;
        GoghOneShotCanaryMintAdapter canaryAdapter;
        address currentOwnerAtPreparation;
    }

    error WrongDeploymentChain(uint256 expected, uint256 actual);
    error ZeroAccountRegistry();
    error AccountRegistryHasNoCode(address supplied);
    error InvalidAccountRegistryConfiguration(address supplied);
    error ZeroExpectedAccount();
    error ExpectedAccountMismatch(address supplied, address derived);
    error ActivatedAccountCodeMissing(address supplied);
    error NonCanonicalAccount(address supplied);
    error AccountTokenMismatch(
        uint256 chainId, address collection, uint256 tokenId, uint256 expectedTokenId
    );
    error AccountOwnerMissing(address supplied);
    error ExpectedOwnerMismatch(address supplied, address currentOwner);
    error PostDeploymentAssertionFailed();

    event OneShotCanaryDeploymentPrepared(
        address indexed accountRegistry,
        uint256 indexed controllingPunkTokenId,
        address indexed punkAccount,
        address currentOwnerAtPreparation,
        uint256 canaryArtTokenId,
        address canaryArt,
        address canaryAdapter
    );

    function run() external returns (Deployment memory deployment) {
        IGoghPunkCanaryAccountRegistry accountRegistry =
            IGoghPunkCanaryAccountRegistry(VM.envAddress("GOGH_CANARY_ACCOUNT_REGISTRY"));
        uint256 controllingPunkTokenId = VM.envUint("GOGH_CANARY_PUNK_TOKEN_ID");
        address expectedAccount = VM.envAddress("GOGH_CANARY_EXPECTED_ACCOUNT");
        address expectedOwner = VM.envAddress("GOGH_CANARY_EXPECTED_OWNER");
        uint256 canaryArtTokenId = VM.envUint("GOGH_CANARY_ART_TOKEN_ID");

        address currentOwner = validatePreparation(
            accountRegistry,
            controllingPunkTokenId,
            expectedAccount,
            expectedOwner,
            canaryArtTokenId
        );

        VM.startBroadcast();
        deployment.canaryArt = new GoghOneShotCanaryArt(
            accountRegistry, expectedAccount, controllingPunkTokenId, canaryArtTokenId
        );
        deployment.canaryAdapter = new GoghOneShotCanaryMintAdapter(deployment.canaryArt);
        VM.stopBroadcast();

        deployment.currentOwnerAtPreparation = currentOwner;
        _assertDeployment(
            deployment,
            accountRegistry,
            controllingPunkTokenId,
            expectedAccount,
            expectedOwner,
            canaryArtTokenId
        );

        emit OneShotCanaryDeploymentPrepared(
            address(accountRegistry),
            controllingPunkTokenId,
            expectedAccount,
            currentOwner,
            canaryArtTokenId,
            address(deployment.canaryArt),
            address(deployment.canaryAdapter)
        );
    }

    /// @notice Performs every read-only pre-broadcast identity and ownership check.
    /// @dev `canaryArtTokenId` is accepted here to make the required explicit input visible to
    ///      simulation callers. ERC-721 token ID zero is valid and is therefore not rejected.
    function validatePreparation(
        IGoghPunkCanaryAccountRegistry accountRegistry,
        uint256 controllingPunkTokenId,
        address expectedAccount,
        address expectedOwner,
        uint256 canaryArtTokenId
    ) public view returns (address currentOwner) {
        canaryArtTokenId;
        if (block.chainid != ROBINHOOD_CHAIN_ID) {
            revert WrongDeploymentChain(ROBINHOOD_CHAIN_ID, block.chainid);
        }
        if (address(accountRegistry) == address(0)) revert ZeroAccountRegistry();
        if (address(accountRegistry).code.length == 0) {
            revert AccountRegistryHasNoCode(address(accountRegistry));
        }
        if (!_hasExpectedRegistryConfiguration(accountRegistry)) {
            revert InvalidAccountRegistryConfiguration(address(accountRegistry));
        }
        if (expectedAccount == address(0)) revert ZeroExpectedAccount();

        address derivedAccount;
        try accountRegistry.account(controllingPunkTokenId) returns (address accountAddress) {
            derivedAccount = accountAddress;
        } catch {
            revert InvalidAccountRegistryConfiguration(address(accountRegistry));
        }
        if (expectedAccount != derivedAccount) {
            revert ExpectedAccountMismatch(expectedAccount, derivedAccount);
        }
        if (expectedAccount.code.length == 0) {
            revert ActivatedAccountCodeMissing(expectedAccount);
        }

        bool canonical;
        try ICanonicalGoghPunkAccount(expectedAccount).isCanonicalGoghPunkAccount() returns (
            bool isCanonical
        ) {
            canonical = isCanonical;
        } catch {
            revert NonCanonicalAccount(expectedAccount);
        }
        if (!canonical) revert NonCanonicalAccount(expectedAccount);

        try ICanonicalGoghPunkAccount(expectedAccount).token() returns (
            uint256 chainId, address collection, uint256 tokenId
        ) {
            if (
                chainId != ROBINHOOD_CHAIN_ID || collection != GOGH_PUNKS
                    || tokenId != controllingPunkTokenId
            ) {
                revert AccountTokenMismatch(chainId, collection, tokenId, controllingPunkTokenId);
            }
        } catch (bytes memory reason) {
            if (reason.length != 0) {
                assembly ("memory-safe") {
                    revert(add(reason, 0x20), mload(reason))
                }
            }
            revert NonCanonicalAccount(expectedAccount);
        }

        try ICanonicalGoghPunkAccount(expectedAccount).owner() returns (address owner) {
            currentOwner = owner;
        } catch {
            revert NonCanonicalAccount(expectedAccount);
        }
        if (currentOwner == address(0)) revert AccountOwnerMissing(expectedAccount);
        if (currentOwner != expectedOwner) {
            revert ExpectedOwnerMismatch(expectedOwner, currentOwner);
        }
    }

    function _assertDeployment(
        Deployment memory deployment,
        IGoghPunkCanaryAccountRegistry accountRegistry,
        uint256 controllingPunkTokenId,
        address expectedAccount,
        address expectedOwner,
        uint256 canaryArtTokenId
    ) private view {
        GoghOneShotCanaryArt art = deployment.canaryArt;
        GoghOneShotCanaryMintAdapter adapter = deployment.canaryAdapter;
        if (
            address(art.punkAccountRegistry()) != address(accountRegistry)
                || art.punkAccount() != expectedAccount
                || art.controllingPunkTokenId() != controllingPunkTokenId
                || art.canaryTokenId() != canaryArtTokenId || art.minted()
                || ICanonicalGoghPunkAccount(expectedAccount).owner() != expectedOwner
                || deployment.currentOwnerAtPreparation != expectedOwner
                || address(adapter.canaryCollection()) != address(art)
                || adapter.boundAccount() != expectedAccount
                || adapter.boundTokenId() != canaryArtTokenId || adapter.venue() != address(art)
                || adapter.collection() != address(art)
                || adapter.mintSelector() != GoghOneShotCanaryArt.mint.selector
                || adapter.assetStandard() != GoghBrokerTypes.AssetStandard.ERC721
                || adapter.kind() != GoghBrokerTypes.AdapterKind.MINT
        ) revert PostDeploymentAssertionFailed();

        GoghBrokerTypes.AcquisitionIntent memory intent = GoghBrokerTypes.AcquisitionIntent({
            account: expectedAccount,
            chainId: ROBINHOOD_CHAIN_ID,
            expectedOwner: expectedOwner,
            nonce: 0,
            policyVersion: 0,
            opportunityType: GoghBrokerTypes.OpportunityType.FREE_MINT,
            assetStandard: GoghBrokerTypes.AssetStandard.ERC721,
            adapter: address(adapter),
            venue: address(art),
            collection: address(art),
            tokenId: canaryArtTokenId,
            assetAmount: 1,
            currency: address(0),
            expectedPrice: 0,
            maxPrice: 0,
            maxSlippageBps: 0,
            createdAt: 0,
            expiresAt: 0,
            opportunityId: bytes32(0),
            reasoningHash: bytes32(0),
            adapterCodeHash: address(adapter).codehash
        });
        GoghBrokerTypes.AdapterExecution memory execution =
            adapter.buildExecution(intent, bytes(""));
        if (
            execution.target != address(art) || execution.value != 0
                || execution.currency != address(0) || execution.allowanceSpender != address(0)
                || execution.allowanceAmount != 0 || execution.paymentAmount != 0
                || keccak256(execution.callData)
                    != keccak256(
                        abi.encodeCall(
                            GoghOneShotCanaryArt.mint, (expectedAccount, canaryArtTokenId)
                        )
                    )
        ) revert PostDeploymentAssertionFailed();
    }

    function _hasExpectedRegistryConfiguration(IGoghPunkCanaryAccountRegistry registry)
        private
        view
        returns (bool)
    {
        try registry.ROBINHOOD_CHAIN_ID() returns (uint256 chainId) {
            if (chainId != ROBINHOOD_CHAIN_ID) return false;
        } catch {
            return false;
        }
        try registry.GOGH_PUNKS() returns (address collection) {
            if (collection != GOGH_PUNKS) return false;
        } catch {
            return false;
        }
        try registry.CANONICAL_ERC6551_REGISTRY() returns (address singleton) {
            if (singleton != CANONICAL_ERC6551_REGISTRY) return false;
        } catch {
            return false;
        }
        return true;
    }
}
