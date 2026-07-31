// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IInteropValidator} from "../../src/interfaces/IInteropValidator.sol";
import {Order} from "../../src/types/Structs.sol";

contract MockValidator is IInteropValidator {
    bool public shouldPass;

    constructor(bool _shouldPass) {
        shouldPass = _shouldPass;
    }

    function setShouldPass(bool _shouldPass) external {
        shouldPass = _shouldPass;
    }

    function validate(Order calldata, bytes calldata) external view returns (bool) {
        return shouldPass;
    }
}
