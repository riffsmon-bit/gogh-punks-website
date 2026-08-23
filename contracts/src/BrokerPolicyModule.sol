// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { GoghBrokerTypes } from "./GoghBrokerTypes.sol";
import { IArtAdapterRegistry } from "./interfaces/IArtAdapterRegistry.sol";
import { IGoghPunkAccount } from "./interfaces/IGoghPunkAccount.sol";

/// @title BrokerPolicyModule
/// @notice Enforces owner-defined Art Mandates and hard acquisition limits on-chain.
/// @dev Only the Punk Account itself may consume policy. The guardian can pause or enable staged
///      protocol features but cannot configure a Punk, execute its account, or move its assets.
contract BrokerPolicyModule is Ownable2Step {
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    address public constant GOGH_PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    uint16 public constant PROTOCOL_MAX_SLIPPAGE_BPS = 2000;
    uint32 public constant PROTOCOL_MAX_INTENT_AGE = 7 days;

    struct PolicyState {
        GoghBrokerTypes.PolicyConfig config;
        address configuredBy;
        uint64 version;
        uint64 permissionGeneration;
        bool accountPaused;
    }

    struct PermissionState {
        bool allowed;
        bool denied;
        uint64 generation;
    }

    struct CurrencyPolicy {
        bool allowed;
        uint256 maxSpendPerTransaction;
        uint256 maxSpendPerDay;
        uint256 maxSpendPerWeek;
        uint256 maxMintPrice;
        uint256 maxSecondaryPurchasePrice;
    }

    /// @notice Per-Punk mint permissions layered beneath the global feature flags.
    /// @dev All values default to false and are invalidated with the account's permission generation.
    struct MintControls {
        bool ownerApprovedMints;
        bool autonomousFreeMints;
        bool autonomousPaidMints;
    }

    struct Usage {
        uint64 dayBucket;
        uint64 weekBucket;
        uint32 acquisitionsToday;
        uint256 spentToday;
        uint256 spentThisWeek;
    }

    struct AcquisitionUsage {
        uint64 dayBucket;
        uint32 acquisitionsToday;
    }

    struct CurrencyPolicyState {
        CurrencyPolicy policy;
        uint64 generation;
    }

    struct MintControlState {
        MintControls controls;
        uint64 generation;
    }

    struct VenueLimitState {
        uint256 maximum;
        uint64 generation;
    }

    struct Limits {
        uint256 transactionMaximum;
        uint256 dailyMaximum;
        uint256 weeklyMaximum;
        uint256 mintMaximum;
        uint256 secondaryMaximum;
    }

    IArtAdapterRegistry public immutable adapterRegistry;
    GoghBrokerTypes.FeatureFlags private _features;
    bool public globallyPaused;

    mapping(address account => PolicyState state_) internal _policies;
    mapping(address account => mapping(address adapter => PermissionState permission)) internal
        _adapterPermissions;
    mapping(address account => mapping(address venue => PermissionState permission)) internal
        _marketplacePermissions;
    mapping(address account => mapping(address mintContract => PermissionState permission)) internal
        _mintContractPermissions;
    mapping(address account => mapping(address collection => PermissionState permission)) internal
        _collectionPermissions;
    mapping(address account => mapping(address currency => CurrencyPolicyState policy)) internal
        _currencyPolicies;
    mapping(
        address account
            => mapping(address venue => mapping(address currency => VenueLimitState limit))
    ) internal _venueCurrencyMaximums;
    mapping(address account => mapping(bytes4 selector => PermissionState permission)) internal
        _selectorPermissions;
    mapping(address account => mapping(address currency => Usage usage_)) private _usage;
    mapping(address account => AcquisitionUsage usage_) private _acquisitionUsage;
    mapping(address account => MintControlState controls) internal _mintControls;

    error ZeroAddress();
    error InvalidContract(address target);
    error InvalidAccount(address account);
    error InvalidPolicy();
    error InvalidPermission();
    error NotCurrentPunkOwner(address caller, address currentOwner);
    error CallerNotPunkAccount(address caller, address expected);
    error GlobalPauseActive();
    error AccountPauseActive();
    error PolicyOwnerChanged(address configuredBy, address currentOwner);
    error PolicyVersionMismatch(uint64 expected, uint64 supplied);
    error InvalidOperatingMode(GoghBrokerTypes.BrokerMode mode, bool ownerApproved);
    error FeatureDisabled(bytes32 feature);
    error InvalidIntent();
    error IntentExpired();
    error AdapterNotAllowed(address adapter);
    error VenueNotAllowed(address venue);
    error CollectionNotAllowed(address collection);
    error CollectionDenied(address collection);
    error CurrencyNotAllowed(address currency);
    error SelectorNotAllowed(bytes4 selector);
    error SelectorDenied(bytes4 selector);
    error ExecutionMismatch();
    error TransactionLimitExceeded(uint256 maximum, uint256 attempted);
    error DailyBudgetExceeded(uint256 maximum, uint256 attempted);
    error WeeklyBudgetExceeded(uint256 maximum, uint256 attempted);
    error DailyAcquisitionLimitExceeded(uint256 maximum);
    error PriceLimitExceeded(uint256 maximum, uint256 attempted);
    error SlippageExceeded(uint256 maximum, uint256 attempted);
    error MinimumReserveViolated(uint256 minimum, uint256 resultingBalance);
    error OwnerApprovedMintsDisabled();
    error AutonomousFreeMintsDisabled();
    error AutonomousPaidMintsDisabled();
    error FreeMintPaymentNotZero(uint256 expectedPrice, uint256 maxPrice, uint256 actualPayment);
    error AutonomousMintAssetAmountInvalid(uint256 supplied);

    event FeatureFlagsChanged(GoghBrokerTypes.FeatureFlags flags);
    event GlobalPolicyPauseChanged(bool paused);
    event PolicyConfigured(
        address indexed account,
        address indexed owner,
        uint64 indexed version,
        GoghBrokerTypes.BrokerMode mode
    );
    event AccountPauseChanged(
        address indexed account, address indexed owner, bool paused, uint64 version
    );
    event AdapterPermissionChanged(address indexed account, address indexed adapter, bool allowed);
    event VenuePermissionChanged(
        address indexed account,
        address indexed venue,
        GoghBrokerTypes.AdapterKind indexed kind,
        bool allowed
    );
    event CollectionPermissionChanged(
        address indexed account, address indexed collection, bool allowed, bool denied
    );
    event CurrencyPolicyChanged(
        address indexed account, address indexed currency, CurrencyPolicy policy
    );
    event VenueCurrencyMaximumChanged(
        address indexed account, address indexed venue, address indexed currency, uint256 maximum
    );
    event SelectorPermissionChanged(
        address indexed account, bytes4 indexed selector, bool allowed, bool denied
    );
    event MintControlsChanged(
        address indexed account,
        address indexed owner,
        bool ownerApprovedMints,
        bool autonomousFreeMints,
        bool autonomousPaidMints,
        uint64 policyVersion
    );
    event AcquisitionPolicyConsumed(
        address indexed account,
        bytes32 indexed opportunityId,
        address indexed currency,
        uint256 amount,
        uint256 spentToday,
        uint256 spentThisWeek,
        uint32 acquisitionsToday,
        bool ownerApproved,
        uint64 policyVersion
    );

    constructor(address guardian, address adapterRegistry_) Ownable(guardian) {
        if (guardian == address(0) || adapterRegistry_ == address(0)) revert ZeroAddress();
        if (adapterRegistry_.code.length == 0) revert InvalidContract(adapterRegistry_);
        adapterRegistry = IArtAdapterRegistry(adapterRegistry_);
        _features.scoutMode = true;
    }

    function setFeatureFlags(GoghBrokerTypes.FeatureFlags calldata flags) external onlyOwner {
        if (flags.autonomousMints && !flags.autonomousPurchases) revert InvalidPolicy();
        if (flags.unknownCollectionExecution && !flags.autonomousPurchases) {
            revert InvalidPolicy();
        }
        if (flags.autonomousSelling && !flags.selling) revert InvalidPolicy();
        _features = flags;
        emit FeatureFlagsChanged(flags);
    }

    function featureFlags() external view returns (GoghBrokerTypes.FeatureFlags memory) {
        return _features;
    }

    function setGloballyPaused(bool paused) external onlyOwner {
        globallyPaused = paused;
        emit GlobalPolicyPauseChanged(paused);
    }

    function configurePolicy(address account, GoghBrokerTypes.PolicyConfig calldata config)
        external
    {
        address currentOwner = _requireCurrentOwner(account);
        if (msg.sender != currentOwner) revert NotCurrentPunkOwner(msg.sender, currentOwner);
        _validatePolicy(config);
        PolicyState storage currentPolicy = _policies[account];
        if (currentPolicy.configuredBy != currentOwner) {
            currentPolicy.permissionGeneration += 1;
        }
        currentPolicy.config = config;
        currentPolicy.configuredBy = currentOwner;
        uint64 nextVersion = currentPolicy.version + 1;
        currentPolicy.version = nextVersion;
        emit PolicyConfigured(account, currentOwner, nextVersion, config.mode);
    }

    function setAccountPaused(address account, bool paused) external {
        address currentOwner = _requireCurrentOwner(account);
        if (msg.sender != currentOwner) revert NotCurrentPunkOwner(msg.sender, currentOwner);
        PolicyState storage currentPolicy = _policies[account];
        if (!paused && currentPolicy.configuredBy != currentOwner) {
            revert PolicyOwnerChanged(currentPolicy.configuredBy, currentOwner);
        }
        currentPolicy.accountPaused = paused;
        uint64 nextVersion = currentPolicy.version + 1;
        currentPolicy.version = nextVersion;
        emit AccountPauseChanged(account, currentOwner, paused, nextVersion);
    }

    function setAdapterPermission(address account, address adapter, bool allowed) external {
        _requireOwnerCaller(account);
        if (adapter == address(0)) revert ZeroAddress();
        _adapterPermissions[account][adapter] = PermissionState({
            allowed: allowed, denied: false, generation: _policies[account].permissionGeneration
        });
        _incrementVersion(account);
        emit AdapterPermissionChanged(account, adapter, allowed);
    }

    function setVenuePermission(
        address account,
        address venue,
        GoghBrokerTypes.AdapterKind kind,
        bool allowed
    ) external {
        _requireOwnerCaller(account);
        if (venue == address(0)) revert ZeroAddress();
        if (kind == GoghBrokerTypes.AdapterKind.MARKETPLACE) {
            _marketplacePermissions[account][venue] = PermissionState({
                allowed: allowed, denied: false, generation: _policies[account].permissionGeneration
            });
        } else {
            _mintContractPermissions[account][venue] = PermissionState({
                allowed: allowed, denied: false, generation: _policies[account].permissionGeneration
            });
        }
        _incrementVersion(account);
        emit VenuePermissionChanged(account, venue, kind, allowed);
    }

    function setCollectionPermission(address account, address collection, bool allowed, bool denied)
        external
    {
        _requireOwnerCaller(account);
        if (collection == address(0) || (allowed && denied)) revert InvalidPermission();
        _collectionPermissions[account][collection] = PermissionState({
            allowed: allowed, denied: denied, generation: _policies[account].permissionGeneration
        });
        _incrementVersion(account);
        emit CollectionPermissionChanged(account, collection, allowed, denied);
    }

    function setCurrencyPolicy(
        address account,
        address currency,
        CurrencyPolicy calldata newCurrencyPolicy
    ) external {
        _requireOwnerCaller(account);
        _validateCurrencyPolicy(newCurrencyPolicy);
        _currencyPolicies[account][currency] = CurrencyPolicyState({
            policy: newCurrencyPolicy, generation: _policies[account].permissionGeneration
        });
        _incrementVersion(account);
        emit CurrencyPolicyChanged(account, currency, newCurrencyPolicy);
    }

    function setVenueCurrencyMaximum(
        address account,
        address venue,
        address currency,
        uint256 maximum
    ) external {
        _requireOwnerCaller(account);
        if (venue == address(0)) revert ZeroAddress();
        _venueCurrencyMaximums[account][venue][currency] = VenueLimitState({
            maximum: maximum, generation: _policies[account].permissionGeneration
        });
        _incrementVersion(account);
        emit VenueCurrencyMaximumChanged(account, venue, currency, maximum);
    }

    function setSelectorPermission(address account, bytes4 selector, bool allowed, bool denied)
        external
    {
        _requireOwnerCaller(account);
        if (selector == bytes4(0) || (allowed && denied)) revert InvalidPermission();
        _selectorPermissions[account][selector] = PermissionState({
            allowed: allowed, denied: denied, generation: _policies[account].permissionGeneration
        });
        _incrementVersion(account);
        emit SelectorPermissionChanged(account, selector, allowed, denied);
    }

    function setMintControls(address account, MintControls calldata controls) external {
        _requireOwnerCaller(account);
        _mintControls[account] = MintControlState({
            controls: controls, generation: _policies[account].permissionGeneration
        });
        _incrementVersion(account);
        emit MintControlsChanged(
            account,
            msg.sender,
            controls.ownerApprovedMints,
            controls.autonomousFreeMints,
            controls.autonomousPaidMints,
            _policies[account].version
        );
    }

    function policy(address account) external view returns (PolicyState memory) {
        return _policies[account];
    }

    function currencyPolicy(address account, address currency)
        external
        view
        returns (CurrencyPolicy memory)
    {
        CurrencyPolicyState storage stored = _currencyPolicies[account][currency];
        if (!_isCurrentPermission(account, stored.generation)) return _emptyCurrencyPolicy();
        return stored.policy;
    }

    function approvedAdapters(address account, address adapter) external view returns (bool) {
        return _permissionAllowed(account, _adapterPermissions[account][adapter]);
    }

    function approvedMarketplaces(address account, address venue) external view returns (bool) {
        return _permissionAllowed(account, _marketplacePermissions[account][venue]);
    }

    function approvedMintContracts(address account, address mintContract)
        external
        view
        returns (bool)
    {
        return _permissionAllowed(account, _mintContractPermissions[account][mintContract]);
    }

    function approvedCollections(address account, address collection) external view returns (bool) {
        return _permissionAllowed(account, _collectionPermissions[account][collection]);
    }

    function deniedCollections(address account, address collection) external view returns (bool) {
        return _permissionDenied(account, _collectionPermissions[account][collection]);
    }

    function approvedSelectors(address account, bytes4 selector) external view returns (bool) {
        return _permissionAllowed(account, _selectorPermissions[account][selector]);
    }

    function deniedSelectors(address account, bytes4 selector) external view returns (bool) {
        return _permissionDenied(account, _selectorPermissions[account][selector]);
    }

    function mintControls(address account) external view returns (MintControls memory controls) {
        MintControlState storage stored = _mintControls[account];
        if (_isCurrentPermission(account, stored.generation)) return stored.controls;
    }

    function venueCurrencyMaximum(address account, address venue, address currency)
        external
        view
        returns (uint256)
    {
        VenueLimitState storage stored = _venueCurrencyMaximums[account][venue][currency];
        return _isCurrentPermission(account, stored.generation) ? stored.maximum : 0;
    }

    function usage(address account, address currency) external view returns (Usage memory current) {
        current = _usage[account][currency];
        uint64 currentDay = uint64(block.timestamp / 1 days);
        uint64 currentWeek = uint64(block.timestamp / 7 days);
        if (current.dayBucket != currentDay) {
            current.dayBucket = currentDay;
            current.spentToday = 0;
        }
        if (current.weekBucket != currentWeek) {
            current.weekBucket = currentWeek;
            current.spentThisWeek = 0;
        }
        AcquisitionUsage memory countUsage = _acquisitionUsage[account];
        current.acquisitionsToday =
            countUsage.dayBucket == currentDay ? countUsage.acquisitionsToday : 0;
    }

    function acquisitionUsage(address account)
        external
        view
        returns (AcquisitionUsage memory current)
    {
        current = _acquisitionUsage[account];
        uint64 currentDay = uint64(block.timestamp / 1 days);
        if (current.dayBucket != currentDay) {
            current.dayBucket = currentDay;
            current.acquisitionsToday = 0;
        }
    }

    function policyVersion(address account) external view returns (uint64) {
        return _policies[account].version;
    }

    function effectiveMode(address account) external view returns (GoghBrokerTypes.BrokerMode) {
        PolicyState storage current = _policies[account];
        if (globallyPaused || current.accountPaused) return GoghBrokerTypes.BrokerMode.DISABLED;
        try IGoghPunkAccount(account).owner() returns (address currentOwner) {
            if (currentOwner == address(0) || currentOwner != current.configuredBy) {
                return GoghBrokerTypes.BrokerMode.DISABLED;
            }
        } catch {
            return GoghBrokerTypes.BrokerMode.DISABLED;
        }
        if (current.config.mode == GoghBrokerTypes.BrokerMode.SCOUT && !_features.scoutMode) {
            return GoghBrokerTypes.BrokerMode.DISABLED;
        }
        if (
            current.config.mode == GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED
                && !_features.approvalPurchases
        ) {
            return _features.scoutMode
                ? GoghBrokerTypes.BrokerMode.SCOUT
                : GoghBrokerTypes.BrokerMode.DISABLED;
        }
        if (
            current.config.mode == GoghBrokerTypes.BrokerMode.AUTONOMOUS
                && !_features.autonomousPurchases
        ) {
            return _features.scoutMode
                ? GoghBrokerTypes.BrokerMode.SCOUT
                : GoghBrokerTypes.BrokerMode.DISABLED;
        }
        return current.config.mode;
    }

    function validateAndConsume(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        GoghBrokerTypes.AdapterExecution calldata execution,
        bool ownerApproved
    ) external {
        if (msg.sender != intent.account) revert CallerNotPunkAccount(msg.sender, intent.account);
        if (globallyPaused) revert GlobalPauseActive();
        if (!_isCanonicalAccount(msg.sender)) revert InvalidAccount(msg.sender);

        PolicyState storage current = _policies[msg.sender];
        if (current.accountPaused) revert AccountPauseActive();
        address currentOwner = IGoghPunkAccount(msg.sender).owner();
        if (current.configuredBy != currentOwner) {
            revert PolicyOwnerChanged(current.configuredBy, currentOwner);
        }
        if (intent.policyVersion != current.version) {
            revert PolicyVersionMismatch(current.version, intent.policyVersion);
        }
        _validateMode(current.config.mode, intent.opportunityType, ownerApproved);
        _validateIntent(intent, current.config);

        GoghBrokerTypes.AdapterKind expectedKind = _adapterKind(intent.opportunityType);
        if (!_permissionAllowed(msg.sender, _adapterPermissions[msg.sender][intent.adapter])) {
            revert AdapterNotAllowed(intent.adapter);
        }
        if (!adapterRegistry.validateAdapter(
                intent.adapter, expectedKind, intent.venue, intent.adapterCodeHash
            )) revert AdapterNotAllowed(intent.adapter);
        _validateVenue(msg.sender, intent.venue, expectedKind);
        _validateCollection(intent, expectedKind, ownerApproved, current.config);
        _validateExecution(intent, execution);
        _validateMintControls(msg.sender, intent, execution.paymentAmount, ownerApproved);

        bytes4 selector = _selector(execution.callData);
        PermissionState storage selectorPermission = _selectorPermissions[msg.sender][selector];
        if (_permissionDenied(msg.sender, selectorPermission)) revert SelectorDenied(selector);
        if (!_permissionAllowed(msg.sender, selectorPermission)) {
            revert SelectorNotAllowed(selector);
        }

        CurrencyPolicyState storage storedCurrency = _currencyPolicies[msg.sender][intent.currency];
        if (!_isCurrentPermission(msg.sender, storedCurrency.generation)) {
            revert CurrencyNotAllowed(intent.currency);
        }
        CurrencyPolicy storage currency = storedCurrency.policy;
        if (!currency.allowed) revert CurrencyNotAllowed(intent.currency);
        Limits memory limits = _limits(current.config, intent.currency, currency);
        _validatePrice(intent, execution.paymentAmount, limits, expectedKind);

        VenueLimitState storage storedVenueMaximum =
            _venueCurrencyMaximums[msg.sender][intent.venue][intent.currency];
        uint256 venueMaximum = _isCurrentPermission(msg.sender, storedVenueMaximum.generation)
            ? storedVenueMaximum.maximum
            : 0;
        if (execution.paymentAmount > venueMaximum) {
            revert PriceLimitExceeded(venueMaximum, execution.paymentAmount);
        }
        if (msg.sender.balance < execution.value + current.config.minimumNativeReserve) {
            uint256 resulting =
                msg.sender.balance >= execution.value ? msg.sender.balance - execution.value : 0;
            revert MinimumReserveViolated(current.config.minimumNativeReserve, resulting);
        }

        Usage storage currentUsage = _rollUsage(msg.sender, intent.currency);
        uint256 attemptedDaySpend = currentUsage.spentToday + execution.paymentAmount;
        uint256 attemptedWeekSpend = currentUsage.spentThisWeek + execution.paymentAmount;
        if (execution.paymentAmount > limits.transactionMaximum) {
            revert TransactionLimitExceeded(limits.transactionMaximum, execution.paymentAmount);
        }
        if (attemptedDaySpend > limits.dailyMaximum) {
            revert DailyBudgetExceeded(limits.dailyMaximum, attemptedDaySpend);
        }
        if (attemptedWeekSpend > limits.weeklyMaximum) {
            revert WeeklyBudgetExceeded(limits.weeklyMaximum, attemptedWeekSpend);
        }
        AcquisitionUsage storage currentAcquisitionUsage = _rollAcquisitionUsage(msg.sender);
        uint32 nextAcquisitionCount = currentAcquisitionUsage.acquisitionsToday + 1;
        if (nextAcquisitionCount > current.config.maxAcquisitionsPerDay) {
            revert DailyAcquisitionLimitExceeded(current.config.maxAcquisitionsPerDay);
        }

        currentUsage.spentToday = attemptedDaySpend;
        currentUsage.spentThisWeek = attemptedWeekSpend;
        currentAcquisitionUsage.acquisitionsToday = nextAcquisitionCount;
        emit AcquisitionPolicyConsumed(
            msg.sender,
            intent.opportunityId,
            intent.currency,
            execution.paymentAmount,
            attemptedDaySpend,
            attemptedWeekSpend,
            nextAcquisitionCount,
            ownerApproved,
            current.version
        );
    }

    function _validatePolicy(GoghBrokerTypes.PolicyConfig calldata config) private view {
        if (
            config.maxSlippageBps > PROTOCOL_MAX_SLIPPAGE_BPS
                || config.maxIntentAge > PROTOCOL_MAX_INTENT_AGE
        ) revert InvalidPolicy();
        if (config.mode != GoghBrokerTypes.BrokerMode.DISABLED && config.maxIntentAge == 0) {
            revert InvalidPolicy();
        }
        if (
            config.mode == GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED
                && !_features.approvalPurchases
        ) revert FeatureDisabled("APPROVAL_PURCHASES");
        if (config.mode == GoghBrokerTypes.BrokerMode.AUTONOMOUS && !_features.autonomousPurchases) revert FeatureDisabled("AUTONOMOUS_PURCHASES");
        if (
            config.maxMintPrice > config.maxSpendPerTransaction
                || config.maxSecondaryPurchasePrice > config.maxSpendPerTransaction
                || config.maxSpendPerTransaction > config.maxSpendPerDay
                || config.maxSpendPerDay > config.maxSpendPerWeek
        ) revert InvalidPolicy();
    }

    function _validateCurrencyPolicy(CurrencyPolicy calldata currency) private pure {
        if (
            currency.maxMintPrice > currency.maxSpendPerTransaction
                || currency.maxSecondaryPurchasePrice > currency.maxSpendPerTransaction
                || currency.maxSpendPerTransaction > currency.maxSpendPerDay
                || currency.maxSpendPerDay > currency.maxSpendPerWeek
        ) revert InvalidPolicy();
    }

    function _validateMode(
        GoghBrokerTypes.BrokerMode mode,
        GoghBrokerTypes.OpportunityType opportunityType,
        bool ownerApproved
    ) private view {
        if (ownerApproved) {
            if (!_features.approvalPurchases) revert FeatureDisabled("APPROVAL_PURCHASES");
            if (
                mode != GoghBrokerTypes.BrokerMode.APPROVAL_REQUIRED
                    && mode != GoghBrokerTypes.BrokerMode.AUTONOMOUS
            ) revert InvalidOperatingMode(mode, true);
            return;
        }
        if (!_features.autonomousPurchases) revert FeatureDisabled("AUTONOMOUS_PURCHASES");
        if (mode != GoghBrokerTypes.BrokerMode.AUTONOMOUS) {
            revert InvalidOperatingMode(mode, false);
        }
        if (_isMint(opportunityType) && !_features.autonomousMints) {
            revert FeatureDisabled("AUTONOMOUS_MINTS");
        }
    }

    function _validateIntent(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        GoghBrokerTypes.PolicyConfig storage config
    ) private view {
        if (
            intent.account != msg.sender || intent.chainId != ROBINHOOD_CHAIN_ID
                || intent.expectedOwner != IGoghPunkAccount(msg.sender).owner()
                || intent.adapter == address(0) || intent.venue == address(0)
                || intent.collection == address(0) || intent.collection.code.length == 0
                || intent.assetAmount == 0 || intent.maxSlippageBps > config.maxSlippageBps
                || intent.maxPrice < intent.expectedPrice || intent.createdAt > block.timestamp
                || intent.expiresAt <= intent.createdAt
                || intent.expiresAt - intent.createdAt > config.maxIntentAge
        ) revert InvalidIntent();
        if (block.timestamp > intent.expiresAt) revert IntentExpired();
        if (intent.assetStandard == GoghBrokerTypes.AssetStandard.ERC721 && intent.assetAmount != 1)
        {
            revert InvalidIntent();
        }
    }

    function _validateVenue(address account, address venue, GoghBrokerTypes.AdapterKind kind)
        private
        view
    {
        bool allowed = kind == GoghBrokerTypes.AdapterKind.MARKETPLACE
            ? _permissionAllowed(account, _marketplacePermissions[account][venue])
            : _permissionAllowed(account, _mintContractPermissions[account][venue]);
        if (!allowed) revert VenueNotAllowed(venue);
    }

    function _validateCollection(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        GoghBrokerTypes.AdapterKind kind,
        bool ownerApproved,
        GoghBrokerTypes.PolicyConfig storage config
    ) internal view virtual {
        address account = intent.account;
        address collection = intent.collection;
        PermissionState storage collectionPermission = _collectionPermissions[account][collection];
        if (_permissionDenied(account, collectionPermission)) {
            revert CollectionDenied(collection);
        }
        if (_permissionAllowed(account, collectionPermission)) return;
        if (_allowAutomatedMintCollection(intent, kind, ownerApproved, config)) return;
        // Every typed mint needs an explicit collection approval. Unknown mints remain Scoutable
        // and available through the unrestricted owner path, but never through broker execution.
        if (kind == GoghBrokerTypes.AdapterKind.MINT) {
            revert CollectionNotAllowed(collection);
        }
        if (config.requireCollectionAllowlist || !config.allowUnknownCollections) {
            revert CollectionNotAllowed(collection);
        }
        if (!ownerApproved && !_features.unknownCollectionExecution) {
            revert FeatureDisabled("UNKNOWN_COLLECTION_EXECUTION");
        }
    }

    /// @dev V1 always returns false. A later implementation may admit a collection only through
    ///      a stricter registered adapter while preserving explicit deny precedence above.
    function _allowAutomatedMintCollection(
        GoghBrokerTypes.AcquisitionIntent calldata,
        GoghBrokerTypes.AdapterKind,
        bool,
        GoghBrokerTypes.PolicyConfig storage
    ) internal view virtual returns (bool) {
        return false;
    }

    function _validateMintControls(
        address account,
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        uint256 actualPayment,
        bool ownerApproved
    ) private view {
        if (!_isMint(intent.opportunityType)) return;

        if (
            intent.opportunityType == GoghBrokerTypes.OpportunityType.FREE_MINT
                && (intent.expectedPrice != 0 || intent.maxPrice != 0 || actualPayment != 0)
        ) {
            revert FreeMintPaymentNotZero(intent.expectedPrice, intent.maxPrice, actualPayment);
        }

        MintControlState storage stored = _mintControls[account];
        MintControls memory controls;
        if (_isCurrentPermission(account, stored.generation)) controls = stored.controls;

        if (ownerApproved) {
            if (!controls.ownerApprovedMints) revert OwnerApprovedMintsDisabled();
            return;
        }

        if (intent.assetAmount != 1) {
            revert AutonomousMintAssetAmountInvalid(intent.assetAmount);
        }
        if (actualPayment == 0) {
            if (!controls.autonomousFreeMints) revert AutonomousFreeMintsDisabled();
        } else if (!controls.autonomousPaidMints) {
            revert AutonomousPaidMintsDisabled();
        }
    }

    function _validateExecution(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        GoghBrokerTypes.AdapterExecution calldata execution
    ) private pure {
        if (
            execution.target != intent.venue || execution.currency != intent.currency
                || execution.callData.length < 4 || execution.paymentAmount > intent.maxPrice
        ) revert ExecutionMismatch();
        if (intent.currency == address(0)) {
            if (
                execution.value != execution.paymentAmount
                    || execution.allowanceSpender != address(0) || execution.allowanceAmount != 0
            ) revert ExecutionMismatch();
        } else if (
            execution.value != 0 || execution.allowanceSpender == address(0)
                || execution.allowanceAmount != execution.paymentAmount
        ) {
            revert ExecutionMismatch();
        }
    }

    function _validatePrice(
        GoghBrokerTypes.AcquisitionIntent calldata intent,
        uint256 actualPrice,
        Limits memory limits,
        GoghBrokerTypes.AdapterKind kind
    ) private pure {
        uint256 typeMaximum = kind == GoghBrokerTypes.AdapterKind.MINT
            ? limits.mintMaximum
            : limits.secondaryMaximum;
        if (actualPrice > typeMaximum) revert PriceLimitExceeded(typeMaximum, actualPrice);
        uint256 slippageMaximum = Math.mulDiv(
            intent.expectedPrice,
            uint256(10_000) + intent.maxSlippageBps,
            10_000,
            Math.Rounding.Ceil
        );
        if (actualPrice > slippageMaximum) {
            revert SlippageExceeded(slippageMaximum, actualPrice);
        }
    }

    function _limits(
        GoghBrokerTypes.PolicyConfig storage config,
        address currencyAddress,
        CurrencyPolicy storage currency
    ) private view returns (Limits memory) {
        if (currencyAddress == address(0)) {
            return Limits({
                transactionMaximum: config.maxSpendPerTransaction,
                dailyMaximum: config.maxSpendPerDay,
                weeklyMaximum: config.maxSpendPerWeek,
                mintMaximum: config.maxMintPrice,
                secondaryMaximum: config.maxSecondaryPurchasePrice
            });
        }
        return Limits({
            transactionMaximum: currency.maxSpendPerTransaction,
            dailyMaximum: currency.maxSpendPerDay,
            weeklyMaximum: currency.maxSpendPerWeek,
            mintMaximum: currency.maxMintPrice,
            secondaryMaximum: currency.maxSecondaryPurchasePrice
        });
    }

    function _rollUsage(address account, address currency) private returns (Usage storage current) {
        current = _usage[account][currency];
        uint64 dayBucket = uint64(block.timestamp / 1 days);
        uint64 weekBucket = uint64(block.timestamp / 7 days);
        if (current.dayBucket != dayBucket) {
            current.dayBucket = dayBucket;
            current.spentToday = 0;
        }
        if (current.weekBucket != weekBucket) {
            current.weekBucket = weekBucket;
            current.spentThisWeek = 0;
        }
    }

    function _rollAcquisitionUsage(address account)
        private
        returns (AcquisitionUsage storage current)
    {
        current = _acquisitionUsage[account];
        uint64 dayBucket = uint64(block.timestamp / 1 days);
        if (current.dayBucket != dayBucket) {
            current.dayBucket = dayBucket;
            current.acquisitionsToday = 0;
        }
    }

    function _adapterKind(GoghBrokerTypes.OpportunityType opportunityType)
        private
        pure
        returns (GoghBrokerTypes.AdapterKind)
    {
        return _isMint(opportunityType)
            ? GoghBrokerTypes.AdapterKind.MINT
            : GoghBrokerTypes.AdapterKind.MARKETPLACE;
    }

    function _isMint(GoghBrokerTypes.OpportunityType opportunityType) private pure returns (bool) {
        return opportunityType == GoghBrokerTypes.OpportunityType.MINT
            || opportunityType == GoghBrokerTypes.OpportunityType.FREE_MINT
            || opportunityType == GoghBrokerTypes.OpportunityType.EDITION
            || opportunityType == GoghBrokerTypes.OpportunityType.ALLOWLIST_MINT
            || opportunityType == GoghBrokerTypes.OpportunityType.COLLECTION_DROP;
    }

    function _selector(bytes calldata data) private pure returns (bytes4 selector) {
        assembly ("memory-safe") {
            selector := calldataload(data.offset)
        }
    }

    function _isCanonicalAccount(address account) private view returns (bool) {
        try IGoghPunkAccount(account).token() returns (
            uint256 chainId, address collection, uint256
        ) {
            return chainId == ROBINHOOD_CHAIN_ID && collection == GOGH_PUNKS
                && IGoghPunkAccount(account).isCanonicalGoghPunkAccount();
        } catch {
            return false;
        }
    }

    function _requireCurrentOwner(address account) internal view returns (address currentOwner) {
        if (account == address(0) || account.code.length == 0 || !_isCanonicalAccount(account)) {
            revert InvalidAccount(account);
        }
        try IGoghPunkAccount(account).owner() returns (address accountOwner) {
            if (accountOwner == address(0)) revert InvalidAccount(account);
            return accountOwner;
        } catch {
            revert InvalidAccount(account);
        }
    }

    function _requireOwnerCaller(address account) private view {
        address currentOwner = _requireCurrentOwner(account);
        if (msg.sender != currentOwner) revert NotCurrentPunkOwner(msg.sender, currentOwner);
        address configuredBy = _policies[account].configuredBy;
        if (configuredBy != currentOwner) revert PolicyOwnerChanged(configuredBy, currentOwner);
    }

    function _incrementVersion(address account) private {
        _policies[account].version += 1;
    }

    function _permissionAllowed(address account, PermissionState storage permission)
        private
        view
        returns (bool)
    {
        return _isCurrentPermission(account, permission.generation) && permission.allowed;
    }

    function _permissionDenied(address account, PermissionState storage permission)
        private
        view
        returns (bool)
    {
        return _isCurrentPermission(account, permission.generation) && permission.denied;
    }

    function _isCurrentPermission(address account, uint64 generation) private view returns (bool) {
        PolicyState storage current = _policies[account];
        if (generation == 0 || generation != current.permissionGeneration) return false;
        try IGoghPunkAccount(account).owner() returns (address currentOwner) {
            return currentOwner != address(0) && currentOwner == current.configuredBy;
        } catch {
            return false;
        }
    }

    function _emptyCurrencyPolicy() private pure returns (CurrencyPolicy memory empty) {
        return empty;
    }
}
