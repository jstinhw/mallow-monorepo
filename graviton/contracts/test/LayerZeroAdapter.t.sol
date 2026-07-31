// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {LayerZeroAdapter} from "../src/adapters/LayerZeroAdapter.sol";
import {
    ILayerZeroEndpointV2,
    MessagingParams,
    MessagingReceipt,
    MessagingFee,
    SetConfigParam
} from "../src/interfaces/layerzero/ILayerZeroEndpointV2.sol";
import {Origin} from "../src/interfaces/layerzero/ILayerZeroReceiver.sol";
import {IInteropExecutor} from "../src/interfaces/IInteropExecutor.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {Order, SrcIntent, TargetIntent, ValidationCall, ExecutionCall} from "../src/types/Structs.sol";

contract MockLayerZeroEndpoint is ILayerZeroEndpointV2 {
    event SendCalled(
        uint32 dstEid, bytes32 receiver, bytes message, bytes options, address refundAddress, uint256 value
    );

    uint256 public nativeFee = 0.01 ether;

    MessagingParams public lastParams;
    address public lastRefundAddress;
    uint256 public lastValue;

    function send(MessagingParams calldata _params, address _refundAddress)
        external
        payable
        override
        returns (MessagingReceipt memory)
    {
        lastParams = _params;
        lastRefundAddress = _refundAddress;
        lastValue = msg.value;

        emit SendCalled(_params.dstEid, _params.receiver, _params.message, _params.options, _refundAddress, msg.value);

        // Consume the fee, return excess to adapter (simulating endpoint behavior)
        uint256 excess = msg.value - nativeFee;
        if (excess > 0) {
            (bool success,) = msg.sender.call{value: excess}("");
            require(success);
        }

        return MessagingReceipt({
            guid: keccak256(abi.encode(_params.dstEid, _params.receiver, _params.message)),
            nonce: 1,
            fee: MessagingFee({nativeFee: nativeFee, lzTokenFee: 0})
        });
    }

    function quote(MessagingParams calldata, address) external view override returns (MessagingFee memory) {
        return MessagingFee({nativeFee: nativeFee, lzTokenFee: 0});
    }

    function setDelegate(address) external override {}

    function setConfig(address, address, SetConfigParam[] calldata) external override {}
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

contract LayerZeroAdapterTest is Test {
    LayerZeroAdapter adapter;
    MockLayerZeroEndpoint lzEndpoint;
    MockInteropExecutor interopExecutor;
    MockERC20 token;

    address user = makeAddr("user");
    address refundAddress = makeAddr("refund");
    address simulation = makeAddr("simulation");

    uint32 constant DST_EID = 30101;

    function setUp() public {
        lzEndpoint = new MockLayerZeroEndpoint();
        interopExecutor = new MockInteropExecutor();
        token = new MockERC20("Test Token", "TST", 18);

        adapter = new LayerZeroAdapter(address(lzEndpoint), address(interopExecutor), simulation, address(this));

        vm.deal(user, 100 ether);
        token.mint(user, 1000 ether);
    }

    function _createEmptyOrder() internal view returns (Order memory) {
        SrcIntent memory emptyIntent;
        TargetIntent memory targetIntent = TargetIntent({
            nonce: 1,
            chainId: 2,
            token: address(token),
            amount: 100 ether,
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

    function test_InitiateDeposit_MessageOnly() public {
        Order memory order = _createEmptyOrder();

        bytes memory options = hex"0003010011010000000000000000000000000000c350";
        bytes memory adapterData = abi.encode(DST_EID, options, refundAddress);

        // Fund adapter with native for LZ fee
        vm.deal(address(adapter), 0.1 ether);

        uint256 refundBalanceBefore = refundAddress.balance;

        bytes32 self = bytes32(uint256(uint160(address(adapter))));

        vm.prank(user);

        vm.expectEmit(true, true, true, true, address(lzEndpoint));
        emit MockLayerZeroEndpoint.SendCalled(DST_EID, self, abi.encode(order), options, refundAddress, 0.1 ether);

        adapter.initiateBridge(address(token), 0, adapterData, order);

        assertEq(lzEndpoint.lastRefundAddress(), refundAddress);
        // Endpoint consumed 0.01 ether fee, returned 0.09 to adapter, adapter forwarded to refundAddress
        assertEq(refundAddress.balance - refundBalanceBefore, 0.09 ether);
        // Adapter should hold no native
        assertEq(address(adapter).balance, 0);
    }

    function test_Revert_InitiateDeposit_NonZeroAmount() public {
        uint256 amount = 100 ether;
        Order memory order = _createEmptyOrder();

        bytes memory options = hex"";
        bytes memory adapterData = abi.encode(DST_EID, options, refundAddress);

        vm.startPrank(user);
        token.approve(address(adapter), amount);

        vm.expectRevert(LayerZeroAdapter.InvalidInputAmount.selector);
        adapter.initiateBridge(address(token), amount, adapterData, order);
        vm.stopPrank();
    }

    /*
     * lzReceive Tests
     */

    function test_LzReceive_HappyPath() public {
        uint256 amount = 100 ether;
        Order memory order = _createEmptyOrder();
        order.targetIntent.amount = amount;

        bytes memory message = abi.encode(order);
        bytes32 self = bytes32(uint256(uint160(address(adapter))));
        Origin memory origin = Origin({srcEid: DST_EID, sender: self, nonce: 1});

        // Fund adapter with tokens (pre-funded liquidity)
        token.mint(address(adapter), amount);

        vm.prank(address(lzEndpoint));

        vm.expectEmit(true, true, true, true, address(interopExecutor));
        emit MockInteropExecutor.FillCalled(order, address(token), amount);

        adapter.lzReceive(origin, bytes32(0), message, address(0), "");

        (Order memory filledOrder, address filledToken, uint256 filledAmount) = interopExecutor.getLastFillData();
        assertEq(filledToken, address(token));
        assertEq(filledAmount, amount);
        assertEq(filledOrder.sender, user);
    }

    function test_Revert_LzReceive_NotEndpoint() public {
        Order memory order = _createEmptyOrder();
        bytes memory message = abi.encode(order);
        bytes32 self = bytes32(uint256(uint160(address(adapter))));
        Origin memory origin = Origin({srcEid: DST_EID, sender: self, nonce: 1});

        vm.prank(user);
        vm.expectRevert(LayerZeroAdapter.NotEndpoint.selector);
        adapter.lzReceive(origin, bytes32(0), message, address(0), "");
    }

    function test_Revert_LzReceive_NotPeer() public {
        Order memory order = _createEmptyOrder();
        bytes memory message = abi.encode(order);
        bytes32 fakePeer = bytes32(uint256(1));
        Origin memory origin = Origin({srcEid: DST_EID, sender: fakePeer, nonce: 1});

        vm.prank(address(lzEndpoint));
        vm.expectRevert(LayerZeroAdapter.NotPeer.selector);
        adapter.lzReceive(origin, bytes32(0), message, address(0), "");
    }

    function test_Revert_LzReceive_InsufficientBalance() public {
        uint256 amount = 100 ether;
        Order memory order = _createEmptyOrder();
        order.targetIntent.amount = amount;

        bytes memory message = abi.encode(order);
        bytes32 self = bytes32(uint256(uint160(address(adapter))));
        Origin memory origin = Origin({srcEid: DST_EID, sender: self, nonce: 1});

        vm.prank(address(lzEndpoint));
        vm.expectRevert(LayerZeroAdapter.InsufficientBalance.selector);
        adapter.lzReceive(origin, bytes32(0), message, address(0), "");
    }

    /*
     * allowInitializePath Tests
     */

    function test_AllowInitializePath_ValidPeer() public view {
        bytes32 self = bytes32(uint256(uint160(address(adapter))));
        Origin memory origin = Origin({srcEid: DST_EID, sender: self, nonce: 1});

        assertTrue(adapter.allowInitializePath(origin));
    }

    function test_AllowInitializePath_InvalidPeer() public view {
        bytes32 fakePeer = bytes32(uint256(1));
        Origin memory origin = Origin({srcEid: DST_EID, sender: fakePeer, nonce: 1});

        assertFalse(adapter.allowInitializePath(origin));
    }

    /*
     * nextNonce Tests
     */

    function test_NextNonce_ReturnsZero() public view {
        bytes32 self = bytes32(uint256(uint160(address(adapter))));
        assertEq(adapter.nextNonce(DST_EID, self), 0);
    }

    /*
     * Quote Tests
     */

    function test_Quote() public view {
        bytes memory message = hex"1234";
        bytes memory options = hex"0003";

        MessagingFee memory fee = adapter.quote(DST_EID, message, options);

        assertEq(fee.nativeFee, 0.01 ether);
        assertEq(fee.lzTokenFee, 0);
    }

    /*
     * Receive Tests
     */

    function test_Receive() public {
        (bool success,) = address(adapter).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(address(adapter).balance, 1 ether);
    }
}
