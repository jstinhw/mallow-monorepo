// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IAcrossMessageHandler} from "../interfaces/across/IAcrossMessageHandler.sol";
import {ISpokePool} from "../interfaces/across/ISpokePool.sol";
import {WETH} from "solady/tokens/WETH.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {NATIVE_TOKEN} from "../types/Constants.sol";
import {Order} from "../types/Structs.sol";
import {IInteropExecutor} from "../interfaces/IInteropExecutor.sol";

contract AcrossAdapterSimulation is IAcrossMessageHandler {
    ISpokePool public immutable SPOKE_POOL;
    WETH public immutable WRAPPED_NATIVE_TOKEN;
    IInteropExecutor public immutable INTEROP_EXECUTOR;

    constructor(address spokePool_, address interopExecutor_, address wrappedNativeToken_) {
        SPOKE_POOL = ISpokePool(spokePool_);
        WRAPPED_NATIVE_TOKEN = WETH(payable(wrappedNativeToken_));
        INTEROP_EXECUTOR = IInteropExecutor(interopExecutor_);
    }

    receive() external payable {}

    function handleV3AcrossMessage(address tokenSent, uint256 amount, address, bytes memory message) external override {
        Order memory order = abi.decode(message, (Order));
        bool isNative = order.targetIntent.token == NATIVE_TOKEN;
        uint256 value = 0;

        if (isNative) {
            WRAPPED_NATIVE_TOKEN.withdraw(amount);
            value = amount;
        } else {
            SafeTransferLib.safeApprove(tokenSent, address(INTEROP_EXECUTOR), amount);
        }
        try INTEROP_EXECUTOR.fill{value: value}(order, tokenSent, amount) {}
        catch (bytes memory data) {
            if (bytes4(data) != IInteropExecutor.InvalidSignature.selector) {
                assembly {
                    revert(add(data, 0x20), mload(data))
                }
            }
        }
    }
}
