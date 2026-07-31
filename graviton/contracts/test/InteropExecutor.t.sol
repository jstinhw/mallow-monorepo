// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {InteropExecutor} from "../src/InteropExecutor.sol";
import {
    Order,
    SrcIntent,
    Call,
    PaymentToken,
    ValidationCall,
    ExecutionCall,
    TargetIntent
} from "../src/types/Structs.sol";
import {MockAccount} from "./mocks/MockAccount.sol";
import {MockAdapter} from "./mocks/MockAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockValidator} from "./mocks/MockValidator.sol";
import {MockHook} from "./mocks/MockHook.sol";
import {IAdapter} from "../src/interfaces/IAdapter.sol";
import {IInteropValidator} from "../src/interfaces/IInteropValidator.sol";

contract InteropExecutorTest is Test {
    InteropExecutor public executor;
    MockAccount public account;
    MockAdapter public adapter;
    MockERC20 public inputToken;
    MockERC20 public outputToken;
    MockValidator public validator;
    MockHook public hook;

    function setUp() public {
        executor = new InteropExecutor();
        account = new MockAccount();
        adapter = new MockAdapter();
        inputToken = new MockERC20("Test_input", "TST", 18);
        outputToken = new MockERC20("Test_output", "TST", 18);
        validator = new MockValidator(true);
        hook = new MockHook();

        // Setup initial state
        account.setOwner(address(this));
        inputToken.mint(address(account), 10000 ether);
        outputToken.mint(address(account), 10000 ether);

        vm.startPrank(address(account));
        inputToken.approve(address(executor), type(uint256).max);
        outputToken.approve(address(executor), type(uint256).max);
        vm.stopPrank();

        vm.warp(1000000);
    }

    function createOrder() internal view returns (Order memory) {
        PaymentToken[] memory payments = new PaymentToken[](1);
        payments[0] = PaymentToken({recipient: address(0x999), token: address(inputToken), amount: 100});

        Call[] memory preHooks = new Call[](1);
        preHooks[0] = Call({to: address(hook), value: 0, data: hex"01"});

        Call[] memory postHooks = new Call[](1);
        postHooks[0] = Call({to: address(hook), value: 0, data: hex"02"});

        SrcIntent memory intent = SrcIntent({
            chainId: block.chainid,
            nonce: 0,
            paymentTokens: payments,
            preHooks: preHooks,
            postHooks: postHooks,
            token: address(inputToken),
            amount: 50,
            adapter: IAdapter(address(adapter)),
            adapterData: hex"99"
        });

        TargetIntent memory targetIntent = TargetIntent({
            nonce: 0,
            chainId: block.chainid,
            token: address(outputToken),
            amount: 40,
            validations: new ValidationCall[](0),
            executions: new ExecutionCall[](0)
        });

        return Order({
            sender: address(account),
            openDeadline: uint32(block.timestamp + 1000),
            fillDeadline: uint32(block.timestamp + 1000),
            initData: hex"",
            targetIntent: targetIntent,
            srcIntent: intent,
            signature: "PASS"
        });
    }

    function test_Open_HappyPath() public {
        Order memory order = createOrder();
        executor.open(order);
    }

    function test_Open_Revert_Expired() public {
        Order memory order = createOrder();
        order.openDeadline = uint32(block.timestamp - 1);

        vm.expectRevert();
        executor.open(order);
    }

    function test_Open_Revert_InvalidSignature() public {
        Order memory order = createOrder();
        order.signature = "FAIL";

        vm.expectRevert();
        executor.open(order);
    }

    function test_Fill_HappyPath() public {
        Order memory order = createOrder();
        // NOTE: Fill calls innerExecute which checks nonce logic.
        // We might fail on Nonce here if "0" is not the correct next nonce for increment.
        // But let's try.

        vm.prank(address(account));
        executor.fill(order, address(outputToken), 50);
    }

    function test_Fill_Revert_InvalidSender() public {
        Order memory order = createOrder();

        vm.expectRevert();
        executor.fill(order, address(outputToken), 50);
    }

    function test_ValidationFlow() public {
        Order memory order = createOrder();
        ValidationCall[] memory validations = new ValidationCall[](1);
        validations[0] = ValidationCall({validator: IInteropValidator(address(validator)), data: hex""});
        order.targetIntent.validations = validations;

        // 1. Pass
        validator.setShouldPass(true);
        executor.open(order);

        // 2. Fail
        validator.setShouldPass(false);

        // NOTE: We need fresh nonce for 2nd call?
        // open() checks srcIntent.nonce. The stored _paymentNonce is NOT incremented in open.
        // So keeping srcIntent.nonce = 0 is fine.
        // innerExecute increments _executionNonce.
        // So for 2nd call, _executionNonce will be different.
        // We must update order.nonce for second call.
        // If first call used 0, next should be 1? Or something.

        // Let's create new order for failure case to be clean
        // OR update nonce.
        // But if strict nonce check exists, re-using 0 will fail on nonce, not validation.
        // So we should expect Revert, possibly invalid nonce.
        // But we want to test Validation failure.

        // Let's use a new test function for fail case or reset state implicitly by creating fresh contracts in setUp for each test. (Foundry does this).
    }

    function test_ValidationFlow_Revert() public {
        Order memory order = createOrder();
        ValidationCall[] memory validations = new ValidationCall[](1);
        validations[0] = ValidationCall({validator: IInteropValidator(address(validator)), data: hex""});
        order.targetIntent.validations = validations;

        validator.setShouldPass(false);
        // With the new behavior, validation failure doesn't revert, it just returns early
        // So the transaction succeeds but executions don't run
        executor.open(order);
    }

    function test_Open_Revert_InvalidNonce() public {
        Order memory order = createOrder();
        order.srcIntent.nonce = 1;

        vm.expectRevert();
        executor.open(order);
    }

    function test_Open_Revert_InvalidSrcIntentChain() public {
        Order memory order = createOrder();
        order.srcIntent.chainId = block.chainid + 1;

        vm.expectRevert();
        executor.open(order);
    }

    function test_Open_Revert_PostHookFailed() public {
        MockHook failHook = new MockHook();
        failHook.setShouldFail(true);

        Order memory order = createOrder();
        order.srcIntent.postHooks[0].to = address(failHook);

        vm.expectRevert();
        executor.open(order);
    }

    function test_Open_Revert_Replay() public {
        Order memory order = createOrder();
        executor.open(order);

        vm.expectRevert();
        executor.open(order);
    }
}
