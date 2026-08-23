// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { BrokerPolicyModule } from "./BrokerPolicyModule.sol";
import { GoghBrokerTypes } from "./GoghBrokerTypes.sol";

/// @title BrokerPolicyModuleV2
/// @notice Adds one owner-opted-in route for automatically screened, zero-value SeaDrop mints.
/// @dev Explicit collection denials still win. The bypass applies only to the immutable generic
///      adapter, autonomous FREE_MINT intents, and a policy that explicitly disables its collection
///      allowlist while opting into unknown collections. All other V1 checks remain active.
contract BrokerPolicyModuleV2 is BrokerPolicyModule {
    address public constant SEA_DROP = 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5;
    bytes4 public constant SEA_DROP_MINT_PUBLIC_SELECTOR =
        bytes4(keccak256("mintPublic(address,address,address,uint256)"));
    uint32 public constant AUTOMATED_MAX_INTENT_AGE = 120;

    address public immutable automatedSeaDropAdapter;

    error InvalidAutomatedAdapter(address adapter);
    error InvalidAutomatedDailyCap(uint32 supplied);
    error WrongAccountPolicyModule(address account, address supplied);

    event AutomatedSeaDropPolicyConfigured(
        address indexed account,
        address indexed owner,
        address indexed adapter,
        uint32 maxAcquisitionsPerDay,
        uint32 maxIntentAge,
        uint64 permissionGeneration,
        uint64 policyVersion
    );
    event AutomatedSeaDropPolicyDisabled(
        address indexed account,
        address indexed owner,
        uint64 permissionGeneration,
        uint64 policyVersion
    );

    constructor(address guardian, address adapterRegistry_, address automatedSeaDropAdapter_)
        BrokerPolicyModule(guardian, adapterRegistry_)
    {
        if (automatedSeaDropAdapter_ == address(0) || automatedSeaDropAdapter_.code.length == 0) {
            revert InvalidAutomatedAdapter(automatedSeaDropAdapter_);
        }
        automatedSeaDropAdapter = automatedSeaDropAdapter_;
    }

    /// @notice Applies the complete zero-spend autonomous SeaDrop envelope in one owner call.
    /// @dev This cannot approve an agent. Account-level agent authorization remains a separate,
    ///      time-limited owner decision in ArtAgentRegistry.
    function configureAutomatedSeaDropPolicy(address account, uint32 maxAcquisitionsPerDay)
        external
    {
        if (
            maxAcquisitionsPerDay != 1 && maxAcquisitionsPerDay != 3 && maxAcquisitionsPerDay != 5
                && maxAcquisitionsPerDay != 10
        ) revert InvalidAutomatedDailyCap(maxAcquisitionsPerDay);
        address currentOwner = _requireCurrentOwner(account);
        if (msg.sender != currentOwner) revert NotCurrentPunkOwner(msg.sender, currentOwner);
        _requireThisPolicyModule(account);
        GoghBrokerTypes.FeatureFlags memory flags = this.featureFlags();
        if (!flags.autonomousPurchases) revert FeatureDisabled("AUTONOMOUS_PURCHASES");
        if (!flags.autonomousMints) revert FeatureDisabled("AUTONOMOUS_MINTS");
        if (!flags.unknownCollectionExecution) {
            revert FeatureDisabled("UNKNOWN_COLLECTION_EXECUTION");
        }
        if (flags.selling || flags.autonomousSelling) revert InvalidPolicy();

        PolicyState storage current = _policies[account];
        current.permissionGeneration += 1;
        uint64 generation = current.permissionGeneration;
        current.config = GoghBrokerTypes.PolicyConfig({
            mode: GoghBrokerTypes.BrokerMode.AUTONOMOUS,
            maxSpendPerTransaction: 0,
            maxSpendPerDay: 0,
            maxSpendPerWeek: 0,
            maxMintPrice: 0,
            maxSecondaryPurchasePrice: 0,
            minimumNativeReserve: 0,
            maxAcquisitionsPerDay: maxAcquisitionsPerDay,
            maxIntentAge: AUTOMATED_MAX_INTENT_AGE,
            maxSlippageBps: 0,
            requireCollectionAllowlist: false,
            allowUnknownCollections: true
        });
        current.configuredBy = currentOwner;
        current.accountPaused = false;

        _adapterPermissions[account][automatedSeaDropAdapter] =
            PermissionState({ allowed: true, denied: false, generation: generation });
        _mintContractPermissions[account][SEA_DROP] =
            PermissionState({ allowed: true, denied: false, generation: generation });
        CurrencyPolicy memory nativePolicy = CurrencyPolicy({
            allowed: true,
            maxSpendPerTransaction: 0,
            maxSpendPerDay: 0,
            maxSpendPerWeek: 0,
            maxMintPrice: 0,
            maxSecondaryPurchasePrice: 0
        });
        _currencyPolicies[account][address(0)] =
            CurrencyPolicyState({ policy: nativePolicy, generation: generation });
        _venueCurrencyMaximums[account][SEA_DROP][address(0)] =
            VenueLimitState({ maximum: 0, generation: generation });
        _selectorPermissions[account][SEA_DROP_MINT_PUBLIC_SELECTOR] =
            PermissionState({ allowed: true, denied: false, generation: generation });
        MintControls memory controls = MintControls({
            ownerApprovedMints: false, autonomousFreeMints: true, autonomousPaidMints: false
        });
        _mintControls[account] = MintControlState({ controls: controls, generation: generation });
        current.version += 1;

        emit PolicyConfigured(
            account, currentOwner, current.version, GoghBrokerTypes.BrokerMode.AUTONOMOUS
        );
        emit AccountPauseChanged(account, currentOwner, false, current.version);
        emit AdapterPermissionChanged(account, automatedSeaDropAdapter, true);
        emit VenuePermissionChanged(account, SEA_DROP, GoghBrokerTypes.AdapterKind.MINT, true);
        emit CurrencyPolicyChanged(account, address(0), nativePolicy);
        emit VenueCurrencyMaximumChanged(account, SEA_DROP, address(0), 0);
        emit SelectorPermissionChanged(account, SEA_DROP_MINT_PUBLIC_SELECTOR, true, false);
        emit MintControlsChanged(account, currentOwner, false, true, false, current.version);
        emit AutomatedSeaDropPolicyConfigured(
            account,
            currentOwner,
            automatedSeaDropAdapter,
            maxAcquisitionsPerDay,
            AUTOMATED_MAX_INTENT_AGE,
            generation,
            current.version
        );
    }

    /// @notice Stops this account's V2 route in one owner transaction.
    /// @dev The account stays paused and DISABLED even if a prior agent authorization has not yet
    ///      been separately revoked or expired.
    function disableAutomatedSeaDropPolicy(address account) external {
        address currentOwner = _requireCurrentOwner(account);
        if (msg.sender != currentOwner) revert NotCurrentPunkOwner(msg.sender, currentOwner);
        _requireThisPolicyModule(account);
        PolicyState storage current = _policies[account];
        current.permissionGeneration += 1;
        uint64 generation = current.permissionGeneration;
        current.config = GoghBrokerTypes.PolicyConfig({
            mode: GoghBrokerTypes.BrokerMode.DISABLED,
            maxSpendPerTransaction: 0,
            maxSpendPerDay: 0,
            maxSpendPerWeek: 0,
            maxMintPrice: 0,
            maxSecondaryPurchasePrice: 0,
            minimumNativeReserve: 0,
            maxAcquisitionsPerDay: 0,
            maxIntentAge: 0,
            maxSlippageBps: 0,
            requireCollectionAllowlist: true,
            allowUnknownCollections: false
        });
        current.configuredBy = currentOwner;
        current.accountPaused = true;
        _adapterPermissions[account][automatedSeaDropAdapter] =
            PermissionState({ allowed: false, denied: false, generation: generation });
        _mintContractPermissions[account][SEA_DROP] =
            PermissionState({ allowed: false, denied: false, generation: generation });
        CurrencyPolicy memory nativePolicy;
        _currencyPolicies[account][address(0)] =
            CurrencyPolicyState({ policy: nativePolicy, generation: generation });
        _venueCurrencyMaximums[account][SEA_DROP][address(0)] =
            VenueLimitState({ maximum: 0, generation: generation });
        _selectorPermissions[account][SEA_DROP_MINT_PUBLIC_SELECTOR] =
            PermissionState({ allowed: false, denied: true, generation: generation });
        MintControls memory controls;
        _mintControls[account] = MintControlState({ controls: controls, generation: generation });
        current.version += 1;

        emit PolicyConfigured(
            account, currentOwner, current.version, GoghBrokerTypes.BrokerMode.DISABLED
        );
        emit AccountPauseChanged(account, currentOwner, true, current.version);
        emit AdapterPermissionChanged(account, automatedSeaDropAdapter, false);
        emit VenuePermissionChanged(account, SEA_DROP, GoghBrokerTypes.AdapterKind.MINT, false);
        emit CurrencyPolicyChanged(account, address(0), nativePolicy);
        emit VenueCurrencyMaximumChanged(account, SEA_DROP, address(0), 0);
        emit SelectorPermissionChanged(account, SEA_DROP_MINT_PUBLIC_SELECTOR, false, true);
        emit MintControlsChanged(account, currentOwner, false, false, false, current.version);
        emit AutomatedSeaDropPolicyDisabled(account, currentOwner, generation, current.version);
    }

    function _allowAutomatedMintCollection(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        GoghBrokerTypes.AdapterKind kind,
        bool ownerApproved,
        GoghBrokerTypes.PolicyConfig storage config
    ) internal view override returns (bool) {
        if (
            ownerApproved || kind != GoghBrokerTypes.AdapterKind.MINT
                || intent.opportunityType != GoghBrokerTypes.OpportunityType.FREE_MINT
                || intent.adapter != automatedSeaDropAdapter || config.requireCollectionAllowlist
                || !config.allowUnknownCollections
        ) return false;
        GoghBrokerTypes.FeatureFlags memory flags = this.featureFlags();
        return
            flags.autonomousPurchases && flags.autonomousMints && flags.unknownCollectionExecution;
    }

    function _requireThisPolicyModule(address account) private view {
        (bool success, bytes memory result) =
            account.staticcall(abi.encodeWithSignature("policyModule()"));
        address supplied =
            success && result.length == 32 ? abi.decode(result, (address)) : address(0);
        if (supplied != address(this)) revert WrongAccountPolicyModule(account, supplied);
    }
}
