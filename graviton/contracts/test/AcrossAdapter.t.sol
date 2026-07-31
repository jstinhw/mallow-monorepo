// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {AcrossAdapter} from "../src/adapters/AcrossAdapter.sol";
import {ISpokePool} from "../src/interfaces/across/ISpokePool.sol";
import {IInteropExecutor} from "../src/interfaces/IInteropExecutor.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {Order, SrcIntent, ValidationCall, ExecutionCall, TargetIntent} from "../src/types/Structs.sol";
import {NATIVE_TOKEN} from "../src/types/Constants.sol";
import {WETH} from "solady/tokens/WETH.sol";

contract MockSpokePool is ISpokePool {
    address public immutable WRAPPED_NATIVE_TOKEN_ADDRESS;

    constructor(address _weth) {
        WRAPPED_NATIVE_TOKEN_ADDRESS = _weth;
    }

    event DepositV3Called(
        address depositor,
        address recipient,
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 outputAmount,
        uint256 destinationChainId,
        address exclusiveRelayer,
        uint32 quoteTimestamp,
        uint32 fillDeadline,
        uint32 exclusivityDeadline,
        bytes message
    );

    function depositV3(
        address depositor,
        address recipient,
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 outputAmount,
        uint256 destinationChainId,
        address exclusiveRelayer,
        uint32 quoteTimestamp,
        uint32 fillDeadline,
        uint32 exclusivityDeadline,
        bytes calldata message
    ) external payable override {
        emit DepositV3Called(
            depositor,
            recipient,
            inputToken,
            outputToken,
            inputAmount,
            outputAmount,
            destinationChainId,
            exclusiveRelayer,
            quoteTimestamp,
            fillDeadline,
            exclusivityDeadline,
            message
        );
    }

    function depositV3Now(
        address,
        address,
        address,
        address,
        uint256,
        uint256,
        uint256,
        address,
        uint32,
        uint32,
        bytes calldata
    ) external payable override {}

    function fillV3Relay(V3RelayData calldata, uint256) external override {}

    function wrappedNativeToken() external view override returns (address) {
        return WRAPPED_NATIVE_TOKEN_ADDRESS;
    }

    function getCurrentTime() external view override returns (uint32) {
        return uint32(block.timestamp);
    }

    function fillDeadlineBuffer() external pure override returns (uint32) {
        return 0;
    }
}

contract MockInteropExecutor is IInteropExecutor {
    event FillCalled(Order order, uint256 value);

    Order private _lastOrder;
    uint256 public lastValue;

    function fill(Order calldata order, address, uint256) external payable override {
        _lastOrder = order;
        lastValue = msg.value;
        emit FillCalled(order, msg.value);
    }

    function getLastOrder() external view returns (Order memory) {
        return _lastOrder;
    }

    function open(Order calldata) external payable override {}
}

contract AcrossAdapterTest is Test {
    AcrossAdapter adapter;
    MockSpokePool spokePool;
    MockInteropExecutor interopExecutor;
    WETH weth;
    MockERC20 token;

    address user = makeAddr("user");
    address relayer = makeAddr("relayer");

    function setUp() public {
        weth = new WETH();
        spokePool = new MockSpokePool(address(weth));
        interopExecutor = new MockInteropExecutor();
        token = new MockERC20("Test", "TST", 18);

        adapter = new AcrossAdapter(address(spokePool), address(interopExecutor), address(weth));

        vm.deal(user, 100 ether);
        token.mint(user, 1000 ether);
    }

    function _createEmptyOrder() internal view returns (Order memory) {
        SrcIntent memory emptyIntent;
        TargetIntent memory targetIntent = TargetIntent({
            nonce: 1,
            chainId: 2,
            token: address(token),
            amount: 100,
            validations: new ValidationCall[](0),
            executions: new ExecutionCall[](0)
        });

        return Order({
            sender: user,
            openDeadline: uint32(block.timestamp + 1000),
            fillDeadline: uint32(block.timestamp + 1000),
            initData: "",
            targetIntent: targetIntent,
            srcIntent: emptyIntent,
            signature: ""
        });
    }

    function test_InitiateDeposit_Native() public {
        uint256 amount = 1 ether;
        Order memory order = _createEmptyOrder();
        order.targetIntent.token = NATIVE_TOKEN;
        order.targetIntent.amount = amount;

        uint32 quoteTimestamp = uint32(block.timestamp);
        uint32 exclusivityDeadline = uint32(block.timestamp + 100);
        uint32 fillDeadline = uint32(block.timestamp + 200);

        bytes memory adapterData = abi.encode(relayer, quoteTimestamp, exclusivityDeadline, fillDeadline);

        vm.prank(user);

        vm.expectEmit(true, true, true, true, address(spokePool));
        emit MockSpokePool.DepositV3Called(
            user,
            address(adapter),
            address(weth),
            order.targetIntent.token,
            amount,
            order.targetIntent.amount,
            order.targetIntent.chainId,
            relayer,
            quoteTimestamp,
            fillDeadline,
            exclusivityDeadline,
            abi.encode(order)
        );

        adapter.initiateBridge{value: amount}(NATIVE_TOKEN, amount, adapterData, order);
    }

    function test_InitiateDeposit_ERC20() public {
        uint256 amount = 100 ether;
        Order memory order = _createEmptyOrder();
        order.targetIntent.token = address(token);
        order.targetIntent.amount = amount;

        uint32 quoteTimestamp = uint32(block.timestamp);
        uint32 exclusivityDeadline = uint32(block.timestamp + 100);
        uint32 fillDeadline = uint32(block.timestamp + 200);

        bytes memory adapterData = abi.encode(relayer, quoteTimestamp, exclusivityDeadline, fillDeadline);

        vm.startPrank(user);
        token.approve(address(adapter), amount);

        vm.expectEmit(true, true, true, true, address(spokePool));
        emit MockSpokePool.DepositV3Called(
            user,
            address(adapter),
            address(token),
            order.targetIntent.token,
            amount,
            order.targetIntent.amount,
            order.targetIntent.chainId,
            relayer,
            quoteTimestamp,
            fillDeadline,
            exclusivityDeadline,
            abi.encode(order)
        );

        adapter.initiateBridge(address(token), amount, adapterData, order);
        vm.stopPrank();

        uint256 allowance = token.allowance(address(adapter), address(spokePool));
        assertEq(allowance, amount);
    }

    function test_HandleV3AcrossMessage_Native() public {
        uint256 amount = 1 ether;
        Order memory order = _createEmptyOrder();
        order.targetIntent.token = NATIVE_TOKEN;

        bytes memory message = abi.encode(order);

        deal(address(weth), address(adapter), amount);
        vm.deal(address(weth), amount);

        vm.prank(address(spokePool));

        adapter.handleV3AcrossMessage(address(weth), amount, relayer, message);

        assertEq(weth.balanceOf(address(adapter)), 0, "Adapter WETH balance should be 0");
        assertEq(address(interopExecutor).balance, amount, "Executor should have received ETH");
        assertEq(interopExecutor.lastValue(), amount, "Executor should have received correct value");
        assertEq(interopExecutor.getLastOrder().targetIntent.token, NATIVE_TOKEN, "Order passed correctly");
    }

    function test_HandleV3AcrossMessage_ERC20() public {
        uint256 amount = 100 ether;
        Order memory order = _createEmptyOrder();
        order.targetIntent.token = address(token);

        bytes memory message = abi.encode(order);

        token.mint(address(adapter), amount);

        vm.prank(address(spokePool));

        adapter.handleV3AcrossMessage(address(token), amount, relayer, message);

        uint256 allowance = token.allowance(address(adapter), address(interopExecutor));
        assertEq(allowance, amount);

        assertEq(interopExecutor.lastValue(), 0);
        assertEq(interopExecutor.getLastOrder().targetIntent.token, address(token));
    }

    function test_Revert_HandleV3AcrossMessage_NotSpokePool() public {
        vm.expectRevert(AcrossAdapter.NotSpokePool.selector);
        adapter.handleV3AcrossMessage(address(token), 100, relayer, "");
    }

    function test_Receive() public {
        (bool success,) = address(adapter).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(address(adapter).balance, 1 ether);
    }
}
