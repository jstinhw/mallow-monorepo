// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Order} from "../types/Structs.sol";

interface IInteropValidator {
    /**
     * @notice Executes the validation hook logic
     * @param order The order to validate
     * @param data The data required for the validation hook execution
     * @return isValid Boolean indicating if the validation was successful
     */
    function validate(Order calldata order, bytes calldata data) external returns (bool isValid);
}
