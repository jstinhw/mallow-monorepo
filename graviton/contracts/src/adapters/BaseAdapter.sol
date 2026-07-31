// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IAdapter} from "../interfaces/IAdapter.sol";
import {NATIVE_TOKEN} from "../types/Constants.sol";
import {Order} from "../types/Structs.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

abstract contract BaseAdapter is IAdapter {
    error InvalidAmount();

    constructor() {}

    function initiateBridge(
        address _inputToken,
        uint256 _inputAmount,
        bytes calldata _adapterData,
        Order calldata _order
    ) external payable override {
        if (_inputToken == NATIVE_TOKEN) {
            require(msg.value == _inputAmount, InvalidAmount());
        } else {
            SafeTransferLib.safeTransferFrom(_inputToken, msg.sender, address(this), _inputAmount);
        }
        _initiateDeposit(_inputToken, _inputAmount, _adapterData, _order);
    }

    function _initiateDeposit(
        address _inputToken,
        uint256 _inputAmount,
        bytes calldata _adapterData,
        Order calldata _order
    ) internal virtual;
}
