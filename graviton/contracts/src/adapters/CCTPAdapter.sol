// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ITokenMessagerV2} from "../interfaces/cctp/ITokenMessagerV2.sol";
import {IMessageTransmitterV2} from "../interfaces/cctp/IMessageTransmitterV2.sol";
import {IMessageHandlerV2} from "../interfaces/cctp/IMessageHandlerV2.sol";
import {BaseAdapter} from "./BaseAdapter.sol";
import {IInteropExecutor} from "../interfaces/IInteropExecutor.sol";
import {Order} from "../types/Structs.sol";

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

contract CCTPAdapter is BaseAdapter, IMessageHandlerV2 {
    address public immutable USDC_ADDRESS;
    ITokenMessagerV2 public immutable TOKEN_MESSENGER_V2;
    IMessageTransmitterV2 public immutable MESSAGE_TRANSMITTER_V2;
    IInteropExecutor public immutable INTEROP_EXECUTOR;

    uint256 public constant MESSAGE_BODY_WITH_HOOK_LENGTH = 376;

    error NotUSDC();
    error NotTokenTransmitterV2();
    error ReceiveMessageFailed();
    error InvalidMessageVersion();
    error MessageBodyLengthTooShort();
    error InsufficientBalance();

    constructor(
        address _usdcAddress,
        address _tokenMessengerV2,
        address _messageTransmitterV2,
        address _interopExecutor
    ) {
        USDC_ADDRESS = _usdcAddress;
        TOKEN_MESSENGER_V2 = ITokenMessagerV2(_tokenMessengerV2);
        MESSAGE_TRANSMITTER_V2 = IMessageTransmitterV2(_messageTransmitterV2);
        INTEROP_EXECUTOR = IInteropExecutor(_interopExecutor);
    }

    receive() external payable {}

    function _initiateDeposit(
        address _inputToken,
        uint256 _inputAmount,
        bytes calldata _adapterData,
        Order calldata _order
    ) internal override {
        if (_inputToken != USDC_ADDRESS) {
            revert NotUSDC();
        }
        SafeTransferLib.safeApprove(_inputToken, address(TOKEN_MESSENGER_V2), _inputAmount);
        (uint32 destinationDomain, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) =
            abi.decode(_adapterData, (uint32, bytes32, uint256, uint32));

        bytes memory message = abi.encode(_order);

        TOKEN_MESSENGER_V2.depositForBurnWithHook(
            _inputAmount,
            destinationDomain,
            bytes32(uint256(uint160(address(this)))),
            _inputToken,
            destinationCaller,
            maxFee,
            minFinalityThreshold,
            message
        );
    }

    function receiveMessage(bytes calldata message, bytes calldata attestation) external override {
        bool success = MESSAGE_TRANSMITTER_V2.receiveMessage(message, attestation);
        if (!success) {
            revert ReceiveMessageFailed();
        }

        // execution
        bytes4 messageVersion = bytes4(message[0:4]);
        if (messageVersion != bytes4(0x00000001)) {
            revert InvalidMessageVersion();
        }

        bytes4 messageBodyVersion = bytes4(message[148:152]);
        if (messageBodyVersion != bytes4(0x00000001)) {
            revert InvalidMessageVersion();
        }

        if (message.length < MESSAGE_BODY_WITH_HOOK_LENGTH) {
            revert MessageBodyLengthTooShort();
        }

        bytes memory messageBody = message[MESSAGE_BODY_WITH_HOOK_LENGTH:];
        Order memory order = abi.decode(messageBody, (Order));

        if (order.targetIntent.token != USDC_ADDRESS) {
            revert NotUSDC();
        }

        uint256 balance = SafeTransferLib.balanceOf(order.targetIntent.token, address(this));
        if (balance < order.targetIntent.amount) {
            revert InsufficientBalance();
        }

        SafeTransferLib.safeApprove(order.targetIntent.token, address(INTEROP_EXECUTOR), balance);
        INTEROP_EXECUTOR.fill(order, order.targetIntent.token, balance);
    }
}
