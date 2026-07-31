// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Order} from "../types/Structs.sol";

interface IInteropExecutor {
    event OrderOpened(bytes32 indexed orderHash, address indexed sender, uint256 indexed targetChainId);
    event OrderFilled(bytes32 indexed orderHash, address indexed sender, uint256 indexed srcChainId);

    error OrderExpired();
    error InvalidSrcIntent();
    error InvalidSrcIntentIndex();
    error InvalidNonce();
    error InvalidSender(address orderSender, address initDataSender);
    error PreHookFailed();
    error PostHookFailed();
    error InsufficientBridgeTokens();
    error InsufficientPaymentTokens();
    error InvalidSignature();
    error ValidationFailed();
    error ExecutionFailed();
    error FillFailed();

    /// @notice Open an order
    function open(Order calldata order) external payable;

    /// @notice Fill an order
    function fill(Order calldata order, address token, uint256 amount) external payable;
}
