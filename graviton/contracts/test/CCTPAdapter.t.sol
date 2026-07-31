// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {CCTPAdapter} from "../src/adapters/CCTPAdapter.sol";
import {ITokenMessagerV2} from "../src/interfaces/cctp/ITokenMessagerV2.sol";
import {IMessageTransmitterV2} from "../src/interfaces/cctp/IMessageTransmitterV2.sol";
import {IInteropExecutor} from "../src/interfaces/IInteropExecutor.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {Order, SrcIntent, TargetIntent, ValidationCall, ExecutionCall} from "../src/types/Structs.sol";
import {NATIVE_TOKEN} from "../src/types/Constants.sol";

contract MockTokenMessagerV2 is ITokenMessagerV2 {
    event DepositForBurnCalled(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    );

    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes memory hookData
    ) external override {
        emit DepositForBurnCalled(
            amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold
        );
    }
}

contract MockMessageTransmitterV2 is IMessageTransmitterV2 {
    bool public shouldFail;

    function setShouldFail(bool _shouldFail) external {
        shouldFail = _shouldFail;
    }

    function receiveMessage(bytes calldata, bytes calldata) external view override returns (bool success) {
        return !shouldFail;
    }
}

contract MockInteropExecutor is IInteropExecutor {
    event FillCalled(Order order, address token, uint256 amount);

    Order private _lastOrder;
    address private _lastToken;
    uint256 private _lastAmount;

    function fill(Order calldata order, address token, uint256 amount) external payable override {
        _lastOrder = order;
        _lastToken = token;
        _lastAmount = amount;
        emit FillCalled(order, token, amount);
    }

    function getLastFillData() external view returns (Order memory, address, uint256) {
        return (_lastOrder, _lastToken, _lastAmount);
    }

    function open(Order calldata) external payable override {}
}

contract CCTPAdapterTest is Test {
    CCTPAdapter adapter;
    MockTokenMessagerV2 tokenMessenger;
    MockMessageTransmitterV2 messageTransmitter;
    MockInteropExecutor interopExecutor;
    MockERC20 usdc;
    MockERC20 otherToken;

    address user = makeAddr("user");

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC", 6);
        otherToken = new MockERC20("Other", "OT", 18);
        tokenMessenger = new MockTokenMessagerV2();
        messageTransmitter = new MockMessageTransmitterV2();
        interopExecutor = new MockInteropExecutor();

        adapter = new CCTPAdapter(
            address(usdc), address(tokenMessenger), address(messageTransmitter), address(interopExecutor)
        );

        vm.deal(user, 100 ether);
        usdc.mint(user, 1000 * 10 ** 6);
        otherToken.mint(user, 1000 * 10 ** 18);
    }

    function _createEmptyOrder() internal view returns (Order memory) {
        SrcIntent memory emptyIntent;
        TargetIntent memory targetIntent = TargetIntent({
            nonce: 1,
            chainId: 2,
            token: address(usdc),
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

    /*
     * _initiateDeposit Tests
     */

    function test_InitiateDeposit_USDC() public {
        uint256 amount = 100 * 10 ** 6;
        Order memory order = _createEmptyOrder();
        order.targetIntent.token = address(usdc);
        order.targetIntent.amount = amount;

        uint32 destinationDomain = 1;
        bytes32 destinationCaller = bytes32(uint256(uint160(makeAddr("caller"))));
        uint256 maxFee = 0;
        uint32 minFinalityThreshold = 0;

        bytes memory adapterData = abi.encode(destinationDomain, destinationCaller, maxFee, minFinalityThreshold);

        vm.startPrank(user);
        usdc.approve(address(adapter), amount);

        vm.expectEmit(true, true, true, true, address(tokenMessenger));
        emit MockTokenMessagerV2.DepositForBurnCalled(
            amount,
            destinationDomain,
            bytes32(uint256(uint160(address(adapter)))), // mintRecipient should be adapter address padded
            address(usdc),
            destinationCaller,
            maxFee,
            minFinalityThreshold
        );

        adapter.initiateBridge(address(usdc), amount, adapterData, order);
        vm.stopPrank();
    }

    function test_Revert_InitiateDeposit_MalformedData() public {
        uint256 amount = 100 * 10 ** 6;
        Order memory order = _createEmptyOrder();
        order.targetIntent.token = address(usdc);
        order.targetIntent.amount = amount;

        // Malformed data (too short)
        bytes memory adapterData = abi.encode(uint32(1));

        vm.startPrank(user);
        usdc.approve(address(adapter), amount);

        vm.expectRevert();
        adapter.initiateBridge(address(usdc), amount, adapterData, order);
        vm.stopPrank();
    }

    function test_Revert_InitiateDeposit_NotUSDC_Native() public {
        uint256 amount = 1 ether;
        Order memory order = _createEmptyOrder();
        // Even if we mock it, BaseAdapter's initiateBridge handles transfer first, then calls _initiateDeposit
        // _initiateDeposit checks token address

        bytes memory adapterData = "";

        vm.prank(user);
        vm.expectRevert(CCTPAdapter.NotUSDC.selector);
        adapter.initiateBridge{value: amount}(NATIVE_TOKEN, amount, adapterData, order);
    }

    function test_Revert_InitiateDeposit_NotUSDC_ERC20() public {
        uint256 amount = 100 * 10 ** 18;
        Order memory order = _createEmptyOrder();

        vm.startPrank(user);
        otherToken.approve(address(adapter), amount);

        vm.expectRevert(CCTPAdapter.NotUSDC.selector);
        adapter.initiateBridge(address(otherToken), amount, "", order);
        vm.stopPrank();
    }

    /*
     * receiveMessage Tests
     */

    function _createMessage(Order memory order) internal pure returns (bytes memory) {
        bytes memory messagePrefix = new bytes(376);
        // Set messageVersion at 0 to 1
        messagePrefix[3] = 0x01;
        // Set messageBodyVersion at 148 to 1
        messagePrefix[151] = 0x01;

        bytes memory messageBody = abi.encode(order);
        return abi.encodePacked(messagePrefix, messageBody);
    }

    function test_ReceiveMessage_HappyPath() public {
        uint256 amount = 100 * 10 ** 6;
        Order memory order = _createEmptyOrder();
        order.targetIntent.token = address(usdc);
        order.targetIntent.amount = amount;

        bytes memory message = _createMessage(order);
        bytes memory attestation = hex"1234";

        // Fund adapter with USDC (as if it was minted to it via MESSAGE_TRANSMITTER_V2)
        // In reality, MESSAGE_TRANSMITTER_V2 would transfer tokens to the adapter (mintRecipient)
        usdc.mint(address(adapter), amount);

        vm.expectEmit(true, true, true, true, address(interopExecutor));
        emit MockInteropExecutor.FillCalled(order, address(usdc), amount);

        adapter.receiveMessage(message, attestation);

        // Check allowance
        uint256 allowance = usdc.allowance(address(adapter), address(interopExecutor));
        assertEq(allowance, amount);
    }

    function test_Revert_ReceiveMessage_TransmitterFailed() public {
        Order memory order = _createEmptyOrder();
        bytes memory message = _createMessage(order);
        bytes memory attestation = "";

        messageTransmitter.setShouldFail(true);

        vm.expectRevert(CCTPAdapter.ReceiveMessageFailed.selector);
        adapter.receiveMessage(message, attestation);
    }

    function test_Revert_ReceiveMessage_InvalidVersion() public {
        Order memory order = _createEmptyOrder();
        bytes memory message = _createMessage(order);

        // Corrupt message version
        message[3] = 0x02;

        vm.expectRevert(CCTPAdapter.InvalidMessageVersion.selector);
        adapter.receiveMessage(message, "");
    }

    function test_Revert_ReceiveMessage_InvalidBodyVersion() public {
        Order memory order = _createEmptyOrder();
        bytes memory message = _createMessage(order);

        // Corrupt body version
        message[151] = 0x02;

        vm.expectRevert(CCTPAdapter.InvalidMessageVersion.selector);
        adapter.receiveMessage(message, "");
    }

    function test_Revert_ReceiveMessage_TooShort() public {
        bytes memory message = new bytes(375); // Too short
        // Fix versions so we don't fail there first (if they are checked before length? No, length is checked after versions in current code?
        // Actually code checks versions first.
        message[3] = 0x01;
        message[151] = 0x01;

        vm.expectRevert(CCTPAdapter.MessageBodyLengthTooShort.selector);
        adapter.receiveMessage(message, "");
    }

    function test_Revert_ReceiveMessage_NotUSDC() public {
        uint256 amount = 100 * 10 ** 6;
        Order memory order = _createEmptyOrder();
        order.targetIntent.token = address(otherToken); // Not USDC

        bytes memory message = _createMessage(order);

        vm.expectRevert(CCTPAdapter.NotUSDC.selector);
        adapter.receiveMessage(message, "");
    }

    function test_Receive() public {
        (bool success,) = address(adapter).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(address(adapter).balance, 1 ether);
    }
}
