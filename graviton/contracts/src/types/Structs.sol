// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IAdapter} from "../interfaces/IAdapter.sol";
import {IInteropValidator} from "../interfaces/IInteropValidator.sol";

struct Order {
    address sender;
    uint32 openDeadline;
    uint32 fillDeadline;
    bytes initData;
    // target intent
    TargetIntent targetIntent;
    // src intents
    SrcIntent srcIntent;
    // order signature
    bytes signature;
}

struct PaymentToken {
    address recipient;
    address token;
    uint256 amount;
}

struct ValidationCall {
    IInteropValidator validator;
    bytes data;
}

struct ExecutionCall {
    bytes data;
    bytes32 mode;
}

struct Call {
    address to;
    uint256 value;
    bytes data;
}

struct SrcIntent {
    uint256 chainId;
    uint256 nonce;
    // payments tokens
    PaymentToken[] paymentTokens;
    // hooks
    Call[] preHooks;
    Call[] postHooks;
    // tokens to brdige
    address token;
    uint256 amount;
    // adapter data
    IAdapter adapter;
    bytes adapterData;
}

struct TargetIntent {
    uint256 nonce;
    uint256 chainId;
    address token;
    uint256 amount;
    ValidationCall[] validations;
    ExecutionCall[] executions;
}
