// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Order} from "../types/Structs.sol";

interface IAdapter {
    function initiateBridge(address inputToken, uint256 inputAmount, bytes calldata adapterData, Order calldata order)
        external
        payable;
}
