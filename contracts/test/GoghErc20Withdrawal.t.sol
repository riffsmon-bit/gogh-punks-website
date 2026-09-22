// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { GoghPunkAccountV3 } from "../src/GoghPunkAccountV3.sol";
import { GoghPunkAgentAccount } from "../src/GoghPunkAgentAccount.sol";
import { GoghPunkAccountRegistry } from "../src/GoghPunkAccountRegistry.sol";
import { IGoghAccountBatch } from "../src/interfaces/IGoghAccountStandards.sol";
import { ArtBrokerTestBase } from "./ArtBrokerTestBase.sol";
import { MockCanonicalGoghPunks } from "./mocks/TestInfrastructure.sol";

interface WithdrawalAccount {
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory);
    function executeBatch(IGoghAccountBatch.Call[] calldata calls)
        external
        payable
        returns (bytes[] memory);
}

contract WithdrawalProbeToken {
    mapping(address => uint256) public balanceOf;
    uint256 public fee;
    bool public returnFalse;
    bool public attack;
    bool public callbackSucceeded;

    function configure(uint256 fee_, bool false_, bool attack_) external {
        fee = fee_;
        returnFalse = false_;
        attack = attack_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (returnFalse) return false;
        if (attack) {
            (callbackSucceeded,) = msg.sender
                .call(
                    abi.encodeCall(
                        WithdrawalAccount.execute, (address(this), 1 ether, bytes(""), 0)
                    )
                );
        }
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount - fee;
        return true;
    }
}

contract GoghErc20WithdrawalTest is ArtBrokerTestBase {
    address private constant ENTRY_POINT = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;
    WithdrawalAccount private v3;
    WithdrawalAccount private agentAccount;
    WithdrawalProbeToken private token;

    function setUp() public override {
        super.setUp();
        GoghPunkAccountV3 v3Implementation =
            new GoghPunkAccountV3(address(policy), address(agents), address(adapters));
        GoghPunkAccountRegistry v3Registry =
            new GoghPunkAccountRegistry(address(v3Implementation), bytes32(0));
        VM.prank(alice);
        v3 = WithdrawalAccount(v3Registry.createAccount(TOKEN_ID));
        VM.etch(ENTRY_POINT, hex"60006000f3");
        GoghPunkAgentAccount agentImplementation =
            new GoghPunkAgentAccount(ENTRY_POINT, address(adapters));
        GoghPunkAccountRegistry agentRegistry =
            new GoghPunkAccountRegistry(address(agentImplementation), bytes32(0));
        VM.prank(alice);
        agentAccount = WithdrawalAccount(agentRegistry.createAccount(TOKEN_ID));
        token = new WithdrawalProbeToken();
        token.mint(address(v3), 100);
        token.mint(address(agentAccount), 100);
        VM.deal(address(v3), 1 ether);
        VM.deal(address(agentAccount), 1 ether);
    }

    function batch(WithdrawalAccount target) private returns (bytes[] memory) {
        IGoghAccountBatch.Call[] memory calls = new IGoghAccountBatch.Call[](5);
        calls[0] = IGoghAccountBatch.Call(
            address(token), 0, abi.encodeCall(IERC20.balanceOf, (address(target)))
        );
        calls[1] =
            IGoghAccountBatch.Call(address(token), 0, abi.encodeCall(IERC20.balanceOf, (alice)));
        calls[2] =
            IGoghAccountBatch.Call(address(token), 0, abi.encodeCall(IERC20.transfer, (alice, 25)));
        calls[3] = calls[0];
        calls[4] = calls[1];
        VM.prank(alice);
        return target.executeBatch(calls);
    }

    function testBalanceDeltaSimulationMatchesBothRealAccountImplementations() public {
        for (uint256 i; i < 2; i++) {
            WithdrawalAccount target = i == 0 ? v3 : agentAccount;
            uint256 ownerBefore = token.balanceOf(alice);
            bytes[] memory result = batch(target);
            require(abi.decode(result[0], (uint256)) == 100, "source before");
            require(abi.decode(result[1], (uint256)) == ownerBefore, "owner before");
            require(abi.decode(result[2], (bool)), "transfer result");
            require(abi.decode(result[3], (uint256)) == 75, "source after");
            require(abi.decode(result[4], (uint256)) == ownerBefore + 25, "owner after");
            require(address(target).balance == 1 ether, "ETH was spent");
        }
    }

    function testMaliciousTokenCannotReenterEitherWalletAndDrainETH() public {
        token.configure(0, false, true);
        batch(v3);
        require(!token.callbackSucceeded(), "V3 callback drained wallet");
        batch(agentAccount);
        require(!token.callbackSucceeded(), "Agent callback drained wallet");
        require(
            address(v3).balance == 1 ether && address(agentAccount).balance == 1 ether, "lost ETH"
        );
    }

    function testFalseAndFeeTokenResultsAreObservableAndMustNotBeTreatedAsSuccess() public {
        token.configure(0, true, false);
        bytes[] memory falseResult = batch(v3);
        require(!abi.decode(falseResult[2], (bool)), "false hidden");
        require(abi.decode(falseResult[3], (uint256)) == 100, "false moved tokens");
        token.configure(1, false, false);
        bytes[] memory feeResult = batch(agentAccount);
        require(abi.decode(feeResult[3], (uint256)) == 75, "debit changed");
        require(abi.decode(feeResult[4], (uint256)) == 24, "fee invisible");
    }

    function testTransferRevokesOldOwnerAndAllowsNewOwnerForBothAccounts() public {
        VM.prank(alice);
        MockCanonicalGoghPunks(GOGH_PUNKS).transferFrom(alice, bob, TOKEN_ID);
        for (uint256 i; i < 2; i++) {
            WithdrawalAccount target = i == 0 ? v3 : agentAccount;
            VM.expectRevert();
            VM.prank(alice);
            target.execute(address(token), 0, abi.encodeCall(IERC20.transfer, (alice, 25)), 0);
            VM.prank(bob);
            bytes memory result =
                target.execute(address(token), 0, abi.encodeCall(IERC20.transfer, (bob, 25)), 0);
            require(abi.decode(result, (bool)), "new owner failed");
        }
        require(token.balanceOf(bob) == 50, "new owner delivery");
    }

    function testApprovalsAndDelegatecallsRemainForbiddenOnBothAccounts() public {
        for (uint256 i; i < 2; i++) {
            WithdrawalAccount target = i == 0 ? v3 : agentAccount;
            VM.expectRevert();
            VM.prank(alice);
            target.execute(address(token), 0, abi.encodeCall(IERC20.approve, (bob, 100)), 0);
            VM.expectRevert();
            VM.prank(alice);
            target.execute(address(token), 0, abi.encodeCall(IERC20.transfer, (alice, 25)), 1);
        }
    }
}
