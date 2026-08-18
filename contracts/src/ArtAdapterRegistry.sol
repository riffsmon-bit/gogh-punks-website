// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { GoghBrokerTypes } from "./GoghBrokerTypes.sol";
import { IGoghMarketplaceAdapter } from "./interfaces/IGoghMarketplaceAdapter.sol";

/// @title ArtAdapterRegistry
/// @notice Global allowlist and kill switch for deterministic NFT venue adapters.
/// @dev The guardian can register or disable adapters but receives no Punk Account authority.
contract ArtAdapterRegistry is Ownable2Step {
    struct AdapterRecord {
        GoghBrokerTypes.AdapterKind kind;
        bool active;
        address venue;
        bytes32 adapterCodeHash;
        bytes32 venueCodeHash;
        bytes32 versionHash;
        bytes32 metadataHash;
    }

    mapping(address adapter => AdapterRecord record) private _adapters;
    bool public globallyPaused;

    error ZeroAddress();
    error InvalidContract(address target);
    error AdapterIdentityMismatch();
    error AdapterNotRegistered(address adapter);
    error CodeHashChanged(address target, bytes32 expected, bytes32 actual);

    event AdapterRegistered(
        address indexed adapter,
        address indexed venue,
        GoghBrokerTypes.AdapterKind indexed kind,
        bytes32 adapterCodeHash,
        bytes32 venueCodeHash,
        bytes32 versionHash,
        bytes32 metadataHash
    );
    event AdapterStatusChanged(address indexed adapter, bool active);
    event GlobalAdapterPauseChanged(bool paused);

    constructor(address guardian) Ownable(guardian) {
        if (guardian == address(0)) revert ZeroAddress();
    }

    function registerAdapter(
        address adapter,
        GoghBrokerTypes.AdapterKind kind,
        address venue,
        bytes32 versionHash,
        bytes32 metadataHash
    ) external onlyOwner {
        if (adapter == address(0) || venue == address(0)) revert ZeroAddress();
        if (adapter.code.length == 0) revert InvalidContract(adapter);
        if (venue.code.length == 0) revert InvalidContract(venue);

        try IGoghMarketplaceAdapter(adapter).kind() returns (
            GoghBrokerTypes.AdapterKind reportedKind
        ) {
            if (reportedKind != kind) revert AdapterIdentityMismatch();
        } catch {
            revert AdapterIdentityMismatch();
        }
        try IGoghMarketplaceAdapter(adapter).venue() returns (address reportedVenue) {
            if (reportedVenue != venue) revert AdapterIdentityMismatch();
        } catch {
            revert AdapterIdentityMismatch();
        }

        bytes32 adapterHash = adapter.codehash;
        bytes32 venueHash = venue.codehash;
        _adapters[adapter] = AdapterRecord({
            kind: kind,
            active: true,
            venue: venue,
            adapterCodeHash: adapterHash,
            venueCodeHash: venueHash,
            versionHash: versionHash,
            metadataHash: metadataHash
        });
        emit AdapterRegistered(
            adapter, venue, kind, adapterHash, venueHash, versionHash, metadataHash
        );
    }

    function setAdapterActive(address adapter, bool active) external onlyOwner {
        AdapterRecord storage record = _adapters[adapter];
        if (record.adapterCodeHash == bytes32(0)) revert AdapterNotRegistered(adapter);
        if (active) _requireUnchangedCode(adapter, record);
        record.active = active;
        emit AdapterStatusChanged(adapter, active);
    }

    function setGloballyPaused(bool paused) external onlyOwner {
        globallyPaused = paused;
        emit GlobalAdapterPauseChanged(paused);
    }

    function adapterRecord(address adapter) external view returns (AdapterRecord memory) {
        return _adapters[adapter];
    }

    function validateAdapter(
        address adapter,
        GoghBrokerTypes.AdapterKind expectedKind,
        address expectedVenue,
        bytes32 expectedCodeHash
    ) external view returns (bool) {
        AdapterRecord storage record = _adapters[adapter];
        return !globallyPaused && record.active && record.kind == expectedKind
            && record.venue == expectedVenue && record.adapterCodeHash == expectedCodeHash
            && adapter.codehash == record.adapterCodeHash
            && expectedVenue.codehash == record.venueCodeHash;
    }

    function _requireUnchangedCode(address adapter, AdapterRecord storage record) private view {
        bytes32 currentAdapterHash = adapter.codehash;
        if (currentAdapterHash != record.adapterCodeHash) {
            revert CodeHashChanged(adapter, record.adapterCodeHash, currentAdapterHash);
        }
        bytes32 currentVenueHash = record.venue.codehash;
        if (currentVenueHash != record.venueCodeHash) {
            revert CodeHashChanged(record.venue, record.venueCodeHash, currentVenueHash);
        }
    }
}
