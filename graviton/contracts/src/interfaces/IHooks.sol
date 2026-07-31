// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPostHook {
    /**
     * @notice Executes the post-hook logic
     * @param data The data required for the post-hook execution
     * @param context The context bytes returned from the pre-hook
     */
    function execute(bytes calldata data, bytes calldata context) external payable;
}
