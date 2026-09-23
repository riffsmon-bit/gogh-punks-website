// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { SwarmGasVault, SwarmGasVaultConfig } from "../src/SwarmGasVault.sol";
import { SwarmGasVaultFactory } from "../src/SwarmGasVaultFactory.sol";
import { GoghPunkAgentAccount } from "../src/GoghPunkAgentAccount.sol";
import { GoghPunkAgentAccountRegistry } from "../src/GoghPunkAgentAccountRegistry.sol";

interface SwarmTestVm {
    function chainId(uint256 chain) external;
    function deal(address account, uint256 balance) external;
    function etch(address target, bytes calldata code) external;
    function expectRevert(bytes4 data) external;
    function expectRevert(bytes calldata data) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

/// @dev Canonical ERC-6551 CREATE2/proxy layout, without unrelated historical test dependencies.
contract SwarmCanonicalRegistry {
    function codeFor(
        address implementation,
        bytes32 salt,
        uint256 chain,
        address collection,
        uint256 id
    ) private pure returns (bytes memory) {
        return abi.encodePacked(
            hex"3d60ad80600a3d3981f3363d3d373d3d3d363d73",
            implementation,
            hex"5af43d82803e903d91602b57fd5bf3",
            abi.encode(salt, chain, collection, id)
        );
    }

    function account(
        address implementation,
        bytes32 salt,
        uint256 chain,
        address collection,
        uint256 id
    ) public view returns (address) {
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff),
                            address(this),
                            salt,
                            keccak256(codeFor(implementation, salt, chain, collection, id))
                        )
                    )
                )
            )
        );
    }

    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chain,
        address collection,
        uint256 id
    ) external returns (address result) {
        result = account(implementation, salt, chain, collection, id);
        if (result.code.length != 0) return result;
        bytes memory code = codeFor(implementation, salt, chain, collection, id);
        assembly ("memory-safe") { result := create2(0, add(code, 32), mload(code), salt) }
        require(result != address(0));
    }
}

contract SwarmMockPunks {
    mapping(uint256 => address) public owners;

    function setOwner(uint256 id, address owner) external {
        owners[id] = owner;
    }

    function ownerOf(uint256 id) external view returns (address) {
        require(owners[id] != address(0), "burned or missing");
        return owners[id];
    }
}

contract SwarmHostileOwner {
    SwarmGasVault public vault;
    bool public rejectETH;
    bool public attempted;
    bool public reentered;

    function configure(SwarmGasVault vault_, bool reject_) external {
        vault = vault_;
        rejectETH = reject_;
    }

    function attempt() external {
        attempted = true;
        (reentered,) = address(vault)
            .call(
                abi.encodeCall(
                    SwarmGasVault.withdrawToOwner, (1 wei, vault.nonce(), block.timestamp + 60)
                )
            );
    }

    receive() external payable {
        require(!rejectETH, "reject withdrawal");
        this.attempt();
    }
}

/// @dev Hostile receive/owner behavior behind an otherwise exact canonical proxy/footer.
contract SwarmHostileAgent {
    uint256 public mode;
    address public callback;

    function configure(uint256 mode_, address callback_) external {
        mode = mode_;
        callback = callback_;
    }

    function token() public view returns (uint256 chain, address collection, uint256 id) {
        bytes memory footer = new bytes(0x60);
        assembly ("memory-safe") { extcodecopy(address(), add(footer, 0x20), 0x4d, 0x60) }
        return abi.decode(footer, (uint256, address, uint256));
    }

    function owner() external view returns (address) {
        if (mode == 4) return address(0xb0b);
        (, address collection, uint256 id) = token();
        return SwarmMockPunks(collection).ownerOf(id);
    }

    receive() external payable {
        if (mode == 1) revert("reject funding");
        if (mode == 2) SwarmHostileOwner(payable(callback)).attempt();
        if (mode == 3) {
            (, address collection, uint256 id) = token();
            SwarmMockPunks(collection).setOwner(id, address(0xb0b));
        }
    }
}

contract SwarmGasVaultTest {
    SwarmTestVm private constant vm =
        SwarmTestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ALICE = address(0xa11ce);
    address private constant BOB = address(0xb0b);
    address private constant PUNKS = 0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6;
    address private constant CANONICAL = 0x000000006551c19487814612e58FE06813775758;
    address private constant ENTRY_POINT = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;
    SwarmMockPunks private punks;
    GoghPunkAgentAccountRegistry private registry;
    GoghPunkAgentAccount private implementation;
    SwarmGasVaultFactory private factory;
    SwarmGasVault private vault;
    address private account1;
    address private account2;

    function setUp() public {
        vm.chainId(4663);
        vm.warp(1000);
        SwarmMockPunks mockPunks = new SwarmMockPunks();
        vm.etch(PUNKS, address(mockPunks).code);
        punks = SwarmMockPunks(PUNKS);
        SwarmCanonicalRegistry canonical = new SwarmCanonicalRegistry();
        vm.etch(CANONICAL, address(canonical).code);
        vm.etch(ENTRY_POINT, address(mockPunks).code);
        implementation = new GoghPunkAgentAccount(ENTRY_POINT, address(mockPunks));
        registry = new GoghPunkAgentAccountRegistry(address(implementation), bytes32(uint256(93)));
        factory = new SwarmGasVaultFactory(4663, PUNKS, address(registry), address(implementation));
        vm.prank(ALICE);
        vault = SwarmGasVault(payable(factory.createVault()));
        for (uint256 i = 1; i <= 11; ++i) {
            punks.setOwner(i, ALICE);
        }
        account1 = _activate(registry, ALICE, 1);
        account2 = _activate(registry, ALICE, 2);
        vm.deal(address(vault), 20 ether);
        vm.deal(ALICE, 20 ether);
    }

    function testFactoryOwnerIsolationAndIdempotentCreation() public {
        require(factory.getVault(ALICE) == address(vault) && factory.isVaultCreated(ALICE));
        vm.prank(ALICE);
        require(factory.createVault() == address(vault));
        vm.prank(BOB);
        SwarmGasVault other = SwarmGasVault(payable(factory.createVault()));
        require(address(other) != address(vault) && other.owner() == BOB);
        require(vault.owner() == ALICE && vault.chainId() == 4663);
        require(vault.registry() == address(registry) && vault.collection() == PUNKS);
        require(vault.implementation() == address(implementation));
        require(vault.registryCodeHash() == address(registry).codehash);
        require(vault.implementationCodeHash() == address(implementation).codehash);
        require(vault.accountSalt() == registry.accountSalt());
    }

    function testPredictedAddressDepositsSurviveCreationAndCanBeWithdrawn() public {
        address predicted = factory.getVault(BOB);
        vm.prank(ALICE);
        (bool sent,) = predicted.call{ value: 0.3 ether }("");
        require(sent && !factory.isVaultCreated(BOB));
        vm.prank(BOB);
        SwarmGasVault other = SwarmGasVault(payable(factory.createVault()));
        require(address(other) == predicted && predicted.balance == 0.3 ether);
        uint256 before = BOB.balance;
        vm.prank(BOB);
        other.withdrawToOwner(0.3 ether, 0, _deadline());
        require(BOB.balance == before + 0.3 ether && predicted.balance == 0);
    }

    function testDepositAndReceiveDoNotGrantAuthorityOrConsumeNonce() public {
        vm.prank(ALICE);
        vault.deposit{ value: 0.1 ether }();
        vm.deal(BOB, 1 ether);
        vm.prank(BOB);
        (bool success,) = address(vault).call{ value: 0.2 ether }("");
        require(success && address(vault).balance == 20.3 ether && vault.nonce() == 0);
        vm.prank(BOB);
        vm.expectRevert(SwarmGasVault.NotOwner.selector);
        vault.withdrawToOwner(1 wei, 0, _deadline());
    }

    function testBatchFundsRealAgentAccountsIncludingReceiveStorageWrites() public {
        _fund(vault, ALICE, _two(0.1 ether, 0.2 ether), 0);
        require(account1.balance == 0.1 ether && account2.balance == 0.2 ether);
        require(address(vault).balance == 19.7 ether && vault.nonce() == 1);
        require(GoghPunkAgentAccount(payable(account1)).state() == 1);
    }

    function testFuzzExactNativeAmountsAreConserved(uint96 first, uint96 second) public {
        uint256 a = uint256(first) % 1 ether + 1;
        uint256 b = uint256(second) % 1 ether + 1;
        _fund(vault, ALICE, _two(a, b), 0);
        require(account1.balance == a && account2.balance == b);
        require(address(vault).balance + a + b == 20 ether);
    }

    function testMaximumTenPunksAndTenETHAreAccepted() public {
        SwarmGasVault.Allocation[] memory batch = new SwarmGasVault.Allocation[](10);
        for (uint256 i; i < 10; ++i) {
            _activate(registry, ALICE, i + 1);
            batch[i] = SwarmGasVault.Allocation(i + 1, 1 ether);
        }
        _fund(vault, ALICE, batch, 0);
        require(address(vault).balance == 10 ether && vault.nonce() == 1);
    }

    function testUnauthorizedFundingDoesNotMoveAnything() public {
        vm.prank(BOB);
        vm.expectRevert(SwarmGasVault.NotOwner.selector);
        vault.fundBatch(_one(1, 1 wei), 0, _deadline());
        require(account1.balance == 0 && vault.nonce() == 0);
    }

    function testEmptyOrOversizedBatchRejected() public {
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVault.InvalidBatch.selector);
        vault.fundBatch(new SwarmGasVault.Allocation[](0), 0, _deadline());
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVault.InvalidBatch.selector);
        vault.fundBatch(new SwarmGasVault.Allocation[](11), 0, _deadline());
    }

    function testDuplicateOrUnsortedPunksRejected() public {
        SwarmGasVault.Allocation[] memory batch = _two(1, 1);
        batch[1].tokenId = 1;
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVault.InvalidBatch.selector);
        vault.fundBatch(batch, 0, _deadline());
        batch[0].tokenId = 2;
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVault.InvalidBatch.selector);
        vault.fundBatch(batch, 0, _deadline());
    }

    function testZeroAndOverOneETHAllocationRejected() public {
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVault.InvalidAmount.selector);
        vault.fundBatch(_one(1, 0), 0, _deadline());
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVault.InvalidAmount.selector);
        vault.fundBatch(_one(1, 1 ether + 1), 0, _deadline());
    }

    function testInsufficientVaultBalanceRejected() public {
        vm.deal(address(vault), 1 wei);
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVault.InsufficientBalance.selector);
        vault.fundBatch(_one(1, 2), 0, _deadline());
    }

    function testNonPayableBatchAndCreateRejectAttachedETH() public {
        vm.prank(ALICE);
        (bool success,) = address(vault).call{ value: 1 }(
            abi.encodeCall(SwarmGasVault.fundBatch, (_one(1, 1), 0, _deadline()))
        );
        require(!success && account1.balance == 0);
        vm.prank(ALICE);
        (success,) = address(factory).call{ value: 1 }(abi.encodeCall(factory.createVault, ()));
        require(!success);
    }

    function testTransferBeforeBatchRejectsAllAllocations() public {
        punks.setOwner(2, BOB);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(SwarmGasVault.PunkNotOwned.selector, 2));
        vault.fundBatch(_two(0.1 ether, 0.1 ether), 0, _deadline());
        require(account1.balance == 0 && account2.balance == 0 && vault.nonce() == 0);
    }

    function testBurnedPunkRejected() public {
        punks.setOwner(1, address(0));
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(SwarmGasVault.PunkNotOwned.selector, 1));
        vault.fundBatch(_one(1, 1), 0, _deadline());
    }

    function testCounterfactualAgentMustBeActivatedByHolderFirst() public {
        address pending = registry.account(3);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(SwarmGasVault.InvalidAccount.selector, 3));
        vault.fundBatch(_one(3, 1), 0, _deadline());
        require(pending.code.length == 0 && pending.balance == 0);
    }

    function testWrongAccountRuntimeOrTokenBindingRejected() public {
        vm.etch(account1, account2.code);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(SwarmGasVault.InvalidAccount.selector, 1));
        vault.fundBatch(_one(1, 1), 0, _deadline());
    }

    function testImplementationChangedBlocksFundingButNotWithdrawal() public {
        vm.etch(address(implementation), hex"00");
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVaultConfig.DependencyChanged.selector);
        vault.fundBatch(_one(1, 1), 0, _deadline());
        vm.prank(ALICE);
        vault.withdrawToOwner(1 ether, 0, _deadline());
        require(address(vault).balance == 19 ether);
    }

    function testRegistryChangedBlocksFundingAndFactoryCreation() public {
        vm.etch(address(registry), hex"00");
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVaultConfig.DependencyChanged.selector);
        vault.fundBatch(_one(1, 1), 0, _deadline());
        vm.prank(BOB);
        vm.expectRevert(SwarmGasVaultConfig.DependencyChanged.selector);
        factory.createVault();
    }

    function testWrongChainBlocksFundingWithdrawalDepositAndCreation() public {
        vm.chainId(1);
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVaultConfig.WrongChain.selector);
        vault.fundBatch(_one(1, 1), 0, _deadline());
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVaultConfig.WrongChain.selector);
        vault.withdrawToOwner(1, 0, _deadline());
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVaultConfig.WrongChain.selector);
        vault.deposit{ value: 1 }();
        vm.prank(BOB);
        vm.expectRevert(SwarmGasVaultConfig.WrongChain.selector);
        factory.createVault();
    }

    function testNonceReplayAndStaleBatchAfterWithdrawalRejected() public {
        _fund(vault, ALICE, _one(1, 1), 0);
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVault.InvalidNonce.selector);
        vault.fundBatch(_one(1, 1), 0, _deadline());
        vm.prank(ALICE);
        vault.withdrawToOwner(1, 1, _deadline());
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVault.InvalidNonce.selector);
        vault.fundBatch(_one(1, 1), 1, _deadline());
        require(vault.nonce() == 2 && account1.balance == 1);
    }

    function testExpiredAndOverlongDeadlineRejected() public {
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVault.InvalidDeadline.selector);
        vault.fundBatch(_one(1, 1), 0, block.timestamp);
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVault.InvalidDeadline.selector);
        vault.fundBatch(_one(1, 1), 0, block.timestamp + 901);
        uint256 expires = _deadline();
        vm.warp(expires + 1);
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVault.InvalidDeadline.selector);
        vault.withdrawToOwner(1, 0, expires);
    }

    function testWithdrawAllAfterEveryPunkTransferred() public {
        for (uint256 i = 1; i <= 11; ++i) {
            punks.setOwner(i, BOB);
        }
        uint256 before = ALICE.balance;
        vm.prank(ALICE);
        vault.withdrawToOwner(20 ether, 0, _deadline());
        require(ALICE.balance == before + 20 ether && address(vault).balance == 0);
    }

    function testFundedAccountFollowsPunkButUnusedVaultFundsRemainWithHolder() public {
        _fund(vault, ALICE, _one(1, 0.1 ether), 0);
        punks.setOwner(1, BOB);
        require(GoghPunkAgentAccount(payable(account1)).owner() == BOB);
        require(account1.balance == 0.1 ether && vault.owner() == ALICE);
        vm.prank(BOB);
        vm.expectRevert(SwarmGasVault.NotOwner.selector);
        vault.withdrawToOwner(1, 1, _deadline());
        vm.prank(ALICE);
        vault.withdrawToOwner(19.9 ether, 1, _deadline());
        require(address(vault).balance == 0 && account1.balance == 0.1 ether);
    }

    function testZeroAndExcessWithdrawalRejected() public {
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVault.InvalidAmount.selector);
        vault.withdrawToOwner(0, 0, _deadline());
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVault.InsufficientBalance.selector);
        vault.withdrawToOwner(21 ether, 0, _deadline());
        vm.prank(ALICE);
        vm.expectRevert(SwarmGasVault.InvalidAmount.selector);
        vault.deposit{ value: 0 }();
    }

    function testRevertingSecondRecipientRollsBackFirstTransferAndNonce() public {
        (SwarmGasVault other, address first, address second) = _hostileVault(ALICE);
        SwarmHostileAgent(payable(second)).configure(1, address(0));
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(SwarmGasVault.TransferFailed.selector, second));
        other.fundBatch(_two(0.1 ether, 0.1 ether), 0, _deadline());
        require(first.balance == 0 && second.balance == 0 && other.nonce() == 0);
        require(address(other).balance == 1 ether);
    }

    function testAgentOwnerMismatchRejectedEvenWithExactRuntime() public {
        (SwarmGasVault other, address first,) = _hostileVault(ALICE);
        SwarmHostileAgent(payable(first)).configure(4, address(0));
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(SwarmGasVault.InvalidAccount.selector, 1));
        other.fundBatch(_one(1, 1), 0, _deadline());
    }

    function testOwnershipChangeInsideReceiveRevertsEntireBatch() public {
        (SwarmGasVault other, address first, address second) = _hostileVault(ALICE);
        SwarmHostileAgent(payable(second)).configure(3, address(0));
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(SwarmGasVault.PunkNotOwned.selector, 2));
        other.fundBatch(_two(0.1 ether, 0.1 ether), 0, _deadline());
        require(
            first.balance == 0 && second.balance == 0 && other.nonce() == 0
                && punks.ownerOf(2) == ALICE
        );
    }

    function testOwnerCallbackCannotWithdrawDuringBatch() public {
        SwarmHostileOwner holder = new SwarmHostileOwner();
        (SwarmGasVault other, address first,) = _hostileVault(address(holder));
        holder.configure(other, false);
        SwarmHostileAgent(payable(first)).configure(2, address(holder));
        _fund(other, address(holder), _one(1, 0.1 ether), 0);
        require(holder.attempted() && !holder.reentered());
        require(address(other).balance == 0.9 ether && other.nonce() == 1);
    }

    function testOwnerCallbackCannotReenterWithdrawal() public {
        SwarmHostileOwner holder = new SwarmHostileOwner();
        vm.prank(address(holder));
        SwarmGasVault other = SwarmGasVault(payable(factory.createVault()));
        holder.configure(other, false);
        vm.deal(address(other), 1 ether);
        vm.prank(address(holder));
        other.withdrawToOwner(0.1 ether, 0, _deadline());
        require(holder.attempted() && !holder.reentered());
        require(address(other).balance == 0.9 ether && other.nonce() == 1);
    }

    function testOwnerWithdrawalFailureRetainsFundsAndNonce() public {
        SwarmHostileOwner holder = new SwarmHostileOwner();
        vm.prank(address(holder));
        SwarmGasVault other = SwarmGasVault(payable(factory.createVault()));
        holder.configure(other, true);
        vm.deal(address(other), 1 ether);
        vm.prank(address(holder));
        vm.expectRevert(
            abi.encodeWithSelector(SwarmGasVault.TransferFailed.selector, address(holder))
        );
        other.withdrawToOwner(0.1 ether, 0, _deadline());
        require(address(other).balance == 1 ether && other.nonce() == 0);
    }

    function testInvalidConstructorConfigurationRejected() public {
        vm.expectRevert(SwarmGasVaultConfig.WrongChain.selector);
        new SwarmGasVaultFactory(1, PUNKS, address(registry), address(implementation));
        vm.expectRevert(SwarmGasVaultConfig.InvalidConfiguration.selector);
        new SwarmGasVaultFactory(4663, ALICE, address(registry), address(implementation));
        SwarmMockPunks otherPunks = new SwarmMockPunks();
        vm.expectRevert(SwarmGasVaultConfig.InvalidConfiguration.selector);
        new SwarmGasVaultFactory(
            4663, address(otherPunks), address(registry), address(implementation)
        );
        vm.expectRevert(SwarmGasVaultConfig.InvalidConfiguration.selector);
        new SwarmGasVault(address(0), 4663, PUNKS, address(registry), address(implementation));
        vm.expectRevert(SwarmGasVaultConfig.InvalidConfiguration.selector);
        factory.getVault(address(0));
    }

    function _activate(GoghPunkAgentAccountRegistry facade, address holder, uint256 id)
        private
        returns (address)
    {
        vm.prank(holder);
        return facade.createAccount(id);
    }

    function _one(uint256 id, uint256 amount)
        private
        pure
        returns (SwarmGasVault.Allocation[] memory batch)
    {
        batch = new SwarmGasVault.Allocation[](1);
        batch[0] = SwarmGasVault.Allocation(id, amount);
    }

    function _two(uint256 first, uint256 second)
        private
        pure
        returns (SwarmGasVault.Allocation[] memory batch)
    {
        batch = new SwarmGasVault.Allocation[](2);
        batch[0] = SwarmGasVault.Allocation(1, first);
        batch[1] = SwarmGasVault.Allocation(2, second);
    }

    function _fund(
        SwarmGasVault target,
        address holder,
        SwarmGasVault.Allocation[] memory batch,
        uint256 nonce
    ) private {
        vm.prank(holder);
        target.fundBatch(batch, nonce, _deadline());
    }

    function _deadline() private view returns (uint256) {
        return block.timestamp + 60;
    }

    function _hostileVault(address holder)
        private
        returns (SwarmGasVault other, address first, address second)
    {
        SwarmHostileAgent hostile = new SwarmHostileAgent();
        GoghPunkAgentAccountRegistry facade =
            new GoghPunkAgentAccountRegistry(address(hostile), bytes32(uint256(7)));
        SwarmGasVaultFactory otherFactory =
            new SwarmGasVaultFactory(4663, PUNKS, address(facade), address(hostile));
        vm.prank(holder);
        other = SwarmGasVault(payable(otherFactory.createVault()));
        punks.setOwner(1, holder);
        punks.setOwner(2, holder);
        first = _activate(facade, holder, 1);
        second = _activate(facade, holder, 2);
        vm.deal(address(other), 1 ether);
    }
}
