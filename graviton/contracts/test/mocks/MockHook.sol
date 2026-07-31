// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IPostHook} from "../../src/interfaces/IHooks.sol";

contract MockHook is IPostHook {
    event HookExecuted(bytes data, bytes context);

    bool public shouldFail;

    function setShouldFail(bool _shouldFail) external {
        shouldFail = _shouldFail;
    }

    function execute(bytes calldata data, bytes calldata context) external payable {
        if (shouldFail) revert("MockHook Failed");
        emit HookExecuted(data, context);
    }

    fallback() external payable {
        if (shouldFail) revert("MockHook Failed");
    }

    receive() external payable {
        if (shouldFail) revert("MockHook Failed");
    }
}
