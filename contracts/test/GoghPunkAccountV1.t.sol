// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { GoghPunkAccountRegistry } from "../src/GoghPunkAccountRegistry.sol";
import { GoghPunkAccountV1 } from "../src/GoghPunkAccountV1.sol";
import { IGoghAccountBatch } from "../src/interfaces/IGoghAccountStandards.sol";
import { ArtBrokerTestBase } from "./ArtBrokerTestBase.sol";
import { MockCanonicalGoghPunks } from "./mocks/TestInfrastructure.sol";

contract GoghPunkAccountV1Test is ArtBrokerTestBase {
    function testDeterministicAccountCreationAndBinding() public view {
        require(accountRegistry.account(TOKEN_ID) == address(account), "prediction mismatch");
        require(address(account).code.length != 0, "account missing");
        (uint256 chainId, address collection, uint256 tokenId) = account.token();
        require(chainId == 4663, "chain");
        require(collection == GOGH_PUNKS, "collection");
        require(tokenId == TOKEN_ID, "token");
        require(account.owner() == alice, "owner");
        require(account.isCanonicalGoghPunkAccount(), "canonical");
    }

    function testCreationIsIdempotentAndCounterfactualFundsSurvive() public {
        MockCanonicalGoghPunks(GOGH_PUNKS).mint(alice, 318);
        address predicted = accountRegistry.account(318);
        VM.deal(predicted, 0.25 ether);
        VM.prank(alice);
        address first = accountRegistry.createAccount(318);
        VM.prank(alice);
        address second = accountRegistry.createAccount(318);
        require(first == predicted && second == predicted, "not deterministic");
        require(first.balance == 0.25 ether, "funds lost");
    }

    function testRegistryRejectsWrongConfigurationNonOwnerAndMissingToken() public {
        VM.expectRevert(GoghPunkAccountRegistry.InvalidConfiguration.selector);
        accountRegistry.account(address(implementation), bytes32(uint256(1)), 4663, GOGH_PUNKS, 1);

        VM.expectRevert(
            abi.encodeWithSelector(GoghPunkAccountRegistry.NotTokenOwner.selector, bob, alice)
        );
        VM.prank(bob);
        accountRegistry.createAccount(TOKEN_ID);

        VM.expectRevert(
            abi.encodeWithSelector(GoghPunkAccountRegistry.TokenDoesNotExist.selector, 999)
        );
        VM.prank(alice);
        accountRegistry.createAccount(999);
    }

    function testCurrentOwnerCanExecuteAndNonOwnersCannot() public {
        uint256 beforeBalance = recipient.balance;
        VM.prank(alice);
        account.execute(recipient, 0.1 ether, "", 0);
        require(recipient.balance == beforeBalance + 0.1 ether, "owner execution failed");

        VM.expectRevert(
            abi.encodeWithSelector(GoghPunkAccountV1.NotAuthorized.selector, bob, alice)
        );
        VM.prank(bob);
        account.execute(recipient, 0, "", 0);
    }

    function testTransferImmediatelyChangesAuthority() public {
        VM.prank(alice);
        MockCanonicalGoghPunks(GOGH_PUNKS).transferFrom(alice, bob, TOKEN_ID);
        require(account.owner() == bob, "new owner not resolved");

        VM.expectRevert(
            abi.encodeWithSelector(GoghPunkAccountV1.NotAuthorized.selector, alice, bob)
        );
        VM.prank(alice);
        account.execute(recipient, 0, "", 0);

        VM.prank(bob);
        account.execute(recipient, 0.05 ether, "", 0);
    }

    function testGuardianDeployerAndAgentHaveNoWithdrawalPath() public {
        for (uint256 index; index < 3; ++index) {
            address attacker = index == 0 ? guardian : index == 1 ? address(this) : agent;
            VM.expectRevert(
                abi.encodeWithSelector(GoghPunkAccountV1.NotAuthorized.selector, attacker, alice)
            );
            VM.prank(attacker);
            account.execute(attacker, 0.1 ether, "", 0);
        }
        require(address(account).balance == 1 ether, "balance changed");
    }

    function testReceivesAndOwnerWithdrawsERC20ERC721AndERC1155() public {
        currency.mint(address(account), 100 ether);
        art.mint(address(account), 901);
        editions.mint(address(account), 44, 5);

        VM.startPrank(alice);
        account.execute(
            address(currency), 0, abi.encodeCall(IERC20.transfer, (recipient, 25 ether)), 0
        );
        account.execute(
            address(art),
            0,
            abi.encodeWithSignature(
                "transferFrom(address,address,uint256)", address(account), recipient, 901
            ),
            0
        );
        VM.stopPrank();
        require(currency.balanceOf(recipient) == 25 ether, "ERC20 withdrawal");
        require(art.ownerOf(901) == recipient, "ERC721 withdrawal");
        require(editions.balanceOf(address(account), 44) == 5, "ERC1155 receipt");
    }

    function testOwnerBatchAndUnsupportedOperations() public {
        IGoghAccountBatch.Call[] memory calls = new IGoghAccountBatch.Call[](2);
        calls[0] = IGoghAccountBatch.Call(recipient, 0.01 ether, "");
        calls[1] = IGoghAccountBatch.Call(recipient, 0.02 ether, "");
        VM.prank(alice);
        account.executeBatch(calls);

        VM.expectRevert(
            abi.encodeWithSelector(GoghPunkAccountV1.UnsupportedOperation.selector, uint8(1))
        );
        VM.prank(alice);
        account.execute(recipient, 0, "", 1);
    }

    function testCannotNestControllingPunkInsideItsOwnAccount() public {
        VM.prank(alice);
        MockCanonicalGoghPunks(GOGH_PUNKS).approve(address(account), TOKEN_ID);
        bytes memory transferCall = abi.encodeWithSignature(
            "transferFrom(address,address,uint256)", alice, address(account), TOKEN_ID
        );
        VM.expectRevert(
            abi.encodeWithSelector(
                GoghPunkAccountV1.ControllingTokenSelfTransfer.selector, TOKEN_ID
            )
        );
        VM.prank(alice);
        account.execute(GOGH_PUNKS, 0, transferCall, 0);
    }

    function testUnsafeExternalSelfTransferFailsClosedInsteadOfGrantingAuthority() public {
        VM.prank(alice);
        MockCanonicalGoghPunks(GOGH_PUNKS).transferFrom(alice, address(account), TOKEN_ID);
        require(account.owner() == address(0), "ownership cycle did not fail closed");

        VM.expectRevert(
            abi.encodeWithSelector(GoghPunkAccountV1.NotAuthorized.selector, alice, address(0))
        );
        VM.prank(alice);
        account.execute(recipient, 0, "", 0);
    }

    function testImplementationCannotBeUsedDirectly() public {
        VM.expectRevert(GoghPunkAccountV1.DirectImplementationCall.selector);
        implementation.token();
        require(implementation.owner() == address(0), "implementation owner");
        require(!implementation.isCanonicalGoghPunkAccount(), "implementation canonical");
    }

    function testOwnerCanCancelEveryPendingProposal() public {
        VM.prank(alice);
        account.cancelPendingAcquisitions(19);
        require(account.acquisitionNonce() == 19, "nonce not advanced");
        VM.expectRevert(
            abi.encodeWithSelector(GoghPunkAccountV1.InvalidCancellationNonce.selector, 19, 19)
        );
        VM.prank(alice);
        account.cancelPendingAcquisitions(19);
    }

    function testPersistentStandardApprovalsAreForbiddenAndRevocable() public {
        currency.mint(address(account), 100 ether);
        art.mint(address(account), 902);

        bytes memory erc20Approval = abi.encodeCall(IERC20.approve, (alice, 50 ether));
        VM.expectRevert(
            abi.encodeWithSelector(
                GoghPunkAccountV1.PersistentApprovalForbidden.selector, IERC20.approve.selector
            )
        );
        VM.prank(alice);
        account.execute(address(currency), 0, erc20Approval, 0);

        bytes memory nftApproval = abi.encodeWithSignature("approve(address,uint256)", alice, 902);
        VM.expectRevert(
            abi.encodeWithSelector(
                GoghPunkAccountV1.PersistentApprovalForbidden.selector, IERC20.approve.selector
            )
        );
        VM.prank(alice);
        account.execute(address(art), 0, nftApproval, 0);

        bytes4 operatorSelector = bytes4(keccak256("setApprovalForAll(address,bool)"));
        VM.expectRevert(
            abi.encodeWithSelector(
                GoghPunkAccountV1.PersistentApprovalForbidden.selector, operatorSelector
            )
        );
        VM.prank(alice);
        account.execute(
            address(art),
            0,
            abi.encodeWithSignature("setApprovalForAll(address,bool)", alice, true),
            0
        );

        // Simulate legacy/external approval state and prove the explicit owner recovery paths clear it.
        VM.prank(address(account));
        currency.approve(alice, 50 ether);
        VM.prank(address(account));
        art.approve(alice, 902);
        VM.prank(address(account));
        art.setApprovalForAll(alice, true);

        VM.startPrank(alice);
        account.revokeERC20Allowance(address(currency), alice);
        account.revokeERC721Approval(address(art), 902);
        account.revokeOperatorApproval(address(art), alice);
        VM.stopPrank();

        require(currency.allowance(address(account), alice) == 0, "ERC20 approval remains");
        require(art.getApproved(902) == address(0), "ERC721 approval remains");
        require(!art.isApprovedForAll(address(account), alice), "operator approval remains");

        VM.prank(alice);
        MockCanonicalGoghPunks(GOGH_PUNKS).transferFrom(alice, bob, TOKEN_ID);
        VM.prank(alice);
        (bool staleAllowanceSucceeded,) = address(currency)
            .call(abi.encodeCall(IERC20.transferFrom, (address(account), alice, 1 ether)));
        require(!staleAllowanceSucceeded, "revoked ERC20 allowance still spendable");
        VM.expectRevert();
        VM.prank(alice);
        art.transferFrom(address(account), alice, 902);
    }

    function testGeneralAccountSignaturesAreDisabled() public view {
        bytes4 result = account.isValidSignature(bytes32(uint256(1)), hex"1234");
        require(result == bytes4(0), "general account signature enabled");
        require(result != IERC1271.isValidSignature.selector, "ERC1271 magic returned");
    }
}
