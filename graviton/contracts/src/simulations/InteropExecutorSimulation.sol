// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IInteropExecutor} from "../interfaces/IInteropExecutor.sol";
import {Order} from "../types/Structs.sol";

contract InteropExecutorSimulation {
    constructor() {}

    receive() external payable {}

    function simulateOpen(address payable interopExecutor, Order calldata order) external payable {
        try IInteropExecutor(interopExecutor).open{value: msg.value}(order) {}
        catch (bytes memory data) {
            if (bytes4(data) != IInteropExecutor.InvalidSignature.selector) {
                assembly {
                    revert(add(data, 0x20), mload(data))
                }
            }
        }
    }
}
