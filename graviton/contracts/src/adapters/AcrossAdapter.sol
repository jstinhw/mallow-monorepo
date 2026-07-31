// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {BaseAdapter} from "./BaseAdapter.sol";
import {ISpokePool} from "../interfaces/across/ISpokePool.sol";
import {IAcrossMessageHandler} from "../interfaces/across/IAcrossMessageHandler.sol";
import {NATIVE_TOKEN} from "../types/Constants.sol";
import {Order} from "../types/Structs.sol";
import {IInteropExecutor} from "../interfaces/IInteropExecutor.sol";

import {WETH} from "solady/tokens/WETH.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

contract AcrossAdapter is BaseAdapter, IAcrossMessageHandler {
    ISpokePool public immutable SPOKE_POOL;
    WETH public immutable WRAPPED_NATIVE_TOKEN;
    IInteropExecutor public immutable INTEROP_EXECUTOR;

    error NotSpokePool();
    error WrapFailed();

    constructor(address spokePool_, address interopExecutor_, address wrappedNativeToken_) BaseAdapter() {
        SPOKE_POOL = ISpokePool(spokePool_);
        WRAPPED_NATIVE_TOKEN = WETH(payable(wrappedNativeToken_));
        INTEROP_EXECUTOR = IInteropExecutor(interopExecutor_);
    }

    receive() external payable {}

    modifier onlySpokePool() {
        if (msg.sender != address(SPOKE_POOL)) revert NotSpokePool();
        _;
    }

    function _initiateDeposit(
        address _inputToken,
        uint256 _inputAmount,
        bytes calldata _adapterData,
        Order calldata _order
    ) internal override {
        bool isNative = _inputToken == NATIVE_TOKEN;
        uint256 value = 0;
        if (!isNative) {
            SafeTransferLib.safeApprove(_inputToken, address(SPOKE_POOL), _inputAmount);
        } else {
            value = _inputAmount;
        }
        (address exclusiveRelayer, uint32 quoteTimestamp, uint32 exclusivityDeadline, uint32 fillDeadline) =
            abi.decode(_adapterData, (address, uint32, uint32, uint32));

        bytes memory message = abi.encode(_order);
        SPOKE_POOL.depositV3{value: value}(
            _order.sender,
            address(this),
            isNative ? address(WRAPPED_NATIVE_TOKEN) : _inputToken,
            _order.targetIntent.token,
            _inputAmount,
            _order.targetIntent.amount,
            _order.targetIntent.chainId,
            exclusiveRelayer,
            quoteTimestamp,
            fillDeadline,
            exclusivityDeadline,
            message
        );
    }

    function handleV3AcrossMessage(address tokenSent, uint256 amount, address, bytes memory message)
        external
        override
        onlySpokePool
    {
        Order memory order = abi.decode(message, (Order));
        bool isNative = order.targetIntent.token == NATIVE_TOKEN;
        uint256 value = 0;

        if (isNative) {
            WRAPPED_NATIVE_TOKEN.withdraw(amount);
            value = amount;
        } else {
            SafeTransferLib.safeApprove(tokenSent, address(INTEROP_EXECUTOR), amount);
        }
        INTEROP_EXECUTOR.fill{value: value}(order, tokenSent, amount);
    }
}
