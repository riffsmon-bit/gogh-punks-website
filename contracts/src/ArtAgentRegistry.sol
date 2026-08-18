// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IGoghPunkAccount } from "./interfaces/IGoghPunkAccount.sol";

/// @title ArtAgentRegistry
/// @notice Two-layer agent authorization: global approval plus explicit current-owner delegation.
/// @dev The protocol guardian can only narrow or globally approve eligibility. It cannot grant
///      account-level authority and can never execute or withdraw Punk Account assets.
contract ArtAgentRegistry is Ownable2Step {
    uint64 public constant MAX_ACCOUNT_AUTHORIZATION = 30 days;

    struct GlobalAgent {
        bool approved;
        uint64 validAfter;
        uint64 validUntil;
        bytes32 versionHash;
        bytes32 metadataHash;
    }

    struct AccountAuthorization {
        bool active;
        address authorizingOwner;
        uint64 validUntil;
        uint64 generation;
    }

    mapping(address agent => GlobalAgent record) private _globalAgents;
    mapping(address account => mapping(address agent => AccountAuthorization authorization)) private
        _accountAuthorizations;
    mapping(address account => uint64 generation) public authorizationGeneration;
    bool public globallyPaused;

    error ZeroAddress();
    error InvalidAccount(address account);
    error InvalidAgent(address agent);
    error InvalidExpiration();
    error NotCurrentPunkOwner(address caller, address currentOwner);
    error AgentUnavailable(address agent);

    event GlobalAgentConfigured(
        address indexed agent,
        bool approved,
        uint64 validAfter,
        uint64 validUntil,
        bytes32 versionHash,
        bytes32 metadataHash
    );
    event AgentAuthorized(
        address indexed account,
        address indexed agent,
        address indexed owner,
        uint64 validUntil,
        uint64 generation
    );
    event AgentRevoked(address indexed account, address indexed agent, address indexed owner);
    event AllAgentsRevoked(address indexed account, address indexed owner, uint64 newGeneration);
    event GlobalAgentPauseChanged(bool paused);

    constructor(address guardian) Ownable(guardian) {
        if (guardian == address(0)) revert ZeroAddress();
    }

    function configureGlobalAgent(
        address agent,
        bool approved,
        uint64 validAfter,
        uint64 validUntil,
        bytes32 versionHash,
        bytes32 metadataHash
    ) external onlyOwner {
        if (agent == address(0) || agent == owner()) {
            revert InvalidAgent(agent);
        }
        if (approved && (validUntil <= block.timestamp || validUntil <= validAfter)) {
            revert InvalidExpiration();
        }
        _globalAgents[agent] = GlobalAgent({
            approved: approved,
            validAfter: validAfter,
            validUntil: validUntil,
            versionHash: versionHash,
            metadataHash: metadataHash
        });
        emit GlobalAgentConfigured(
            agent, approved, validAfter, validUntil, versionHash, metadataHash
        );
    }

    function authorizeAgent(address account, address agent, uint64 validUntil) external {
        address currentOwner = _currentOwner(account);
        if (msg.sender != currentOwner) revert NotCurrentPunkOwner(msg.sender, currentOwner);
        GlobalAgent storage globalRecord = _globalAgents[agent];
        if (!_globalAgentAvailable(globalRecord)) revert AgentUnavailable(agent);
        if (
            validUntil <= block.timestamp
                || validUntil > block.timestamp + MAX_ACCOUNT_AUTHORIZATION
                || validUntil > globalRecord.validUntil
        ) revert InvalidExpiration();

        uint64 generation = authorizationGeneration[account];
        _accountAuthorizations[account][agent] = AccountAuthorization({
            active: true,
            authorizingOwner: currentOwner,
            validUntil: validUntil,
            generation: generation
        });
        emit AgentAuthorized(account, agent, currentOwner, validUntil, generation);
    }

    function revokeAgent(address account, address agent) external {
        address currentOwner = _currentOwner(account);
        if (msg.sender != currentOwner) revert NotCurrentPunkOwner(msg.sender, currentOwner);
        _accountAuthorizations[account][agent].active = false;
        emit AgentRevoked(account, agent, currentOwner);
    }

    function revokeAllAgents(address account) external {
        address currentOwner = _currentOwner(account);
        if (msg.sender != currentOwner) revert NotCurrentPunkOwner(msg.sender, currentOwner);
        uint64 nextGeneration = authorizationGeneration[account] + 1;
        authorizationGeneration[account] = nextGeneration;
        emit AllAgentsRevoked(account, currentOwner, nextGeneration);
    }

    function setGloballyPaused(bool paused) external onlyOwner {
        globallyPaused = paused;
        emit GlobalAgentPauseChanged(paused);
    }

    function globalAgent(address agent) external view returns (GlobalAgent memory) {
        return _globalAgents[agent];
    }

    function accountAuthorization(address account, address agent)
        external
        view
        returns (AccountAuthorization memory)
    {
        return _accountAuthorizations[account][agent];
    }

    function isAuthorized(address account, address agent) external view returns (bool) {
        if (globallyPaused) return false;
        GlobalAgent storage globalRecord = _globalAgents[agent];
        if (!_globalAgentAvailable(globalRecord)) return false;
        AccountAuthorization storage authorization = _accountAuthorizations[account][agent];
        if (
            !authorization.active || authorization.validUntil < block.timestamp
                || authorization.generation != authorizationGeneration[account]
        ) return false;
        try IGoghPunkAccount(account).owner() returns (address currentOwner) {
            return currentOwner != address(0) && currentOwner == authorization.authorizingOwner;
        } catch {
            return false;
        }
    }

    function _currentOwner(address account) private view returns (address currentOwner) {
        if (account == address(0) || account.code.length == 0) revert InvalidAccount(account);
        try IGoghPunkAccount(account).isCanonicalGoghPunkAccount() returns (bool canonical) {
            if (!canonical) revert InvalidAccount(account);
        } catch {
            revert InvalidAccount(account);
        }
        try IGoghPunkAccount(account).owner() returns (address accountOwner) {
            if (accountOwner == address(0)) revert InvalidAccount(account);
            currentOwner = accountOwner;
        } catch {
            revert InvalidAccount(account);
        }
    }

    function _globalAgentAvailable(GlobalAgent storage agent) private view returns (bool) {
        return agent.approved && block.timestamp >= agent.validAfter
            && block.timestamp <= agent.validUntil;
    }
}
