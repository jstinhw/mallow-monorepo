// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IMessageTransmitterV2} from "../interfaces/cctp/IMessageTransmitterV2.sol";
import {ITokenMessagerV2} from "../interfaces/cctp/ITokenMessagerV2.sol";
import {IMessageHandlerV2} from "../interfaces/cctp/IMessageHandlerV2.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {Order} from "../types/Structs.sol";
import {IInteropExecutor} from "../interfaces/IInteropExecutor.sol";

contract CCTPAdapterSimulation is IMessageHandlerV2 {
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

    function receiveMessage(bytes calldata message, bytes calldata attestation) external override {
        /// skip token mint from cctp

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

        SafeTransferLib.safeApprove(order.targetIntent.token, address(INTEROP_EXECUTOR), order.targetIntent.amount);
        try INTEROP_EXECUTOR.fill(order, order.targetIntent.token, order.targetIntent.amount) {}
        catch (bytes memory data) {
            if (bytes4(data) != IInteropExecutor.InvalidSignature.selector) {
                assembly {
                    revert(add(data, 0x20), mload(data))
                }
            }
        }
    }
}
