// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC7579Account {
    function executeFromExecutor(bytes32 execMode, bytes calldata execCallData)
        external
        returns (bytes[] memory returnData);
}
