// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IAdapter} from "../../src/interfaces/IAdapter.sol";
import {Order} from "../../src/types/Structs.sol";

contract MockAdapter is IAdapter {
    event BridgeInitiated(address sender, address token, uint256 amount, bytes adapterData);

    function initiateBridge(address token, uint256 amount, bytes calldata adapterData, Order calldata order)
        external
        payable
        override
    {
        emit BridgeInitiated(order.sender, token, amount, adapterData);
    }
}
